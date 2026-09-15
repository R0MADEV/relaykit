/**
 * Staying alive through a rejection matrix-js-sdk made and did not catch.
 *
 * While it syncs, the SDK goes looking for the root of every thread it sees. A homeserver answers 403 for one
 * in a room whose history this account cannot read, and 404 for one that was redacted — and the promise that
 * asked is not caught anywhere. In a browser that is a line in the console; in node it takes the process with
 * it, which is how a script that was about to say one sentence dies before saying it.
 *
 * Nothing here asked for those requests and nothing here can wrap them, so they are noted and stepped over.
 * Said once, in one place, because every script that drives a real homeserver from node needs it.
 */
export function surviveWhatTheSdkThrows() {
  process.on("unhandledRejection", error => {
    const said = error instanceof Error ? error.message : String(error);
    console.error(`stepped over a rejection nothing here asked for: ${said}`);
  });
}

/**
 * How much history a script needs, which is almost none.
 *
 * A script that says one sentence does not need every conversation an account has ever been in. Asking for
 * them is slow, and it is what sends the SDK looking through hundreds of threads it will be refused.
 */
export const barelyAnyHistory = { conversationWindow: 1, initialSyncLimit: 1 };
