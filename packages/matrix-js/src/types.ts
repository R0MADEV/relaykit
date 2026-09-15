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
   * Whether starting should go through the conversations from before calls existed and open the ones this
   * account is allowed to open.
   *
   * Off by default, and deliberately: `start()` is asked to start, and writing state into other people's
   * conversations is not what anybody expects it to do — on an account with hundreds it is hundreds of
   * writes that nobody asked for. A conversation is opened anyway at the moment somebody who may do it
   * actually places a call in it, which is the only moment it matters to them.
   *
   * Turn it on for a deployment where the first person to try a call is usually not an administrator: the
   * one thing the lazy path cannot fix is somebody being refused with no administrator ever finding out.
   */
  readonly prepareOldConversationsForCalls?: boolean;
  /**
   * Where conferences are carried, when the homeserver does not say. A homeserver in production advertises
   * it in its `.well-known`; a development machine has no `.well-known` to advertise anything, and without
   * this there would be no way to try a conference locally.
   */
  readonly conferenceServiceUrl?: string;
}

export type { AdapterHandlers, ConnectionStatus, SyncStatus };
