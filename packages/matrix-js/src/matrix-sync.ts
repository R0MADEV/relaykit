import { ClientEvent, IndexedDBStore, type MatrixClient } from "matrix-js-sdk";
import type { SlidingSync } from "matrix-js-sdk/lib/sliding-sync.js";
import type {
  AdapterHandlers,
  ConnectionStatus,
  MatrixJsAdapterOptions,
  SyncStatus
} from "./types.js";

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

export function waitForInitialSync(client: MatrixClient, limit: number, slidingSync?: SlidingSync): Promise<void> {
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
    client.startClient({ initialSyncLimit: limit, threadSupport: true, ...(slidingSync ? { slidingSync } : {}) });
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
