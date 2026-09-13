import type { GeoLocation } from "./extras.js";
import type { ConversationId, MessageId, MessageStatus, OutboxStatus, UserId } from "./ids.js";

export interface MessagePage {
  /** The whole timeline known for the conversation, oldest first. */
  readonly messages: readonly Message[];
  /** True while older history remains on the server. False once the start of the conversation is reached. */
  readonly hasMore: boolean;
}

export interface ListMessagesOptions {
  /**
   * How many messages are enough to read. When the conversation has more and fewer are here, older ones are
   * fetched until there are this many. Lets an application ask the homeserver for little on the way in and
   * still open a conversation with something to read.
   */
  readonly atLeast?: number;
}

export interface MessageSearchOptions {
  readonly conversationId?: ConversationId;
  /**
   * How many matches are enough. Searching reads and decrypts local history, so it stops as soon as it has
   * this many, walking from the conversation with the most recent activity. Defaults to fifty.
   */
  readonly limit?: number;
}

/** Anything `media.download` can fetch. The source is opaque and adapter-specific, never a public URL. */
export interface MarkReadOptions {
  /** Moves this person's own marker without telling the others, for whoever does not want to be seen reading. */
  readonly private?: boolean;
  /** Reading inside a thread, which leaves the rest of the conversation as unread as it was. */
  readonly threadId?: MessageId;
  /**
   * The conversation this message invites into, when it carries a link to one.
   *
   * Read off the link rather than off a shape invented here, so an invitation written by any other client
   * is understood too. What a screen does with it — a card with a way in, rather than a line of text — is
   * its own business.
   */
  readonly invitesTo?: ConversationId;
}

/** What hangs off one message, for a list of threads that does not open each one to find out. */
export interface ThreadSummary {
  readonly conversationId: ConversationId;
  readonly rootId: MessageId;
  /** How many answers hang from it, not counting the message they hang from. */
  readonly replyCount: number;
  readonly lastMessage?: Message;
  /** Answers that arrived after this person last read the thread. */
  readonly unreadCount?: number;
  /** The last answer this person read here, which is where the "new" line goes inside the thread. */
  readonly lastReadMessageId?: MessageId;
}

/**
 * Being asked to pass a call on. Whoever transferred it has already hung up: what arrives is the name of the
 * person to ring instead, and ringing them is a decision, not something that should happen by itself.
 */
/** What the homeserver will accept. Asked once and kept: it does not change while somebody is using it. */
export interface MediaLimits {
  readonly maxUploadBytes: number;
}

export interface MediaRef {
  readonly mimeType: string;
  /**
   * The colours of the image in a short string, to paint something in its place while the real one arrives.
   * Stops a list of photos jumping as it loads, because the gap already has the size and colour it will have.
   */
  readonly blurhash?: string;
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
  /** Present when the file is a voice note rather than an ordinary audio file. */
  readonly voice?: VoiceInfo;
}

/** What a voice note needs so it can be drawn and timed before anybody presses play. */
export interface VoiceInfo {
  readonly durationMs: number;
  /** How loud it is along the way, which is what draws the little bars. */
  readonly waveform?: readonly number[];
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
  /** Sending this makes it a voice note instead of a file somebody happened to record. */
  readonly voice?: VoiceInfo;
  /** A sticker: it draws itself, and travels as `m.sticker` rather than as an attachment. */
  readonly sticker?: boolean;
  /** See `MediaRef.blurhash`. Whoever sends works it out; here it only travels. */
  readonly blurhash?: string;
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
  /** Present when the message is a place on the map rather than something said. */
  readonly location?: GeoLocation;
  /** The message this one replies to, if any. */
  readonly replyToId?: MessageId;
  /** True when the message arrived encrypted and this device has no key for it. Its body is empty. */
  readonly undecryptable?: boolean;
  /** The message this one hangs from, when it is part of a thread. */
  readonly threadId?: MessageId;
  /** The same text with formatting, as HTML. The plain `body` always says the same thing. */
  readonly formattedBody?: string;
  /** Who the message is aimed at, so an interface can highlight it. */
  readonly mentions?: Mentions;
  /** Plain talk unless it is an action ("/me") or a notice, which usually comes from a program. */
  readonly kind?: MessageKind;
  /**
   * What people left on this message, oldest first. Absent when nobody left anything.
   *
   * They arrive with the message rather than being asked for one message at a time: they travel in the
   * same timeline, so a screen that opens a conversation already has them and does not have to ask again
   * once per line. What arrives afterwards comes as `reaction.added` and `reaction.removed`.
   */
  readonly reactions?: readonly Reaction[];
}

/** `sticker` is an image that draws itself: no file name and no download button. */
export type MessageKind = "action" | "notice" | "sticker";

/** Everything an adapter needs to put a message on the wire. */
export interface SendContent {
  readonly transactionId?: string;
  readonly location?: GeoLocation;
  readonly replyToId?: MessageId;
  readonly threadId?: MessageId;
  readonly formattedBody?: string;
  readonly mentions?: Mentions;
  readonly kind?: MessageKind;
}

export interface Mentions {
  readonly userIds?: readonly UserId[];
  /** True when the message is aimed at everyone in the conversation. */
  readonly everyone?: boolean;
}

export interface SendMessageOptions {
  readonly replyTo?: MessageId;
  readonly formattedBody?: string;
  readonly mentions?: Mentions;
  readonly kind?: MessageKind;
  /** Hangs the message from another one, so it reads as a thread instead of filling the conversation. */
  readonly threadId?: MessageId;
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
  readonly threadId?: MessageId;
  readonly formattedBody?: string;
  readonly mentions?: Mentions;
  readonly kind?: MessageKind;
}

export interface ReadReceipt {
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly userId: UserId;
  readonly readAt: number;
}
