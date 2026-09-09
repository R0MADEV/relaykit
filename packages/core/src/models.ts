export type UserId = string;
export type ConversationId = string;
export type MessageId = string;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
export type SyncStatus = "idle" | "syncing" | "synced" | "error";
export type MessageStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";
export type OutboxStatus = "pending" | "processing" | "failed";
export type PresenceState = "online" | "offline" | "unavailable";

export interface Session {
  readonly homeserver: string;
  readonly userId: UserId;
  readonly accessToken: string;
  readonly deviceId?: string;
}

export interface LoginCredentials {
  readonly homeserver: string;
  readonly username: string;
  readonly password: string;
  readonly deviceName?: string;
}

export interface User {
  readonly id: UserId;
  readonly displayName?: string;
  /** Opaque identifier of the current avatar. It changes when the avatar does, so it can be used as a cache key. */
  readonly avatarId?: string;
}

/** A message the application should tell the user about. The SDK decides what deserves attention, not how to show it. */
export interface Notification {
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly senderId: UserId;
  readonly body: string;
  /** True when the message names the user, which usually deserves a louder alert. */
  readonly isMention: boolean;
}

export interface AvatarImage {
  readonly data: Uint8Array;
  readonly mimeType: string;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly title?: string;
  readonly participantIds: readonly UserId[];
  readonly membership?: "join" | "invite";
  readonly lastMessage?: Message;
  /** True for one-to-one conversations opened with `conversations.open`. */
  readonly isDirect?: boolean;
  /** Messages received since the conversation was last marked as read. */
  readonly unreadCount?: number;
}

export interface CreateConversationInput {
  readonly participantIds: readonly UserId[];
  readonly title?: string;
  readonly encrypted?: boolean;
  /** Marks the conversation as a direct chat so other clients of the same account recognise it. */
  readonly direct?: boolean;
}

export interface MessagePage {
  /** The whole timeline known for the conversation, oldest first. */
  readonly messages: readonly Message[];
  /** True while older history remains on the server. False once the start of the conversation is reached. */
  readonly hasMore: boolean;
}

export interface MessageSearchOptions {
  readonly conversationId?: ConversationId;
}

/** Anything `media.download` can fetch. The source is opaque and adapter-specific, never a public URL. */
export interface MediaRef {
  readonly mimeType: string;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly source: string;
}

export interface Attachment extends MediaRef {
  readonly id: string;
  readonly name: string;
  /** A small preview, when the sender provided one. Downloading it avoids fetching the whole file. */
  readonly thumbnail?: MediaRef;
}

export interface ThumbnailInput {
  readonly mimeType: string;
  readonly data: Uint8Array;
  readonly width?: number;
  readonly height?: number;
}

export interface FileInput {
  readonly name: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
  readonly width?: number;
  readonly height?: number;
  /** The application decides how to make it, since only it knows how to render its own files. */
  readonly thumbnail?: ThumbnailInput;
}

export interface SendFileOptions {
  /** Upload progress between 0 and 1. Only reported for the initial send, not for retries after a restart. */
  readonly onProgress?: (fraction: number) => void;
}

export interface Message {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly senderId: UserId;
  readonly body: string;
  readonly createdAt: number;
  readonly status: MessageStatus;
  readonly transactionId?: string;
  readonly editedAt?: number;
  readonly deletedAt?: number;
  readonly attachment?: Attachment;
  /** The message this one replies to, if any. */
  readonly replyToId?: MessageId;
}

export interface SendMessageOptions {
  readonly replyTo?: MessageId;
}

export interface Reaction {
  readonly id: string;
  readonly messageId: MessageId;
  readonly senderId: UserId;
  readonly key: string;
  readonly createdAt: number;
}

export interface OutboxOperation {
  readonly id: string;
  readonly transactionId: string;
  readonly conversationId: ConversationId;
  readonly body: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly createdAt: number;
  readonly lastError?: string;
  readonly attachment?: FileInput;
  readonly replyToId?: MessageId;
}

export interface DeviceVerification {
  readonly userId: UserId;
  readonly deviceId: string;
  readonly verified: boolean;
  readonly signedByOwner: boolean;
  readonly crossSigningVerified: boolean;
  readonly locallyVerified: boolean;
}

export interface CryptoStatus {
  readonly crossSigningReady: boolean;
  readonly secretStorageReady: boolean;
}

export interface KeyBackupStatus {
  readonly activeVersion: string | null;
  readonly serverVersion?: string;
  readonly keyCount?: number;
  readonly trusted?: boolean;
  readonly matchesDecryptionKey?: boolean;
}

export type VerificationPhase = "requested" | "ready" | "started" | "sas" | "done" | "cancelled";

export interface VerificationEmoji {
  readonly symbol: string;
  readonly name: string;
}

export interface VerificationSas {
  readonly emoji: readonly VerificationEmoji[];
  readonly decimal?: readonly [number, number, number];
}

export interface VerificationSession {
  readonly id: string;
  readonly otherUserId: UserId;
  readonly otherDeviceId?: string;
  readonly initiatedByMe: boolean;
  readonly phase: VerificationPhase;
  /** Present while `phase` is `sas`: the user must compare it with the other device before confirming. */
  readonly sas?: VerificationSas;
  readonly cancellationReason?: string;
}

export interface RecoverySetupOptions {
  /** Account password, used only if the homeserver requires re-authentication to upload cross-signing keys. */
  readonly password?: string;
}

export interface RecoverySetup {
  /** Encoded recovery key. Show it to the user once and never persist it. */
  readonly recoveryKey: string;
}

export interface KeyBackupRestoreSummary {
  readonly total: number;
  readonly imported: number;
}

export interface PresenceUpdate {
  readonly presence: PresenceState;
  readonly statusMessage?: string;
}

export interface UserPresence extends PresenceUpdate {
  readonly userId: UserId;
  readonly lastActiveAt?: number;
}

export interface TypingUpdate {
  readonly conversationId: ConversationId;
  readonly userIds: readonly UserId[];
}

export interface ReadReceipt {
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly userId: UserId;
  readonly readAt: number;
}
