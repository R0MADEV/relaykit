import type { AdapterHandlers, ConnectionStatus, SyncStatus } from "@relaykit/core";

export interface MatrixJsAdapterOptions {
  readonly initialSyncLimit?: number;
  readonly storeName?: string;
}

export type { AdapterHandlers, ConnectionStatus, SyncStatus };
