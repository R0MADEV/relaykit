import type { ConversationId, MessageId, UserId } from "./ids.js";
import type { MediaRef, Message } from "./messages.js";

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

export interface ListConversationsOptions {
  /**
   * How many to give, the ones with the most recent activity first. A screen with thousands of conversations
   * paints the first few and asks for more as somebody scrolls. Left out, all of them.
   */
  readonly limit?: number;
}

export interface PendingNotificationsOptions {
  /** How many to ask the homeserver for. Defaults to fifty, which is more than any screen shows at once. */
  readonly limit?: number;
}

export type ConversationRole = "member" | "moderator" | "admin";

export const conversationRoles: readonly ConversationRole[] = ["member", "moderator", "admin"];

/** Where somebody stands with a conversation: in it, asked, waiting to be let in, gone, or shut out. */
export type ParticipantMembership = "join" | "invite" | "knock" | "leave" | "ban";

/**
 * Somebody a conversation knows about, and what they are in it.
 *
 * `participantIds` says who is there; this says what each of them is, which is what anybody moderating has to
 * know. It includes people who are not in it — invited, waiting, banned — because letting somebody back in is
 * something only a list that still has them in it can offer.
 */
export interface Participant {
  readonly userId: UserId;
  readonly role: ConversationRole;
  readonly membership: ParticipantMembership;
  /**
   * Whether whoever is asking outranks them.
   *
   * Nobody may remove, ban or re-rank somebody at or above their own standing — not even themselves — and
   * working that out means knowing what the roles are worth, which is the adapter's business and not a
   * screen's. A button that always fails is worse than no button.
   */
  readonly isUnderMe: boolean;
}

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

export interface TypingUpdate {
  readonly conversationId: ConversationId;
  readonly userIds: readonly UserId[];
}

/** The room versions a homeserver admits, and the one it would give a new conversation. */
export interface RoomVersions {
  readonly preferred: string;
  readonly available: readonly string[];
}

/** A conversation inside a space, and how far down it sits. */
export interface SpaceChild {
  readonly conversationId: ConversationId;
  readonly title?: string;
  /** How many spaces down from the one that was asked about. One means directly inside it. */
  readonly depth: number;
  /** Whether the space suggests it as somewhere to start. */
  readonly suggested?: boolean;
}
