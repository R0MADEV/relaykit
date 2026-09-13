import type {
  ConversationId,
  CryptoAdapter,
  CryptoStatus,
  DeviceVerification,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  RecoverySetup,
  VerificationRequestOptions,
  VerificationSession
} from "@relaykit/core";
import type { InMemoryFeatures } from "./in-memory-features.js";
import type { InMemoryVerification } from "./in-memory-verification.js";

/**
 * The cryptography of the double, which is two things wearing one name.
 *
 * What is backed up and whether a device is trusted comes from the features; the back and forth of proving
 * it between two people is its own small state machine. The port asks for both together, so this is where
 * they are put together — and the only place that knows they came from different halves.
 */
export class InMemoryCrypto implements CryptoAdapter {
  private readonly rotated: ConversationId[] = [];

  constructor(
    private readonly features: InMemoryFeatures,
    private readonly verification: InMemoryVerification,
    /** Refuses a conversation that is not here, the same as every other thing done to one. */
    private readonly requireConversation: (conversationId: ConversationId) => unknown
  ) {}

  /** Kept rather than done: there is no key here to throw away, only the fact that it was asked for. */
  async rotateConversationKeys(conversationId: ConversationId): Promise<void> {
    this.requireConversation(conversationId);
    this.rotated.push(conversationId);
  }

  /** Test helper: the conversations somebody asked to have the key thrown away for, in order. */
  rotatedKeys(): readonly ConversationId[] {
    return this.rotated;
  }

  async getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification> {
    return this.features.getDeviceVerification(userId, deviceId);
  }

  async setDeviceVerified(): Promise<void> {
    return this.features.setDeviceVerified();
  }

  async getCryptoStatus(): Promise<CryptoStatus> {
    return this.features.getCryptoStatus();
  }

  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    return this.features.getKeyBackupStatus();
  }

  async setupRecovery(): Promise<RecoverySetup> {
    return this.features.setupRecovery();
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    return this.features.recover(recoveryKey);
  }

  async requestVerification(
    userId: string,
    deviceId?: string,
    options?: VerificationRequestOptions
  ): Promise<VerificationSession> {
    return this.verification.request(userId, deviceId, options);
  }

  async getVerificationQrCode(sessionId: string): Promise<Uint8Array | undefined> {
    return this.verification.qrCode(sessionId);
  }

  async scanVerificationQrCode(sessionId: string, code: Uint8Array): Promise<VerificationSession> {
    return this.verification.scan(sessionId, code);
  }

  async acceptVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.accept(sessionId);
  }

  async cancelVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.cancel(sessionId);
  }

  async confirmVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.confirm(sessionId);
  }

  async rejectVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.reject(sessionId);
  }
}
