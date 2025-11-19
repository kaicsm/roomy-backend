export type WsMessageType = "UPDATE_PLAYBACK" | "SYNC_REQUEST";

export type WsIncomingMessage = {
  type: WsMessageType;
  payload?: any;
};

export type WsOutgoingMessage =
  | { type: "PLAYBACK_UPDATED"; payload: any }
  | { type: "USER_JOINED"; payload: { userId: string; memberCount: number } }
  | { type: "USER_LEFT"; payload: { userId: string; memberCount: number } }
  | { type: "ERROR"; payload: string };
