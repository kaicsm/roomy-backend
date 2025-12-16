import { redis } from "../../infra/cache/redis.config";
import type { PlaybackState, RoomMetadata } from "../domain/room.types";

export class RoomRepository {
  private ROOM_TTL_SECONDS = 60; // 1 minute

  async refreshRoomTTL(roomId: string): Promise<void> {
    const keys = [
      `room:${roomId}:metadata`,
      `room:${roomId}:members`,
      `room:${roomId}:playback`,
    ];

    await Promise.all(
      keys.map((key) => redis.expire(key, this.ROOM_TTL_SECONDS)),
    );
  }

  async createMetadata(roomId: string, metadata: RoomMetadata): Promise<void> {
    await redis.setex(
      `room:${roomId}:metadata`,
      this.ROOM_TTL_SECONDS,
      JSON.stringify(metadata),
    );
    await redis.sadd("active_rooms", roomId);
  }

  async getMetadata(roomId: string): Promise<RoomMetadata | null> {
    const data = await redis.get(`room:${roomId}:metadata`);
    if (!data) {
      await redis.srem("active_rooms", roomId);
      return null;
    }
    return JSON.parse(data) as RoomMetadata;
  }

  async deleteMetadata(roomId: string): Promise<void> {
    await redis.del(`room:${roomId}:metadata`);
    await redis.srem("active_rooms", roomId);
  }

  async addMember(roomId: string, userId: string): Promise<void> {
    await redis.rpush(`room:${roomId}:members`, userId);
    await this.refreshRoomTTL(roomId);
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    await redis.lrem(`room:${roomId}:members`, 0, userId);
    await this.refreshRoomTTL(roomId);
  }

  async getMembers(roomId: string): Promise<string[]> {
    return await redis.lrange(`room:${roomId}:members`, 0, -1);
  }

  async getMemberCount(roomId: string): Promise<number> {
    return await redis.llen(`room:${roomId}:members`);
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const members = await this.getMembers(roomId);
    return members.includes(userId);
  }

  async createPlaybackState(
    roomId: string,
    state: PlaybackState,
  ): Promise<void> {
    await redis.setex(
      `room:${roomId}:playback`,
      this.ROOM_TTL_SECONDS,
      JSON.stringify(state),
    );
  }

  async getPlaybackState(roomId: string): Promise<PlaybackState | null> {
    const data = await redis.get(`room:${roomId}:playback`);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as PlaybackState;
  }

  async updatePlaybackState(
    roomId: string,
    state: PlaybackState,
  ): Promise<void> {
    await redis.setex(
      `room:${roomId}:playback`,
      this.ROOM_TTL_SECONDS,
      JSON.stringify(state),
    );

    await this.refreshRoomTTL(roomId);
  }

  async deletePlaybackState(roomId: string): Promise<void> {
    await redis.del(`room:${roomId}:playback`);
  }

  async addConnection(
    roomId: string,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const key = `room:${roomId}:connections:${userId}`;

    await redis.sadd(key, connectionId);
    await redis.expire(key, this.ROOM_TTL_SECONDS);
  }

  async removeConnection(
    roomId: string,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const key = `room:${roomId}:connections:${userId}`;
    await redis.srem(key, connectionId);

    // If no more connections for this user, delete the set
    const count = await redis.scard(key);
    if (count === 0) {
      await redis.del(key);
    }
  }

  async hasActiveConnections(roomId: string, userId: string): Promise<boolean> {
    return (await redis.scard(`room:${roomId}:connections:${userId}`)) > 0;
  }

  async getActiveRooms(): Promise<string[]> {
    return await redis.smembers("active_rooms");
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.deleteMetadata(roomId);
    await redis.del(`room:${roomId}:members`);
    await this.deletePlaybackState(roomId);

    const keys = await redis.keys(`room:${roomId}:connections:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  async updateHost(roomId: string, newHostId: string): Promise<void> {
    const metadata = await this.getMetadata(roomId);
    if (!metadata) {
      throw new Error("Room not found");
    }

    metadata.hostId = newHostId;
    await this.createMetadata(roomId, metadata);
  }
}
