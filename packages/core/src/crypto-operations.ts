import { RelayKitError } from "./errors.js";
import type { MessagingAdapter, CryptoAdapter } from "./adapter.js";
import type {
  CryptoStatus,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  KeyStanding,
  RecoverySetup,
  RecoverySetupOptions
} from "./models.js";

export interface CryptoOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class CryptoOperations {
  constructor(private readonly context: CryptoOperationsContext) {}

  async status(): Promise<CryptoStatus> {
    this.context.assertStarted();
    return this.crypto.getCryptoStatus();
  }

  async backupStatus(): Promise<KeyBackupStatus> {
    this.context.assertStarted();
    return this.crypto.getKeyBackupStatus();
  }

  /**
   * How the keys of this device stand, from the two answers that decide it.
   *
   * Asked together because neither one answers it alone: a device can be trusted and still not hold the key
   * to the backup, and a backup can exist for an account whose newest device has never been let in.
   */
  async standing(): Promise<KeyStanding> {
    this.context.assertStarted();
    const [status, backup] = await Promise.all([
      this.crypto.getCryptoStatus(),
      this.crypto.getKeyBackupStatus()
    ]);
    return keyStanding(status, backup);
  }

  async setupRecovery(options: RecoverySetupOptions = {}): Promise<RecoverySetup> {
    this.context.assertStarted();
    try {
      return await this.crypto.setupRecovery(options);
    } catch (error) {
      throw adapterError("Recovery could not be set up", error);
    }
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    this.context.assertStarted();
    if (!recoveryKey.trim()) {
      throw new RelayKitError("INVALID_INPUT", "Recovery key cannot be empty");
    }
    try {
      return await this.crypto.recover(recoveryKey.trim());
    } catch (error) {
      throw adapterError("The recovery key could not restore the backup", error);
    }
  }

  /** The one place that answers whether this adapter does this at all. */
  private get crypto(): CryptoAdapter {
    const crypto = this.context.adapter.crypto;
    if (!crypto) throw new RelayKitError("NOT_SUPPORTED", "Cryptography is not something this adapter does");
    return crypto;
  }
}

function adapterError(summary: string, error: unknown): RelayKitError {
  if (error instanceof RelayKitError) return error;
  const reason = error instanceof Error ? error.message : String(error);
  return new RelayKitError("ADAPTER_ERROR", `${summary}: ${reason}`);
}

/** The decision itself, apart from the asking, because it is the part worth being sure about. */
export function keyStanding(status: CryptoStatus, backup: KeyBackupStatus): KeyStanding {
  // Nothing on the server to be let into, and nothing backed up: this account has never protected anything.
  const nothingWasEverProtected = !status.secretStorageReady && backup.activeVersion === null;
  if (nothingWasEverProtected) return "never-protected";
  // A backup exists and this device cannot read it. Being a trusted device is not the same as holding the key.
  const cannotReadTheBackup = backup.activeVersion !== null && backup.matchesDecryptionKey !== true;
  if (cannotReadTheBackup) return "locked";
  // Or there is a recovery and this device was never let into it, whatever it holds.
  if (!status.crossSigningReady) return "locked";
  return "ready";
}
