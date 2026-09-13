import type { ConversationId, MessageId, UserId } from "./ids.js";

export type PresenceState = "online" | "offline" | "unavailable";

export const presenceStates: readonly PresenceState[] = ["online", "offline", "unavailable"];

/** Homeservers reject a status longer than this, so it is caught here instead of coming back as a server error. */
export const maxStatusMessageLength = 512;

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

/** A session of this account, as shown in a "your devices" screen. */
export interface Device {
  readonly id: string;
  readonly displayName?: string;
  readonly lastSeenAt?: number;
  readonly lastSeenIp?: string;
  /** True for the device this client is running on. */
  readonly isCurrent: boolean;
}

/**
 * What a device tells the homeserver so it can be woken while the application is closed. The homeserver never
 * talks to the browser or the phone directly: it hands the notification to a push gateway, which is the address
 * in `gatewayUrl`, and the gateway finds the device by `deviceToken`.
 */
export interface PushRegistration {
  readonly gatewayUrl: string;
  /** The browser endpoint or the token the platform gave this device. */
  readonly deviceToken: string;
  readonly appId: string;
  readonly appName: string;
  readonly deviceName?: string;
  readonly language?: string;
  /** Anything else the gateway needs, such as the web push keys. */
  readonly data?: Readonly<Record<string, string>>;
}

export interface SearchUsersOptions {
  /** How many people to ask the homeserver for. Defaults to twenty, which fills a screen. */
  readonly limit?: number;
}

export interface AvatarOptions {
  /** The name somebody goes by can differ from one conversation to the next. */
  readonly conversationId?: ConversationId;
  /** Pixels. Asking for the size it will be shown at avoids downloading the original to throw it away. */
  readonly size?: number;
}

export interface PresenceUpdate {
  readonly presence: PresenceState;
  readonly statusMessage?: string;
}

export interface UserPresence extends PresenceUpdate {
  readonly userId: UserId;
  readonly lastActiveAt?: number;
}
