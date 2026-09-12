import { MessagingClient } from "@relaykit/core";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Verifying a new device by showing it a code instead of comparing emoji.
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

async function waitForCode(client, sessionId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // Right after the request the other device may still be unknown here, and there is nothing to draw yet.
    const code = await client.verification.qrCode(sessionId).catch(() => undefined);
    if (code && code.byteLength > 0) return code;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("This device has nothing to show as a code");
}

async function waitForDevice(client, userId, deviceId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await client.devices.verification(userId, deviceId)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for device ${deviceId} to appear in the device list`);
}

async function main() {
  // The device that shows the code has to be the one already trusted, which is what makes the code worth
  // anything: the new device learns it is talking to a device that already holds the cross-signing keys.
  const trusted = await createClient("RelayKit qr smoke (trusted device)");
  let newcomer;
  try {
    await trusted.client.crypto.setupRecovery({ password: alice.password });
    newcomer = await createClient("RelayKit qr smoke (new device)");
    await waitForDevice(newcomer.client, aliceUserId, trusted.deviceId);

    const incoming = waitForPhase(trusted.client, "requested", "verification.requested");
    const requested = await newcomer.client.verification.request(aliceUserId, undefined, { method: "code" });
    const received = await incoming;
    await trusted.client.verification.accept(received.id);

    // The new device shows the code and the trusted one reads it, which is the direction that proves something:
    // the device that already holds the cross-signing keys is the one saying the new device is genuine.
    const code = await waitForCode(newcomer.client, requested.id);

    const done = waitForPhase(newcomer.client, "done");
    const started = waitForPhase(newcomer.client, "started");
    // The trusted device reads the code the new one shows, which is the direction the rust side supports here.
    await trusted.client.verification.scan(received.id, code);
    // The device that showed the code says whether the other one really scanned it, once it knows it happened.
    await started;
    await newcomer.client.verification.confirm(requested.id);
    await done;

    const status = await trusted.client.devices.verification(aliceUserId, newcomer.deviceId);
    if (!status?.verified) {
      throw new Error(`The new device is not verified after scanning: ${JSON.stringify(status)}`);
    }
    console.log(`RelayKit qr smoke check passed (${code.byteLength} bytes scanned)`);
  } finally {
    await newcomer?.client.logout();
    await trusted.client.logout();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit qr smoke check failed: ${error.message}`);
    process.exit(1);
  });
