import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bobUserId = `@${process.env.MATRIX_USER_B ?? "bob"}:localhost`;

async function createClient(credentials, deviceName) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter() });
  await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
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

/**
 * The key upload loop of matrix-js-sdk runs when the backup is enabled, after a random delay of up to ten
 * seconds, and a later send does not start a new one. Sending before enabling recovery makes the room key
 * exist by the time that single pass runs, which is what a user with existing history would do anyway.
 */
async function sendBeforeEnablingRecovery(client) {
  const conversation = await client.conversations.create({
    participantIds: [bobUserId],
    title: "RelayKit recovery smoke"
  });
  const body = `recovery-${Date.now()}`;
  await client.messages.send(conversation.id, body);
  return { conversation, body };
}

async function main() {
  const firstDevice = await createClient(alice, "RelayKit recovery smoke (first device)");
  let secondDevice;
  try {
    const { conversation, body } = await sendBeforeEnablingRecovery(firstDevice);
    const { recoveryKey } = await firstDevice.crypto.setupRecovery({ password: alice.password });
    const status = await firstDevice.crypto.status();
    if (!status.crossSigningReady || !status.secretStorageReady) {
      throw new Error(`Recovery setup left crypto not ready: ${JSON.stringify(status)}`);
    }
    await waitFor("the room key to be backed up", async () => {
      const backup = await firstDevice.crypto.backupStatus();
      return (backup.keyCount ?? 0) > 0;
    }, { attempts: 15, intervalMs: 2000 });

    secondDevice = await createClient(alice, "RelayKit recovery smoke (second device)");
    const beforeRecovery = await secondDevice.messages.list(conversation.id);
    const isReadableWithoutRecovery = beforeRecovery.some(message => message.body === body);
    if (isReadableWithoutRecovery) {
      throw new Error("The new device could read the encrypted message before recovering keys");
    }

    const summary = await secondDevice.crypto.recover(recoveryKey);
    if (summary.imported < 1) {
      throw new Error(`Recovery imported no keys: ${JSON.stringify(summary)}`);
    }
    await waitFor("the recovered device to decrypt the message", async () => {
      const messages = await secondDevice.messages.list(conversation.id);
      return messages.some(message => message.body === body);
    });
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
