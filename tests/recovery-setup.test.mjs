import assert from "node:assert/strict";
import test from "node:test";

const { setupRecovery, SecretStorageKeyHolder } = await import("../packages/matrix-js/dist/matrix-security.js");
const { MatrixError } = await import("matrix-js-sdk");

/**
 * Just enough crypto to tell the one thing that matters here: an account does not see its own cross-signing
 * identity the moment it uploads it. It sees it after asking the homeserver for it, and until then everything
 * that reads the identity says no. This is what a loaded account does slowly enough to notice.
 */
function fakeClient() {
  let identityIsDownloaded = false;
  const crypto = {
    order: [],
    createRecoveryKeyFromPassphrase: async () => ({
      encodedPrivateKey: "EsT3 Es La CLav3",
      privateKey: new Uint8Array(32)
    }),
    bootstrapSecretStorage: async () => { crypto.order.push("storage"); },
    bootstrapCrossSigning: async () => { crypto.order.push("identity"); },
    getCrossSigningStatus: async () => ({
      privateKeysCachedLocally: { masterKey: true, selfSigningKey: true, userSigningKey: true }
    }),
    isCrossSigningReady: async () => identityIsDownloaded,
    isSecretStorageReady: async () => true,
    userHasCrossSigningKeys: async (_userId, download) => {
      if (download) identityIsDownloaded = true;
      return identityIsDownloaded;
    }
  };
  return { getCrypto: () => crypto, getSafeUserId: () => "@alice:localhost", getDeviceId: () => "ESTE", crypto };
}

test("setting up recovery does not come back before cross-signing is usable", async () => {
  const client = fakeClient();

  const { recoveryKey } = await setupRecovery(client, new SecretStorageKeyHolder(), { password: "la contrasena" });

  assert.equal(recoveryKey, "EsT3 Es La CLav3");
  assert.equal(await client.crypto.isCrossSigningReady(), true);
});

test("the store is made, the identity settled, and only then is the identity put away", async () => {
  const client = fakeClient();

  await setupRecovery(client, new SecretStorageKeyHolder(), { password: "la contrasena" });

  // Three steps, and none of them can move. The store has to come first, because until the new key is the
  // default the homeserver still answers with the old one, which nobody can open. The identity has to be
  // settled next, because a store made before it would be asked to keep keys this device does not hold yet.
  // And it has to be put away afterwards, or the keys live on this device alone and no other one can recover.
  assert.deepEqual(client.crypto.order, ["storage", "identity", "storage"]);
});

/**
 * A homeserver that does what the protocol says: uploading an identity is sensitive, so the first attempt is
 * answered with "not yet, here is a session, now prove who you are". Firing the password blind, with no
 * session, is refused. Every other sensitive call in this library already knows this dance.
 */
function demandingClient() {
  const crypto = {
    uploaded: false,
    createRecoveryKeyFromPassphrase: async () => ({ encodedPrivateKey: "CLAV3", privateKey: new Uint8Array(32) }),
    bootstrapSecretStorage: async () => {},
    bootstrapCrossSigning: async ({ authUploadDeviceSigningKeys }) => {
      await authUploadDeviceSigningKeys(async auth => {
        if (!auth?.session) {
          throw new MatrixError({ errcode: "M_FORBIDDEN", session: "una-sesion", flows: [] }, 401);
        }
        crypto.uploaded = true;
      });
    },
    isCrossSigningReady: async () => crypto.uploaded,
    isSecretStorageReady: async () => true,
    userHasCrossSigningKeys: async () => crypto.uploaded
  };
  return { getCrypto: () => crypto, getSafeUserId: () => "@alice:localhost", crypto };
}

test("a homeserver that asks to prove who you are is answered, not ignored", async () => {
  const client = demandingClient();

  await setupRecovery(client, new SecretStorageKeyHolder(), { password: "la contrasena" });

  assert.equal(client.crypto.uploaded, true, "the identity was never uploaded, so nothing can sign this device");
});

test("without a password there is nothing to answer with, and that is said plainly", async () => {
  const client = demandingClient();

  await assert.rejects(setupRecovery(client, new SecretStorageKeyHolder(), {}), { code: "INVALID_INPUT" });
});
