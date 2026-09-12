import { MatrixError, SecretStorage, type AuthDict, type MatrixClient } from "matrix-js-sdk";
import type { CryptoCallbacks } from "matrix-js-sdk/lib/crypto-api/index.js";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import { SdkError } from "@relaykit/core";
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
    // Three steps, and the order of them is the whole difficulty.
    //
    // The store comes first so the new key becomes the default: until it is, everything that asks for a key is
    // answered with the previous one, which nobody can open any more.
    const newStore = {
      createSecretStorageKey: async () => generated,
      setupNewSecretStorage: true,
      setupNewKeyBackup: true
    };
    await crypto.bootstrapSecretStorage(newStore);
    // Then the identity. It is always started afresh: whatever the account had is in the previous store, which
    // cannot be read, so keeping it would leave an identity nothing can sign with. This leaves its private
    // keys on this device, which is what makes it able to sign itself.
    await crypto.bootstrapCrossSigning({
      setupNewCrossSigning: true,
      authUploadDeviceSigningKeys: makeRequest => proveWhoYouAre(client, makeRequest, options.password)
    });
    // And now it can be put away, because now there is something to put away. Without this the identity lives
    // on this device alone, and recovering on another one would find the store empty.
    await crypto.bootstrapSecretStorage({ setupNewKeyBackup: false });
    // Uploading the identity and seeing it are not the same moment: until the homeserver is asked for it, the
    // account does not know it has one, and everything that reads it says recovery is not set up.
    await crypto.userHasCrossSigningKeys(client.getSafeUserId(), true);
  });
  return { recoveryKey };
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

/**
 * Publishing an identity is sensitive, so the homeserver asks the account to prove who it is. The protocol
 * says how: ask once to learn what is required, and the refusal carries the session to answer within. Sending
 * the password straight away without one is answered with a 401 that has nowhere to go, and the identity is
 * never published: cross-signing then looks set up while nothing can sign this device.
 */
async function proveWhoYouAre(
  client: MatrixClient,
  makeRequest: (auth: AuthDict | null) => Promise<unknown>,
  password: string | undefined
): Promise<void> {
  try {
    await makeRequest(null);
    return;
  } catch (error) {
    if (!(error instanceof MatrixError) || error.httpStatus !== 401) throw error;
    if (!password) {
      throw new SdkError("INVALID_INPUT", "The homeserver asks for the password to set recovery up");
    }
    const session = (error.data as { session?: string }).session;
    await makeRequest({
      ...passwordAuth(client, password),
      ...(session ? { session } : {})
    } as AuthDict);
  }
}

function passwordAuth(client: MatrixClient, password: string | undefined): AuthDict | null {
  if (!password) return null;
  return {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: client.getSafeUserId() },
    password
  };
}
