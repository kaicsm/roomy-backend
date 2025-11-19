import Elysia, { t } from "elysia";
import { RoomController } from "../core/controllers/room.controller";
import { RoomRepository } from "../core/repositories/room.repo";
import { type WsIncomingMessage } from "../core/domain/ws.types";
import jwt from "@elysiajs/jwt";

const roomController = new RoomController();
const roomRepo = new RoomRepository();

export const roomRoute = new Elysia({ prefix: "/rooms" })
  .use(
    jwt({
      name: "jwt",
      secret: process.env.JWT_SECRET!,
    }),
  )

  .get("/", async () => {
    return roomController.listActiveRooms();
  })

  .post(
    "/",
    async ({ body, headers, jwt }) => {
      const token = headers.authorization?.replace("Bearer ", "");
      if (!token) throw new Error("Token not provided");

      const payload = await jwt.verify(token);
      if (!payload) throw new Error("Invalid token");

      return roomController.createRoom(body, payload.sub as string);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 3 }),
        isPublic: t.Optional(t.Boolean()),
        maxParticipants: t.Optional(t.Number({ minimum: 2, maximum: 50 })),
      }),
    },
  )

  .get("/:roomId", async ({ params }) => {
    return roomController.getRoomDetails(params.roomId);
  })

  .post("/:roomId/join", async ({ params, headers, jwt }) => {
    const token = headers.authorization?.replace("Bearer ", "");
    if (!token) throw new Error("Token not provided");

    const payload = await jwt.verify(token);
    if (!payload) throw new Error("Invalid token");

    return roomController.joinRoom(params.roomId, payload.sub as string);
  })

  .post("/:roomId/leave", async ({ params, headers, jwt }) => {
    const token = headers.authorization?.replace("Bearer ", "");
    if (!token) throw new Error("Token not provided");

    const payload = await jwt.verify(token);
    if (!payload) throw new Error("Invalid token");

    return roomController.leaveRoom(params.roomId, payload.sub as string);
  })

  .get("/:roomId/playback", async ({ params }) => {
    return roomController.getPlaybackState(params.roomId);
  })

  .ws("/:roomId/ws", {
    body: t.Object({
      type: t.String(),
      payload: t.Optional(t.Any()),
    }),

    query: t.Object({
      token: t.String(),
    }),

    async open(ws) {
      const { roomId } = ws.data.params;
      const { token } = ws.data.query;

      const payload = await ws.data.jwt.verify(token);
      if (!payload) {
        ws.send({ type: "ERROR", payload: "Invalid Token" });
        ws.close();
        return;
      }
      const userId = payload.sub as string;

      const metadata = await roomRepo.getMetadata(roomId);
      if (!metadata) {
        ws.send({ type: "ERROR", payload: "Room not found" });
        ws.close();
        return;
      }

      try {
        const isMember = await roomRepo.isMember(roomId, userId);
        if (!isMember) {
          const count = await roomRepo.getMemberCount(roomId);
          if (count >= metadata.maxParticipants) {
            ws.send({ type: "ERROR", payload: "Room is full" });
            ws.close();
            return;
          }
          await roomRepo.addMember(roomId, userId);
        }

        ws.subscribe(roomId);

        const memberCount = await roomRepo.getMemberCount(roomId);
        ws.publish(roomId, {
          type: "USER_JOINED",
          payload: { userId, memberCount },
        });

        console.log(`WS: User ${userId} joined room ${roomId}`);
      } catch (e) {
        ws.send({ type: "ERROR", payload: "Failed to join room" });
        ws.close();
      }
    },

    async message(ws, message: WsIncomingMessage) {
      const { roomId } = ws.data.params;
      const { token } = ws.data.query;

      const payload = await ws.data.jwt.verify(token);
      if (!payload) return;
      const userId = payload.sub as string;

      switch (message.type) {
        case "UPDATE_PLAYBACK":
          try {
            const newState = await roomController.updatePlayback(
              roomId,
              userId,
              message.payload,
            );

            ws.publish(roomId, {
              type: "PLAYBACK_UPDATED",
              payload: newState,
            });

            ws.send({
              type: "PLAYBACK_UPDATED",
              payload: newState,
            });
          } catch (error) {
            ws.send({ type: "ERROR", payload: "Failed to update playback" });
          }
          break;

        case "SYNC_REQUEST":
          const details = await roomController.getRoomDetails(roomId);
          ws.send({
            type: "SYNC_FULL_STATE",
            payload: details,
          });
          break;
      }
    },

    async close(ws) {
      const { roomId } = ws.data.params;
      const { token } = ws.data.query;

      const payload = await ws.data.jwt.verify(token);
      if (payload) {
        const userId = payload.sub as string;

        await roomRepo.removeMember(roomId, userId);
        ws.unsubscribe(roomId);

        const memberCount = await roomRepo.getMemberCount(roomId);
        ws.publish(roomId, {
          type: "USER_LEFT",
          payload: { userId, memberCount },
        });
      }
    },
  });
