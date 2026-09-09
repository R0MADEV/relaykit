import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type { Session } from "./models.js";

export interface CacheOptions {
  /**
   * How many delivered messages of a conversation to keep locally. Older ones are dropped and fetched again
   * with `messages.loadMore` if the user scrolls back. Messages still waiting to be sent are never dropped.
   */
  readonly messagesPerConversation?: number;
}

export interface MessagingClientConfig {
  readonly adapter?: MessagingAdapter;
  readonly session?: Session;
  readonly storage?: MessagingStorage;
  readonly cache?: CacheOptions;
}
