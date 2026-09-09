import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { CryptoStatus, KeyBackupRestoreSummary, KeyBackupStatus, RecoverySetup, RecoverySetupOptions } from "./models.js";

export interface CryptoOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class CryptoOperations {
  constructor(private readonly context: CryptoOperationsContext) {}

  async status(): Promise<CryptoStatus> {
    this.context.assertStarted();
    return this.context.adapter.getCryptoStatus();
  }

  async backupStatus(): Promise<KeyBackupStatus> {
    this.context.assertStarted();
    return this.context.adapter.getKeyBackupStatus();
  }

  async setupRecovery(options: RecoverySetupOptions = {}): Promise<RecoverySetup> {
    this.context.assertStarted();
    try {
      return await this.context.adapter.setupRecovery(options);
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
      return await this.context.adapter.recover(recoveryKey.trim());
    } catch (error) {
      throw adapterError("The recovery key could not restore the backup", error);
    }
  }
}

function adapterError(summary: string, error: unknown): SdkError {
  if (error instanceof SdkError) return error;
  const reason = error instanceof Error ? error.message : String(error);
  return new SdkError("ADAPTER_ERROR", `${summary}: ${reason}`);
}
