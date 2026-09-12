import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type { Session } from "./models.js";

export interface CacheOptions {
  /**
   * How many delivered messages of a conversation to keep locally. Older ones are dropped and fetched again
   * with `messages.loadMore` if the user scrolls back. Messages still waiting to be sent are never dropped.
   */
  readonly messagesPerConversation?: number;
  /**
   * How many bytes of downloaded attachments to keep in memory, so opening the same file twice does not fetch
   * and decrypt it twice. Zero turns it off. The oldest is dropped first.
   */
  readonly downloadedBytes?: number;
  /**
   * How many conversations to keep locally. The ones with the most recent activity are kept; a conversation
   * with something still waiting to be sent is never dropped. Left out, nothing is dropped.
   */
  readonly conversations?: number;
  /**
   * How many bytes of people's pictures to keep in memory, so a list that repaints does not fetch the same
   * faces again. Zero turns it off. The oldest is dropped first. Defaults to eight megabytes.
   */
  readonly avatarBytes?: number;
  /**
   * How many message identifiers to remember so the same message is not announced twice. Older ones are
   * forgotten; anything that far back will not arrive again in the same session. Defaults to ten thousand.
   */
  readonly seenMessages?: number;
}

export interface MessagingClientConfig {
  readonly adapter?: MessagingAdapter;
  readonly session?: Session;
  readonly storage?: MessagingStorage;
  readonly cache?: CacheOptions;
  /** Only for tests: lets them move time without waiting for it. */
  readonly now?: () => number;
}
