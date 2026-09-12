import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const run = promisify(execFile);
const compose = ["compose", "-f", "infrastructure/matrix/docker-compose.yml"];
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };
const bob = { username: process.env.MATRIX_USER_B ?? "bob", password: process.env.MATRIX_PASSWORD_B ?? "bob-password" };

async function createClient(credentials, deviceName) {
  // Without storage there is no durable outbox, which is the whole point of this check.
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  const session = await client.login({ ...credentials, homeserver, deviceName });
  await client.start();
  return { client, userId: session.userId };
}

async function waitFor(description, check, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function homeserverIsUp() {
  try {
    const response = await fetch(`${homeserver}/_matrix/client/versions`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  // This check stops the homeserver on purpose. If a previous run was interrupted it may still be down, and
  // starting from there gives a confusing failure instead of a clear one.
  if (!(await homeserverIsUp())) {
    throw new Error("The homeserver is already down. Start it before running this check.");
  }
  let aliceDevice;
  let bobDevice;
  let stopped = false;
  try {
    aliceDevice = await createClient(alice, "RelayKit outage smoke");
    bobDevice = await createClient(bob, "RelayKit outage smoke");
    const conversation = await aliceDevice.client.conversations.open(bobDevice.userId);
    await waitFor("Bob to be invited", async () => {
      const conversations = await bobDevice.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await bobDevice.client.conversations.join(conversation.id);
    const greeting = `before-outage-${Date.now()}`;
    await bobDevice.client.messages.send(conversation.id, greeting);
    await waitFor("the conversation to be working", async () => {
      const messages = await aliceDevice.client.messages.list(conversation.id);
      return messages.some(message => message.body === greeting);
    });

    // The homeserver goes away for real, not with a mocked failure.
    await run("docker", [...compose, "stop", "synapse"]);
    stopped = true;
    await waitFor("the homeserver to be down", async () => !(await homeserverIsUp()));

    const queued = `during-outage-${Date.now()}`;
    const failure = await aliceDevice.client.messages.send(conversation.id, queued).catch(error => error);
    if (!(failure instanceof Error)) {
      throw new Error("Sending while the homeserver is down should not look like success");
    }
    const pending = (await aliceDevice.client.messages.list(conversation.id))
      .find(message => message.body === queued);
    if (pending?.status !== "failed") {
      throw new Error(`The queued message is in state ${pending?.status}, not waiting to be sent`);
    }

    await run("docker", [...compose, "start", "synapse"]);
    stopped = false;
    await waitFor("the homeserver to be back", homeserverIsUp);

    // Nobody retries by hand: coming back must be enough for what was queued to go out.
    await waitFor("the queued message to reach Bob", async () => {
      const messages = await bobDevice.client.messages.list(conversation.id);
      return messages.some(message => message.body === queued && !message.undecryptable);
    });
    const delivered = (await aliceDevice.client.messages.list(conversation.id))
      .find(message => message.body === queued);
    if (delivered?.status !== "sent") {
      throw new Error(`Alice still sees the message as ${delivered?.status}`);
    }

    console.log("RelayKit outage smoke check passed (queued while down, delivered on its own once back)");
  } finally {
    if (stopped) await run("docker", [...compose, "start", "synapse"]).catch(() => undefined);
    for (const device of [aliceDevice, bobDevice]) await device?.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit outage smoke check failed: ${error.message}`);
    process.exit(1);
  });
