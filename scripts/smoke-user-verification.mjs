import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Two different people verifying each other, which happens inside the conversation they share.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bob = { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" };

async function createClient(credentials, deviceName) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter() });
  const session = await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
  return { client, userId: session.userId, deviceId: session.deviceId };
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
  const aliceSide = await createClient(alice, "RelayKit user verification smoke (alice)");
  let bobSide;
  try {
    await aliceSide.client.crypto.setupRecovery({ password: alice.password });
    bobSide = await createClient(bob, "RelayKit user verification smoke (bob)");
    await bobSide.client.crypto.setupRecovery({ password: bob.password });

    const conversation = await aliceSide.client.conversations.open(bobSide.userId);
    await waitFor("Bob to be invited", async () => {
      const conversations = await bobSide.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await bobSide.client.conversations.join(conversation.id);

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
