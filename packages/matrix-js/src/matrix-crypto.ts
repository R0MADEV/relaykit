import { SdkError } from "@relaykit/core";
import type {
  ConversationId,
  CryptoAdapter,
  CryptoStatus,
  DeviceVerification,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  RecoverySetup,
  RecoverySetupOptions,
  VerificationRequestOptions,
  VerificationSession
} from "@relaykit/core";
import { withTranslatedErrors } from "./matrix-errors.js";
import {
  getCryptoStatus,
  getDeviceVerification,
  getKeyBackupStatus,
  recoverWithKey,
  setDeviceVerified,
  setupRecovery
} from "./matrix-security.js";
import type { MatrixRuntime } from "./matrix-runtime.js";

/**
 * The cryptography half of the Matrix adapter: whether a device is who it says it is, what is backed up,
 * and the back and forth of proving it between two people.
 *
 * Apart from the adapter because none of it is messaging. Every answer goes out through the same translation
 * of homeserver errors as the rest, so no Matrix detail reaches whoever asked.
 */
export class MatrixCrypto implements CryptoAdapter {
  constructor(private readonly runtime: MatrixRuntime) {}

  /**
   * Throwing away the key a conversation is encrypted with, so what is said next cannot be read with it.
   * Reached for first, because a conversation outside the synced window is not held locally yet.
   */
  rotateConversationKeys(conversationId: ConversationId): Promise<void> {
    return withTranslatedErrors(async () => {
      await this.runtime.reachFor(conversationId);
      const crypto = this.runtime.getClient().getCrypto();
      if (!crypto) throw new SdkError("NOT_CONFIGURED", "This session has no encryption");
      await crypto.forceDiscardSession(conversationId);
    });
  }

  async getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification | undefined> {
    return getDeviceVerification(this.runtime.getClient(), userId, deviceId);
  }

  async setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void> {
    await withTranslatedErrors(() => setDeviceVerified(this.runtime.getClient(), userId, deviceId, verified));
  }

  async getCryptoStatus(): Promise<CryptoStatus> {
    return getCryptoStatus(this.runtime.getClient());
  }

  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    return getKeyBackupStatus(this.runtime.getClient());
  }

  async setupRecovery(options: RecoverySetupOptions): Promise<RecoverySetup> {
    return withTranslatedErrors(() =>
      setupRecovery(this.runtime.getClient(), this.runtime.secretStorageKeys, options)
    );
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    return withTranslatedErrors(() =>
      recoverWithKey(this.runtime.getClient(), this.runtime.secretStorageKeys, recoveryKey)
    );
  }

  requestVerification(
    userId: string,
    deviceId?: string,
    options?: VerificationRequestOptions
  ): Promise<VerificationSession> {
    return withTranslatedErrors(() => this.runtime.verification.request(userId, deviceId, options));
  }

  getVerificationQrCode(sessionId: string): Promise<Uint8Array | undefined> {
    return withTranslatedErrors(() => this.runtime.verification.qrCode(sessionId));
  }

  scanVerificationQrCode(sessionId: string, code: Uint8Array): Promise<VerificationSession> {
    return withTranslatedErrors(() => this.runtime.verification.scan(sessionId, code));
  }

  acceptVerification(sessionId: string): Promise<VerificationSession> {
    return withTranslatedErrors(() => this.runtime.verification.accept(sessionId));
  }

  /** Cancelling is the one that does not go through the translation: it is this side giving up, not a refusal. */
  cancelVerification(sessionId: string): Promise<VerificationSession> {
    return this.runtime.verification.cancel(sessionId);
  }

  confirmVerification(sessionId: string): Promise<VerificationSession> {
    return withTranslatedErrors(() => this.runtime.verification.confirm(sessionId));
  }

  rejectVerification(sessionId: string): Promise<VerificationSession> {
    return withTranslatedErrors(() => this.runtime.verification.reject(sessionId));
  }
}
