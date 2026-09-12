import { registerAccount } from "./fresh-accounts.mjs";

// Two different people verifying each other, which happens inside the conversation they share. Both accounts
// are their own: verifying leaves cross-signing state, and sharing accounts between checks means one check
// breaking another in a way neither of them mentions.
async function waitForDevice(client, userId, deviceId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await client.devices.verification(userId, deviceId)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${userId} to know about device ${deviceId}`);
}

async function createClient(purpose, deviceName) {
  const account = await registerAccount(purpose, deviceName);
  return { client: account.client, userId: account.userId, deviceId: account.deviceId, password: account.password };
}

function waitForPhase(client, phase, eventName = "verification.changed", timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for verification phase "${phase}"`));
    }, timeoutMs);
    const unsubscribe = client.on(eventName, session => {
      if (session.phase !== phase) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(session);
    });
  });
}

async function waitFor(description, check, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function emojiOf(session) {
  return session.sas.emoji.map(item => item.symbol).join(" ");
}

async function main() {
  // Both sides need cross-signing keys of their own: verifying another person is about their identity,
  // not about one device, so there has to be an identity on each side to sign.
  const aliceSide = await createClient("verify-a", "RelayKit user verification smoke (alice)");
  let bobSide;
  try {
    await aliceSide.client.crypto.setupRecovery({ password: aliceSide.password });
    bobSide = await createClient("verify-b", "RelayKit user verification smoke (bob)");
    await bobSide.client.crypto.setupRecovery({ password: bobSide.password });

    // Encrypted on purpose: device lists only travel between people who share an encrypted conversation, and
    // verifying somebody is about the keys they sign with. Asking for it rather than assuming it, because the
    // policy now belongs to whoever runs the homeserver.
    const conversation = await aliceSide.client.conversations.create({
      participantIds: [bobSide.userId],
      direct: true,
      encrypted: true
    });
    await waitFor("Bob to be invited", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await bobSide.client.conversations.join(conversation.id);
    // Two accounts that have just been made do not know each other's devices until the conversation has told
    // them. Asking to verify somebody the account has never heard of is refused, and rightly so.
    await waitForDevice(aliceSide.client, bobSide.userId, bobSide.deviceId);
    await waitForDevice(bobSide.client, aliceSide.userId, aliceSide.deviceId);

    const incoming = waitForPhase(bobSide.client, "requested", "verification.requested");
    const aliceSas = waitForPhase(aliceSide.client, "sas");
    const bobSas = waitForPhase(bobSide.client, "sas");

    // No device is named: Alice asks to verify Bob, whoever he is signing with.
    const requested = await aliceSide.client.verification.request(bobSide.userId);
    if (requested.otherDeviceId !== undefined) {
      throw new Error(`Verifying a person should not pin a device: ${requested.otherDeviceId}`);
    }
    const received = await incoming;
    await bobSide.client.verification.accept(received.id);

    const [asAlice, asBob] = await Promise.all([aliceSas, bobSas]);
    if (emojiOf(asAlice) !== emojiOf(asBob)) {
      throw new Error(`The emoji differ: ${emojiOf(asAlice)} vs ${emojiOf(asBob)}`);
    }

    const aliceDone = waitForPhase(aliceSide.client, "done");
    const bobDone = waitForPhase(bobSide.client, "done");
    await Promise.all([
      aliceSide.client.verification.confirm(requested.id),
      bobSide.client.verification.confirm(received.id)
    ]);
    await Promise.all([aliceDone, bobDone]);

    console.log(`RelayKit user verification smoke check passed (${emojiOf(asAlice)})`);
  } finally {
    await bobSide?.client.logout();
    await aliceSide.client.logout();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit user verification smoke check failed: ${error.message}`);
    process.exit(1);
  });
