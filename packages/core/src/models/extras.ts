import type { ConversationId, MessageId, UserId } from "./ids.js";
import type { MediaRef } from "./messages.js";

/** Somebody telling where they are while they move, for a bounded while. */
export interface LiveLocation {
  /** The identifier it is stopped or updated with. */
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly sharedBy: UserId;
  /** Still telling. It stops being so when stopped, or when the while runs out. */
  readonly isLive: boolean;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly description?: string;
  /** The last thing said. Absent while nothing has been said yet. */
  readonly lastPosition?: GeoLocation;
}

export interface ShareLocationInput {
  /**
   * How long it will keep telling. Required on purpose: without an end, a slip leaves somebody sharing
   * where they are for ever.
   */
  readonly durationMs: number;
  readonly description?: string;
}

/** One possible answer of a poll, with what it has been voted. */
export interface PollAnswer {
  readonly id: string;
  readonly text: string;
  /** How many people chose it. Only the last vote of each one counts. */
  readonly votes: number;
}

export interface Poll {
  /** The identifier of the message that opened the poll. */
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly question: string;
  readonly answers: readonly PollAnswer[];
  readonly startedBy: UserId;
  readonly startedAt: number;
  /** A closed poll takes no more votes, and that cannot be undone. */
  readonly isClosed: boolean;
  /** What the person asking voted, so it can be drawn as chosen. */
  readonly ownAnswerId?: string;
}

export interface StartPollInput {
  readonly question: string;
  readonly answers: readonly string[];
  /** How many answers each person may choose. One, unless said otherwise. */
  readonly maxSelections?: number;
}

/** What the homeserver says about a link, to paint it without opening it. All optional: some pages say nothing. */
export interface LinkPreview {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  /** Descargable con `media.download`, como cualquier otra imagen. */
  readonly image?: MediaRef;
}

/** A place on the map, as degrees. */
export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly description?: string;
}
