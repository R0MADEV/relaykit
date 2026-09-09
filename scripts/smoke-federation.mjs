import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Two people on two different homeservers, which is the point of Matrix and the one thing never tried.
const local = { homeserver: "http://localhost:8018", username: "alice", password: "alice-password", userId: "@alice:fed1" };
const remote = { homeserver: "http://localhost:8019", username: "dave", password: "dave-password", userId: "@dave:fed2" };

async function createClient({ homeserver, username, password }) {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  const session = await client.login({ homeserver, username, password, deviceName: "RelayKit federation smoke" });
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

function waitForReadable(who, conversationId, body) {
  return waitFor(`${who.userId} to read "${body}"`, async () => {
    const messages = await who.client.messages.list(conversationId);
    const message = messages.find(item => item.body === body);
    return message && !message.undecryptable ? message : undefined;
  });
}

async function main() {
  let alice;
  let dave;
  try {
    alice = await createClient(local);
    dave = await createClient(remote);
    if (alice.userId === local.userId === false) throw new Error(`Unexpected local user ${alice.userId}`);
    if (!dave.userId.endsWith(":fed2")) throw new Error(`Dave is not on the other server: ${dave.userId}`);

    const conversation = await alice.client.conversations.open(dave.userId);
    await waitFor("the invitation to cross to the other server", async () => {
      const conversations = await dave.client.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await dave.client.conversations.join(conversation.id);

    // The one who just arrived speaks first, so the other side knows the devices to encrypt for.
    const fromDave = `remote-${Date.now()}`;
    await dave.client.messages.send(conversation.id, fromDave);
    await waitForReadable(alice, conversation.id, fromDave);

    const fromAlice = `local-${Date.now()}`;
    await alice.client.messages.send(conversation.id, fromAlice);
    await waitForReadable(dave, conversation.id, fromAlice);

    const both = await waitFor("both servers to agree on who is in the conversation", async () => {
      const conversations = await dave.client.conversations.list();
      const current = conversations.find(item => item.id === conversation.id);
      return current?.participantIds.includes(alice.userId) && current.participantIds.includes(dave.userId)
        ? current
        : undefined;
    });

    console.log(`RelayKit federation smoke check passed (${alice.userId} and ${dave.userId}, ${both.participantIds.length} participants)`);
  } finally {
    for (const who of [alice, dave]) await who?.client.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit federation smoke check failed: ${error.message}`);
    process.exit(1);
  });
