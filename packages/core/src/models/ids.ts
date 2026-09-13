export type UserId = string;

export type ConversationId = string;

export type MessageId = string;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export type MessageStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";

export type OutboxStatus = "pending" | "processing" | "failed";
