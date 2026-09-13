import { SdkError } from "./errors.js";
import type { MessagingAdapter, CryptoAdapter } from "./adapter.js";
import type {
  CryptoStatus,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
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
      throw new SdkError("INVALID_INPUT", "Recovery key cannot be empty");
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
    if (!crypto) throw new SdkError("NOT_SUPPORTED", "Cryptography is not something this adapter does");
    return crypto;
  }
}

function adapterError(summary: string, error: unknown): SdkError {
  if (error instanceof SdkError) return error;
  const reason = error instanceof Error ? error.message : String(error);
  return new SdkError("ADAPTER_ERROR", `${summary}: ${reason}`);
}
