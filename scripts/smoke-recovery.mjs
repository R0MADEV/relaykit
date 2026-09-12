import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bobUserId = `@${process.env.MATRIX_USER_B ?? "bob"}:localhost`;

async function createClient(credentials, deviceName) {
  const adapter = new MatrixJsAdapter();
  const client = new MessagingClient({ adapter });
  await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
  // Kept so a failure can say which part of cross-signing is missing, which the public status does not.
  client.adapterForDiagnostics = adapter;
  return client;
}

async function waitFor(description, check, { attempts = 60, intervalMs = 500, required = true } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (!required) return undefined;
  throw new Error(`Timed out waiting for ${description}`);
}

/** Somebody turning recovery on already has history, so the first message is sent before setting it up. */
async function sendBeforeEnablingRecovery(client) {
  // Esto va de recuperar claves, asi que la conversacion tiene que estar cifrada. Se pide expresamente: sin
  // decir nada decide el homeserver, y suponerlo es como esta comprobacion empezo a mentir.
  const conversation = await client.conversations.create({
    participantIds: [bobUserId],
    title: "RelayKit recovery smoke",
    encrypted: true
  });
  if (!conversation.isEncrypted) {
    throw new Error("La conversacion no quedo cifrada, asi que no hay claves que recuperar");
  }
  const body = `recovery-${Date.now()}`;
  await client.messages.send(conversation.id, body);
  return { conversation, body };
}

/** Which part of cross-signing is missing, so a failure says what happened instead of only that it happened. */
async function whyNotReady(client) {
  const crypto = client.adapterForDiagnostics?.runtime?.getClient()?.getCrypto?.();
  if (!crypto) return "(no detail available)";
  const settled = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const parts = await crypto.getCrossSigningStatus();
    const ready = await crypto.isCrossSigningReady();
    settled.push(`${attempt}:ready=${ready} public=${parts.publicKeysOnDevice} sssss=${parts.privateKeysInSecretStorage} cached=${JSON.stringify(parts.privateKeysCachedLocally)}`);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return `| ${settled.at(0)} ... ${settled.at(-1)} after ${settled.length} looks`;
}

async function main() {
  const firstDevice = await createClient(alice, "RelayKit recovery smoke (first device)");
  let secondDevice;
  try {
    const { conversation, body } = await sendBeforeEnablingRecovery(firstDevice);
    const { recoveryKey } = await firstDevice.crypto.setupRecovery({ password: alice.password });
    const status = await firstDevice.crypto.status();
    if (!status.crossSigningReady || !status.secretStorageReady) {
      throw new Error(`Recovery setup left crypto not ready: ${JSON.stringify(status)} ${await whyNotReady(firstDevice)}`);
    }
    // The count of keys the server reports lags behind, and on a loaded account it lags a lot. What matters is
    // whether the other device can read what was said, and that is what this waits for further down.

    // A key created after recovery is on must reach the backup too, or everything said from now on is lost to
    // any device that arrives later. It takes a new conversation: talking in the same one reuses the key that
    // was backed up already, which would prove nothing.
    const later = await firstDevice.conversations.create({
      participantIds: [bobUserId],
      title: "RelayKit recovery smoke (after setup)",
      encrypted: true
    });
    const laterBody = `recovery-later-${Date.now()}`;
    await firstDevice.messages.send(later.id, laterBody);

    secondDevice = await createClient(alice, "RelayKit recovery smoke (second device)");
    const beforeRecovery = await secondDevice.messages.list(conversation.id);
    const isReadableWithoutRecovery = beforeRecovery.some(message => message.body === body);
    if (isReadableWithoutRecovery) {
      throw new Error("The new device could read the encrypted message before recovering keys");
    }

    // Turning recovery on and the keys reaching the copy are not the same moment: the first device uploads
    // them in the background. What has to be true is that recovering brings them across, not that it does so
    // on the first try a fraction of a second later.
    const summary = await waitFor("the keys to reach the copy and come back", async () => {
      const brought = await secondDevice.crypto.recover(recoveryKey);
      return brought.imported >= 1 ? brought : undefined;
    }, { attempts: 30, intervalMs: 2000 });
    await waitFor("the recovered device to decrypt the message", async () => {
      const messages = await secondDevice.messages.list(conversation.id);
      return messages.some(message => message.body === body);
    });
    // What matters is not a counter but whether the new device can read it, so that is what is waited for.
    await waitFor("the recovered device to decrypt what was said after recovery was on", async () => {
      await secondDevice.crypto.recover(recoveryKey).catch(() => undefined);
      const messages = await secondDevice.messages.list(later.id);
      return messages.some(message => message.body === laterBody);
    }, { attempts: 30, intervalMs: 2000 });
    console.log(`RelayKit recovery smoke check passed (${summary.imported}/${summary.total} keys imported)`);
  } finally {
    await secondDevice?.logout();
    await firstDevice.logout();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit recovery smoke check failed: ${error.message}`);
    process.exit(1);
  });
