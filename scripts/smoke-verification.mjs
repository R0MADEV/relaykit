import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const aliceUserId = `@${alice.username}:localhost`;

async function createClient(deviceName) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter() });
  const session = await client.login({ ...alice, homeserver, deviceName });
  await client.start();
  return { client, deviceId: session.deviceId };
}

function waitForPhase(client, phase, eventName = "verification.changed", timeoutMs = 30000) {
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

async function waitForDevice(client, userId, deviceId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await client.devices.verification(userId, deviceId)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for device ${deviceId} to appear in the device list`);
}

function emojiOf(session) {
  return session.sas.emoji.map(item => item.symbol).join(" ");
}

async function main() {
  // The device that answers a self-verification must hold the cross-signing keys, so the first device
  // sets them up and the new device asks it for verification, as a real second login would.
  const first = await createClient("RelayKit verification smoke (first device)");
  let second;
  try {
    await first.client.crypto.setupRecovery({ password: alice.password });
    second = await createClient("RelayKit verification smoke (second device)");
    await waitForDevice(second.client, aliceUserId, first.deviceId);
    const trace = message => { if (process.env.RELAYKIT_TRACE) console.error(`[smoke] ${message}`); };
    first.client.on("verification.changed", session => trace(`first: ${session.phase}`));
    second.client.on("verification.changed", session => trace(`second: ${session.phase}`));
    first.client.on("error", error => trace(`first error: ${error.message}`));
    second.client.on("error", error => trace(`second error: ${error.message}`));
    const incoming = waitForPhase(first.client, "requested", "verification.requested");
    const firstSas = waitForPhase(first.client, "sas");
    const secondSas = waitForPhase(second.client, "sas");

    const requested = await second.client.verification.request(aliceUserId);
    trace(`requested ${requested.id}`);
    const received = await incoming;
    trace(`received ${received.id}`);
    await first.client.verification.accept(received.id);
    trace("accepted");

    const [firstSession, secondSession] = await Promise.all([firstSas, secondSas]);
    if (emojiOf(firstSession) !== emojiOf(secondSession)) {
      throw new Error(`SAS emoji differ: ${emojiOf(firstSession)} vs ${emojiOf(secondSession)}`);
    }

    const firstDone = waitForPhase(first.client, "done");
    const secondDone = waitForPhase(second.client, "done");
    await Promise.all([
      first.client.verification.confirm(received.id),
      second.client.verification.confirm(requested.id)
    ]);
    await Promise.all([firstDone, secondDone]);

    const status = await first.client.devices.verification(aliceUserId, second.deviceId);
    if (!status?.verified) {
      throw new Error(`The second device is not verified after SAS: ${JSON.stringify(status)}`);
    }
    console.log(`RelayKit verification smoke check passed (${emojiOf(firstSession)})`);
  } finally {
    await second?.client.logout();
    await first.client.logout();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit verification smoke check failed: ${error.message}`);
    process.exit(1);
  });
