export type UserId = string;
export type ConversationId = string;
export type MessageId = string;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
export type SyncStatus = "idle" | "syncing" | "synced" | "error";
export type MessageStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";
export type OutboxStatus = "pending" | "processing" | "failed";
export type PresenceState = "online" | "offline" | "unavailable";

export const presenceStates: readonly PresenceState[] = ["online", "offline", "unavailable"];

/** Homeservers reject a status longer than this, so it is caught here instead of coming back as a server error. */
export const maxStatusMessageLength = 512;

export interface Session {
  readonly homeserver: string;
  readonly userId: UserId;
  readonly accessToken: string;
  readonly deviceId?: string;
}

export interface RegisterCredentials {
  readonly homeserver: string;
  readonly username: string;
  readonly password: string;
  readonly deviceName?: string;
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

/** Who may come in: only those invited, anybody, or anybody willing to ask first. */
export type JoinRule = "invite" | "public" | "knock";

export const joinRules: readonly JoinRule[] = ["invite", "public", "knock"];

/**
 * How far back somebody who arrives late can read: everything even without joining, everything from the moment
 * they were invited, everything from the moment they joined, or everything the conversation has ever said.
 */
export type HistoryVisibility = "world" | "shared" | "invited" | "joined";

export const historyVisibilities: readonly HistoryVisibility[] = ["world", "shared", "invited", "joined"];

/** A conversation found in the public list of a homeserver, which nobody has joined yet. */
export interface PublicConversation {
  readonly id: ConversationId;
  readonly title?: string;
  readonly topic?: string;
  readonly alias?: string;
  readonly participantCount: number;
  readonly joinRule?: JoinRule;
}

export interface KnockOptions {
  readonly reason?: string;
  /** Servers that already know the conversation, needed when it lives somewhere else. */
  readonly via?: readonly string[];
}

export interface SignOutOptions {
  /** Homeservers ask for the password again before closing other sessions. */
  readonly password?: string;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly title?: string;
  /** Everyone in the conversation, including those invited who have not accepted yet. */
  readonly participantIds: readonly UserId[];
  /** The subset of `participantIds` still waiting to accept the invitation. */
  readonly invitedIds?: readonly UserId[];
  /** People who asked to come in and are waiting for somebody to let them. They are not participants yet. */
  readonly knockingIds?: readonly UserId[];
  readonly joinRule?: JoinRule;
  /** A name people can type instead of the identifier, such as `#soporte:example.com`. */
  readonly alias?: string;
  /** When this conversation was replaced, the one that carries on from here. */
  readonly replacedBy?: ConversationId;
  /** When this conversation replaced another, the one it carries on from. */
  readonly replaces?: ConversationId;
  readonly historyVisibility?: HistoryVisibility;
  readonly membership?: "join" | "invite";
  readonly lastMessage?: Message;
  /** True for one-to-one conversations opened with `conversations.open`. */
  readonly isDirect?: boolean;
  /** Messages received since the conversation was last marked as read. */
  readonly unreadCount?: number;
  /** The messages kept to hand in this conversation, newest last. */
  readonly pinnedIds?: readonly MessageId[];
  /** The last message this person read, which is where the "new messages" line goes. */
  readonly lastReadMessageId?: MessageId;
  /** True when the person marked this conversation as a favourite. */
  readonly isFavourite?: boolean;
  /** True when the person put the conversation back to unread on purpose, having already read it. */
  readonly isUnread?: boolean;
  /** What the conversation is about, shown under its name. */
  readonly topic?: string;
  /** The picture of the conversation, downloadable with `media.download`. */
  readonly avatar?: MediaRef;
  /** How much this conversation is allowed to interrupt. Absent means everything, which is the default. */
  readonly notifications?: NotificationLevel;
  /**
   * Whether what is said here is end to end encrypted. This is what the conversation *is*, not what anybody
   * asked for: a homeserver can encrypt by policy without being asked, and encryption can never be taken back
   * off a conversation. Anything that depends on being able to read it later has to look at this.
   */
  readonly isEncrypted?: boolean;
}

/** A group of conversations, for organising them by team or by project. */
export interface Space {
  readonly id: ConversationId;
  readonly title?: string;
}

export interface CreateSpaceInput {
  readonly title: string;
}

export interface CreateConversationInput {
  readonly participantIds: readonly UserId[];
  readonly title?: string;
  readonly encrypted?: boolean;
  /** Marks the conversation as a direct chat so other clients of the same account recognise it. */
  readonly direct?: boolean;
  /** Anyone who knows the conversation can join it, instead of having to be invited. */
  readonly public?: boolean;
}

export interface JoinConversationOptions {
  /** Servers known to be in the conversation. Needed to join one hosted somewhere else. */
  readonly via?: readonly string[];
}

export interface MessagePage {
  /** The whole timeline known for the conversation, oldest first. */
  readonly messages: readonly Message[];
  /** True while older history remains on the server. False once the start of the conversation is reached. */
  readonly hasMore: boolean;
}

export interface ListConversationsOptions {
  /**
   * How many to give, the ones with the most recent activity first. A screen with thousands of conversations
   * paints the first few and asks for more as somebody scrolls. Left out, all of them.
   */
  readonly limit?: number;
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

export interface PendingNotificationsOptions {
  /** How many to ask the homeserver for. Defaults to fifty, which is more than any screen shows at once. */
  readonly limit?: number;
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

/** Alguien contando donde esta mientras se mueve, durante un rato acotado. */
export interface LiveLocation {
  /** El identificador con el que se para o se actualiza. */
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly sharedBy: UserId;
  /** Sigue contando. Deja de estarlo al pararla o al agotarse el rato. */
  readonly isLive: boolean;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly description?: string;
  /** Lo ultimo que se dijo. Ausente mientras no se haya dicho nada todavia. */
  readonly lastPosition?: GeoLocation;
}

export interface ShareLocationInput {
  /**
   * Cuanto rato se va a ir contando. Es obligatorio a proposito: sin un final, un descuido deja a alguien
   * compartiendo donde esta para siempre.
   */
  readonly durationMs: number;
  readonly description?: string;
}

/** Una respuesta posible de una encuesta, con lo que lleva votado. */
export interface PollAnswer {
  readonly id: string;
  readonly text: string;
  /** Cuantas personas la han elegido. Solo cuenta el ultimo voto de cada una. */
  readonly votes: number;
}

export interface Poll {
  /** El identificador del mensaje que abrio la encuesta. */
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly question: string;
  readonly answers: readonly PollAnswer[];
  readonly startedBy: UserId;
  readonly startedAt: number;
  /** Una encuesta cerrada ya no admite votos, y eso no se puede deshacer. */
  readonly isClosed: boolean;
  /** Lo que voto quien pregunta, para poder pintarlo marcado. */
  readonly ownAnswerId?: string;
}

export interface StartPollInput {
  readonly question: string;
  readonly answers: readonly string[];
  /** Cuantas respuestas puede elegir cada persona. Una, si no se dice otra cosa. */
  readonly maxSelections?: number;
}

/** Lo que el homeserver cuenta de un enlace, para pintarlo sin abrirlo. Todo es opcional: hay paginas que no dicen nada. */
export interface LinkPreview {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  /** Descargable con `media.download`, como cualquier otra imagen. */
  readonly image?: MediaRef;
}

export interface MediaRef {
  readonly mimeType: string;
  /**
   * Los colores de la imagen en una cadena corta, para pintar algo en su sitio mientras llega la de verdad.
   * Evita que una lista de fotos salte al cargarse, porque el hueco ya tiene el tamano y el color que tendra.
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

/** A place on the map, as degrees. */
export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly description?: string;
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
  /** Una pegatina: se pinta sola, y viaja como `m.sticker` en vez de como adjunto. */
  readonly sticker?: boolean;
  /** Ver `MediaRef.blurhash`. Lo calcula quien envia; aqui solo viaja. */
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
}

/** `sticker` es una imagen que se pinta sola: sin nombre de fichero ni boton de descarga. */
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

export type ConversationRole = "member" | "moderator" | "admin";

/** How much a conversation may interrupt: everything, only when named, or nothing at all. */
export type NotificationLevel = "all" | "mentions" | "none";
export const notificationLevels: readonly NotificationLevel[] = ["all", "mentions", "none"];

/** What the person is allowed to do in a conversation right now. */
export interface ConversationPermissions {
  readonly canSend: boolean;
  readonly canInvite: boolean;
  readonly canRemove: boolean;
  readonly canBan: boolean;
  readonly canRename: boolean;
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

/** Comparing emoji on both screens, or showing a code for the other device to scan. */
export type VerificationMethod = "emoji" | "code";

export const verificationMethods: readonly VerificationMethod[] = ["emoji", "code"];

export interface VerificationRequestOptions {
  /** Defaults to comparing emoji, which every device can do. */
  readonly method?: VerificationMethod;
  /**
   * Where to verify another person, which in Matrix happens inside a conversation the two of them share.
   * Left out, the direct conversation with them is used, and opened if there is not one yet.
   */
  readonly conversationId?: ConversationId;
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
