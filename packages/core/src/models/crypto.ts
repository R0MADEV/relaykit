import type { ConversationId, UserId } from "./ids.js";

export interface DeviceVerification {
  readonly userId: UserId;
  readonly deviceId: string;
  readonly verified: boolean;
  readonly signedByOwner: boolean;
  readonly crossSigningVerified: boolean;
  readonly locallyVerified: boolean;
}

export interface CryptoStatus {
  readonly crossSigningReady: boolean;
  readonly secretStorageReady: boolean;
}

export interface KeyBackupStatus {
  readonly activeVersion: string | null;
  readonly serverVersion?: string;
  readonly keyCount?: number;
  readonly trusted?: boolean;
  readonly matchesDecryptionKey?: boolean;
}

export type VerificationPhase = "requested" | "ready" | "started" | "sas" | "done" | "cancelled";

export interface VerificationEmoji {
  readonly symbol: string;
  readonly name: string;
}

export interface VerificationSas {
  readonly emoji: readonly VerificationEmoji[];
  readonly decimal?: readonly [number, number, number];
}

export interface VerificationSession {
  readonly id: string;
  readonly otherUserId: UserId;
  readonly otherDeviceId?: string;
  readonly initiatedByMe: boolean;
  readonly phase: VerificationPhase;
  /** Present while `phase` is `sas`: the user must compare it with the other device before confirming. */
  readonly sas?: VerificationSas;
  readonly cancellationReason?: string;
}

/** Comparing emoji on both screens, or showing a code for the other device to scan. */
export type VerificationMethod = "emoji" | "code";

export const verificationMethods: readonly VerificationMethod[] = ["emoji", "code"];

export interface VerificationRequestOptions {
  /** Defaults to comparing emoji, which every device can do. */
  readonly method?: VerificationMethod;
  /**
   * Where to verify another person, which in Matrix happens inside a conversation the two of them share.
   * Left out, the direct conversation with them is used, and opened if there is not one yet.
   */
  readonly conversationId?: ConversationId;
}

export interface RecoverySetupOptions {
  /** Account password, used only if the homeserver requires re-authentication to upload cross-signing keys. */
  readonly password?: string;
}

export interface RecoverySetup {
  /** Encoded recovery key. Show it to the user once and never persist it. */
  readonly recoveryKey: string;
}

export interface KeyBackupRestoreSummary {
  readonly total: number;
  readonly imported: number;
}
