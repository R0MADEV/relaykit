import { SecretStorage, type AuthDict, type MatrixClient } from "matrix-js-sdk";
import type { CryptoCallbacks } from "matrix-js-sdk/lib/crypto-api/index.js";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import type {
  CryptoStatus,
  DeviceVerification,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  RecoverySetup,
  RecoverySetupOptions
} from "@relaykit/core";

/**
 * Holds the secret storage private key only for the duration of a recovery operation.
 * matrix-js-sdk asks for it through `cryptoCallbacks.getSecretStorageKey`.
 */
export class SecretStorageKeyHolder {
  private privateKey: Uint8Array<ArrayBuffer> | undefined;

  readonly callbacks: CryptoCallbacks = {
    getSecretStorageKey: async ({ keys }) => {
      const privateKey = this.privateKey;
      if (!privateKey) return null;
      for (const [keyId, description] of Object.entries(keys)) {
        if (await matchesKeyDescription(privateKey, description)) return [keyId, privateKey];
      }
      return null;
    }
  };

  async use<T>(privateKey: Uint8Array<ArrayBuffer>, task: () => Promise<T>): Promise<T> {
    this.privateKey = privateKey;
    try {
      return await task();
    } finally {
      this.privateKey = undefined;
    }
  }
}

function requireCrypto(client: MatrixClient) {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Matrix crypto is not initialized");
  return crypto;
}

export async function getDeviceVerification(
  client: MatrixClient,
  userId: string,
  deviceId: string
): Promise<DeviceVerification | undefined> {
  const status = await requireCrypto(client).getDeviceVerificationStatus(userId, deviceId);
  if (!status) return undefined;
  return {
    userId,
    deviceId,
    verified: status.isVerified(),
    signedByOwner: status.signedByOwner,
    crossSigningVerified: status.crossSigningVerified,
    locallyVerified: status.localVerified
  };
}

export function setDeviceVerified(client: MatrixClient, userId: string, deviceId: string, verified: boolean): Promise<void> {
  return requireCrypto(client).setDeviceVerified(userId, deviceId, verified);
}

export async function getCryptoStatus(client: MatrixClient): Promise<CryptoStatus> {
  const crypto = requireCrypto(client);
  return {
    crossSigningReady: await crypto.isCrossSigningReady(),
    secretStorageReady: await crypto.isSecretStorageReady()
  };
}

export async function getKeyBackupStatus(client: MatrixClient): Promise<KeyBackupStatus> {
  const crypto = requireCrypto(client);
  // Forces a fresh fetch of the server backup info, so `keyCount` reflects the keys uploaded so far.
  const check = await crypto.checkKeyBackupAndEnable();
  const activeVersion = await crypto.getActiveSessionBackupVersion();
  if (!check) return { activeVersion };
  return {
    activeVersion,
    serverVersion: check.backupInfo.version,
    keyCount: check.backupInfo.count,
    trusted: check.trustInfo.trusted,
    matchesDecryptionKey: check.trustInfo.matchesDecryptionKey
  };
}

export async function setupRecovery(
  client: MatrixClient,
  keys: SecretStorageKeyHolder,
  options: RecoverySetupOptions
): Promise<RecoverySetup> {
  const crypto = requireCrypto(client);
  const generated = await crypto.createRecoveryKeyFromPassphrase();
  const recoveryKey = generated.encodedPrivateKey;
  if (!recoveryKey) throw new Error("Matrix did not return an encoded recovery key");
  await keys.use(generated.privateKey, async () => {
    // Secret storage first: the new key becomes the default, so cross-signing bootstrap never reads
    // secrets encrypted with a previous key it cannot decrypt.
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => generated,
      setupNewSecretStorage: true,
      setupNewKeyBackup: true
    });
    await crypto.bootstrapCrossSigning({
      setupNewCrossSigning: !(await hasLocalCrossSigningKeys(client)),
      authUploadDeviceSigningKeys: makeRequest => makeRequest(passwordAuth(client, options.password))
    });
  });
  return { recoveryKey };
}

async function hasLocalCrossSigningKeys(client: MatrixClient): Promise<boolean> {
  const { privateKeysCachedLocally } = await requireCrypto(client).getCrossSigningStatus();
  return privateKeysCachedLocally.masterKey
    && privateKeysCachedLocally.selfSigningKey
    && privateKeysCachedLocally.userSigningKey;
}

async function matchesKeyDescription(
  privateKey: Uint8Array<ArrayBuffer>,
  description: SecretStorage.SecretStorageKeyDescription
): Promise<boolean> {
  const hasKeyCheck = typeof description.iv === "string" && typeof description.mac === "string";
  if (!hasKeyCheck) return false;
  const check = await SecretStorage.calculateKeyCheck(privateKey, description.iv);
  return check.mac === description.mac;
}

export function recoverWithKey(
  client: MatrixClient,
  keys: SecretStorageKeyHolder,
  recoveryKey: string
): Promise<KeyBackupRestoreSummary> {
  const crypto = requireCrypto(client);
  const privateKey = decodeRecoveryKey(recoveryKey);
  return keys.use(privateKey, async () => {
    // A fresh device may not have downloaded its own cross-signing identity yet; importing the private
    // keys fails silently without it.
    await crypto.userHasCrossSigningKeys(client.getSafeUserId(), true);
    await crypto.bootstrapCrossSigning({});
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    const backup = await crypto.checkKeyBackupAndEnable();
    if (!backup) return { total: 0, imported: 0 };
    const result = await crypto.restoreKeyBackup();
    return { total: result.total, imported: result.imported };
  });
}

function passwordAuth(client: MatrixClient, password: string | undefined): AuthDict | null {
  if (!password) return null;
  return {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: client.getSafeUserId() },
    password
  };
}
