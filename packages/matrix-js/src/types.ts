import type { AdapterHandlers, ConnectionStatus, SyncStatus } from "@relaykit/core";

export interface MatrixJsAdapterOptions {
  readonly initialSyncLimit?: number;
  readonly storeName?: string;
  /**
   * How many conversations to ask the homeserver for, most recent first, instead of all of them. An account
   * with thousands of conversations opens at once with this and takes many seconds without it. Asking for more
   * conversations widens the window. Left out, everything is asked for, which is how it has always worked.
   */
  readonly conversationWindow?: number;
  /**
   * Where conferences are carried, when the homeserver does not say. A homeserver in production advertises
   * it in its `.well-known`; a development machine has no `.well-known` to advertise anything, and without
   * this there would be no way to try a conference locally.
   */
  readonly conferenceServiceUrl?: string;
}

export type { AdapterHandlers, ConnectionStatus, SyncStatus };
