import { v4 as uuidv4 } from "uuid";
import {
  type WsIncomingMessage,
  WsIncomingMessageType,
  WsOutgoingMessageType,
} from "../domain/ws.types";
import { RoomRepository } from "../repositories/room.repo";
import type {
  ClientPlaybackPayload,
  PlaybackState,
  RoomFullStatePayload,
  RoomMetadata,
} from "../domain/room.types";

export class RoomService {
  constructor(private roomRepo: RoomRepository) {}

  async createRoom(
    hostId: string,
    name: string,
    mediaUrl: string = "",
    mediaType: string = "",
    isPlaying: boolean = false,
    isPublic = true,
    maxParticipants = 10,
  ) {
    const roomId = uuidv4();

    const metadata: RoomMetadata = {
      name,
      hostId,
      isPublic,
      maxParticipants,
      createdAt: new Date().toISOString(),
    };

    await this.roomRepo.createMetadata(roomId, metadata);

    await this.roomRepo.addMember(roomId, hostId);

    const initialState: PlaybackState = {
      mediaUrl,
      mediaType,
      isPlaying,
      currentTime: 0,
      playbackSpeed: 1.0,
      lastUpdatedBy: hostId,
      lastUpdated: new Date().toISOString(),
    };
    await this.roomRepo.createPlaybackState(roomId, initialState);

    return { roomId, ...metadata };
  }

  async getRoomDetails(roomId: string): Promise<RoomFullStatePayload> {
    const metadata = await this.roomRepo.getMetadata(roomId);
    if (!metadata) {
      throw new Error("Room not found");
    }

    const members = await this.roomRepo.getMembers(roomId);
    const playbackState = await this.roomRepo.getPlaybackState(roomId);

    const state: RoomFullStatePayload = {
      roomId,
      members,
      playbackState,
      ...metadata,
    };

    return state;
  }

  async joinRoom(roomId: string, userId: string) {
    const metadata = await this.roomRepo.getMetadata(roomId);
    if (!metadata) {
      throw new Error("Room not found");
    }

    const isMember = await this.roomRepo.isMember(roomId, userId);
    if (isMember) {
      throw new Error("You are already in this room");
    }

    const currentMembers = await this.roomRepo.getMemberCount(roomId);
    if (currentMembers >= metadata.maxParticipants) {
      throw new Error("Room is full");
    }

    await this.roomRepo.addMember(roomId, userId);

    return { message: "Successfully joined the room" };
  }

  async leaveRoom(roomId: string, userId: string) {
    const isMember = await this.roomRepo.isMember(roomId, userId);
    if (!isMember) {
      throw new Error("You are not in this room");
    }

    await this.roomRepo.removeMember(roomId, userId);

    // If there are no more members, deletes the room
    const remainingMembers = await this.roomRepo.getMemberCount(roomId);
    if (remainingMembers === 0) {
      await this.roomRepo.deleteRoom(roomId);
      return { message: "Room deleted" };
    }

    return { message: "Successfully left the room" };
  }

  async updatePlayback(
    roomId: string,
    userId: string,
    updates: ClientPlaybackPayload,
  ): Promise<PlaybackState> {
    const isMember = await this.roomRepo.isMember(roomId, userId);
    if (!isMember) {
      throw new Error("You are not in this room");
    }

    const current = await this.roomRepo.getPlaybackState(roomId);
    if (!current) {
      throw new Error("Playback state not found");
    }

    const newState: PlaybackState = {
      ...current,
      ...updates,
      lastUpdatedBy: userId,
      lastUpdated: new Date().toISOString(),
    };

    await this.roomRepo.updatePlaybackState(roomId, newState);

    return newState;
  }

  async getPlaybackState(roomId: string) {
    const state = await this.roomRepo.getPlaybackState(roomId);
    if (!state) {
      throw new Error("Playback state not found");
    }
    return state;
  }

  async listActiveRooms() {
    const roomIds = await this.roomRepo.getActiveRooms();

    const rooms = await Promise.all(
      roomIds.map(async (roomId) => {
        const metadata = await this.roomRepo.getMetadata(roomId);
        const memberCount = await this.roomRepo.getMemberCount(roomId);

        if (!metadata) return null;

        return {
          roomId,
          ...metadata,
          currentMembers: memberCount,
        };
      }),
    );

    return rooms.filter((room) => room !== null);
  }

  async handleUserConnection(
    roomId: string,
    userId: string,
    connectionId: string,
  ) {
    const isMember = await this.roomRepo.isMember(roomId, userId);
    if (!isMember) {
      await this.joinRoom(roomId, userId);
    }

    await this.roomRepo.addConnection(roomId, userId, connectionId);

    const memberCount = await this.roomRepo.getMemberCount(roomId);

    console.log(`WS: User ${userId} joined room ${roomId}`);

    return {
      type: WsOutgoingMessageType.UserJoined,
      payload: { userId, memberCount },
    };
  }

  async handleUserMessage(
    roomId: string,
    userId: string,
    message: WsIncomingMessage,
  ) {
    switch (message.type) {
      case WsIncomingMessageType.UpdatePlayback:
        const newState = await this.updatePlayback(
          roomId,
          userId,
          message.payload,
        );
        return {
          action: "publish",
          message: {
            type: WsOutgoingMessageType.PlaybackUpdated,
            payload: newState,
          },
        };

      case WsIncomingMessageType.SyncRequest:
        const details = await this.getRoomDetails(roomId);
        return {
          action: "send",
          message: {
            type: WsOutgoingMessageType.SyncFullState,
            payload: details,
          },
        };

      case WsIncomingMessageType.Heartbeat:
        await this.roomRepo.refreshRoomTTL(roomId);
        return null;
    }
  }

  async handleUserDisconnection(
    roomId: string,
    userId: string,
    connectionId: string,
  ) {
    await this.roomRepo.removeConnection(roomId, userId, connectionId);

    const messagesToPublish = [];

    if (!(await this.roomRepo.hasActiveConnections(roomId, userId))) {
      await this.leaveRoom(roomId, userId);

      const memberCount = await this.roomRepo.getMemberCount(roomId);
      messagesToPublish.push({
        type: WsOutgoingMessageType.UserLeft,
        payload: { userId, memberCount },
      });

      // Host migration logic
      if (memberCount > 0) {
        const room = await this.roomRepo.getMetadata(roomId);
        if (room && room.hostId === userId) {
          const members = await this.roomRepo.getMembers(roomId);
          if (members.length > 0) {
            const newHostId = members[0]!;
            await this.roomRepo.updateHost(roomId, newHostId);
            messagesToPublish.push({
              type: WsOutgoingMessageType.HostChanged,
              payload: { newHostId },
            });
          }
        }
      }
    }

    return messagesToPublish;
  }
}
