import { registerAccount, signInAgain, closeWhatWasMade } from "./fresh-accounts.mjs";

// On accounts of its own: setting recovery up resets the cross-signing identity, so a shared account that has
// been through this all day is left in a state where nothing else can verify, and the failure says nothing
// about why.

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
async function sendBeforeEnablingRecovery(client, bobUserId) {
  // This is about recovering keys, so the conversation has to be encrypted. Asked for expressly: saying
  // nothing leaves it to the homeserver, and assuming is how this check started lying.
  const conversation = await client.conversations.create({
    participantIds: [bobUserId],
    title: "RelayKit recovery smoke",
    encrypted: true
  });
  if (!conversation.isEncrypted) {
    throw new Error("The conversation did not end up encrypted, so there are no keys to recover");
  }
  const body = `recovery-${Date.now()}`;
  await client.messages.send(conversation.id, body);
  return { conversation, body };
}

async function main() {
  // The person, made here and passed along, rather than a function that remembers who it registered.
  const owner = await registerAccount("recovery", "RelayKit recovery smoke (first device)");
  const firstDevice = owner.client;
  // Somebody to talk to, so there is a conversation with something said in it before recovery is turned on.
  const other = await registerAccount("recovery-other", "RelayKit recovery smoke (other)");
  const bobUserId = other.userId;
  let secondDevice;
  try {
    const { conversation, body } = await sendBeforeEnablingRecovery(firstDevice, bobUserId);
    const { recoveryKey } = await firstDevice.crypto.setupRecovery({ password: owner.password });
    const status = await firstDevice.crypto.status();
    if (!status.crossSigningReady || !status.secretStorageReady) {
      throw new Error(`Recovery setup left crypto not ready: ${JSON.stringify(status)}`);
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

    secondDevice = (await signInAgain(owner, "RelayKit recovery smoke (second device)")).client;
    const beforeRecovery = await secondDevice.messages.list(conversation.id);
    const isReadableWithoutRecovery = beforeRecovery.some(message => message.body === body);
    if (isReadableWithoutRecovery) {
      throw new Error("The new device could read the encrypted message before recovering keys");
    }

    // Turning recovery on and the keys reaching the copy are not the same moment: the first device uploads
    // them in the background. What has to be true is that recovering brings them across, not that it does so
    // on the first try a fraction of a second later.
    const summary = await waitFor(
      "the keys to reach the copy and come back",
      async () => {
        const brought = await secondDevice.crypto.recover(recoveryKey);
        return brought.imported >= 1 ? brought : undefined;
      },
      { attempts: 30, intervalMs: 2000 }
    );
    await waitFor("the recovered device to decrypt the message", async () => {
      const messages = await secondDevice.messages.list(conversation.id);
      return messages.some(message => message.body === body);
    });
    // What matters is not a counter but whether the new device can read it, so that is what is waited for.
    await waitFor(
      "the recovered device to decrypt what was said after recovery was on",
      async () => {
        await secondDevice.crypto.recover(recoveryKey).catch(() => undefined);
        const messages = await secondDevice.messages.list(later.id);
        return messages.some(message => message.body === laterBody);
      },
      { attempts: 30, intervalMs: 2000 }
    );
    console.log(`RelayKit recovery smoke check passed (${summary.imported}/${summary.total} keys imported)`);
  } finally {
    // The devices first: they are sessions of an account that is about to stop existing.
    await secondDevice?.logout().catch(() => undefined);
    await firstDevice.logout().catch(() => undefined);
    await closeWhatWasMade();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit recovery smoke check failed: ${error.message}`);
    process.exit(1);
  });
