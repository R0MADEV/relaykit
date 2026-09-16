import { ClientEvent, IndexedDBStore, type MatrixClient } from "matrix-js-sdk";
import type { SlidingSync } from "matrix-js-sdk/lib/sliding-sync.js";
import type { AdapterHandlers, ConnectionStatus, MatrixJsAdapterOptions, SyncStatus } from "./types.js";

export function createBrowserStore(
  options: MatrixJsAdapterOptions,
  userId: string,
  deviceId: string | undefined
): IndexedDBStore | undefined {
  if (typeof indexedDB === "undefined" || !deviceId) {
    return undefined;
  }

  return new IndexedDBStore({
    indexedDB,
    dbName: `${options.storeName ?? "relaykit-matrix"}-${userId}-${deviceId ?? "unknown-device"}`
  });
}

export function handleSync(state: string, handlers: AdapterHandlers): void {
  handlers.onConnectionChanged?.(connectionStatusFor(state));
  handlers.onSyncChanged?.(syncStatusFor(state));
}

export function waitForInitialSync(
  client: MatrixClient,
  limit: number,
  slidingSync?: SlidingSync
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSync = (state: string) => {
      if (state === "PREPARED" || state === "SYNCING") {
        cleanup();
        resolve();
      }
      if (state === "ERROR") {
        cleanup();
        reject(new Error("Matrix initial sync failed"));
      }
      // Somebody stopped the client while it was catching up. Without this the promise would never settle and
      // whoever awaited it would wait for ever.
      if (state === "STOPPED") {
        cleanup();
        reject(new Error("The client was stopped while catching up"));
      }
    };
    const cleanup = () => client.removeListener(ClientEvent.Sync, onSync);

    client.on(ClientEvent.Sync, onSync);
    // Without thread support the SDK keeps no threads of its own, and what hangs off a message can only be
    // found by asking about that message: a list of threads would be a request per thread.
    client.startClient({
      initialSyncLimit: limit,
      threadSupport: true,
      ...(slidingSync ? { slidingSync } : {})
    });
  });
}

function connectionStatusFor(state: string): ConnectionStatus {
  if (state === "RECONNECTING") {
    return "reconnecting";
  }
  if (state === "STOPPED" || state === "ERROR") {
    return "disconnected";
  }
  return "connected";
}

function syncStatusFor(state: string): SyncStatus {
  if (state === "ERROR") {
    return "error";
  }
  if (state === "SYNCING") {
    return "syncing";
  }
  if (state === "PREPARED") {
    return "synced";
  }
  return "idle";
}

/**
 * Takes away the databases one session left in a browser.
 *
 * Three of them, all named after the device: the sync copy, the crypto store and its metadata. Named after the
 * device because two sessions of the same person must never share keys — which also means nobody else will
 * ever open them again once this one is over. Nothing deleted them, so a browser signed in and out of a few
 * times ends up holding dozens, every one still carrying the keys it had.
 *
 * `clearStores` is the SDK's own and knows where they all are, except the rust crypto store, which is found by
 * the prefix it was created under. And the client has to be stopped first: the SDK refuses otherwise, because
 * a sync still in flight would write the database straight back.
 */
export async function takeTheDatabasesAway(
  client: Pick<MatrixClient, "stopClient" | "clearStores">,
  cryptoDatabasePrefix: string | undefined
): Promise<void> {
  client.stopClient();
  // Said, never thrown: the session is over either way, and a browser that will not let go of a database is
  // not a reason to leave somebody signed in.
  await client
    .clearStores(cryptoDatabasePrefix === undefined ? {} : { cryptoDatabasePrefix })
    .catch(() => undefined);
}
