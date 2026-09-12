import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const username = `relaykit-${Date.now()}`;
const password = "una-contrasena-larga";

function createClient() {
  return new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
}

async function waitFor(description, check, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const newcomer = createClient();
  let existing;
  try {
    const session = await newcomer.register({ homeserver, username, password, deviceName: "RelayKit registration smoke" });
    if (!session.userId.startsWith(`@${username}:`) || !session.accessToken) {
      throw new Error(`Registration returned an odd session: ${JSON.stringify(session)}`);
    }
    await newcomer.start();

    // A brand new account has to be able to talk straight away.
    existing = createClient();
    await existing.login({ homeserver, username: "alice", password: "alice-password", deviceName: "RelayKit registration smoke" });
    await existing.start();
    const conversation = await newcomer.conversations.open("@alice:localhost");
    await waitFor("Alice to be invited", async () => {
      const conversations = await existing.conversations.list();
      return conversations.find(item => item.id === conversation.id);
    });
    await existing.conversations.join(conversation.id);
    const hello = `hello-${Date.now()}`;
    await existing.messages.send(conversation.id, hello);
    await waitFor("the newcomer to read the reply", async () => {
      const messages = await newcomer.messages.list(conversation.id);
      return messages.some(message => message.body === hello && !message.undecryptable);
    });

    // The same username cannot be taken twice, and that has to be said plainly.
    const repeated = await createClient()
      .register({ homeserver, username, password })
      .catch(error => error);
    if (repeated?.code !== "USERNAME_TAKEN") {
      throw new Error(`Registering the same username again reported ${repeated?.code}`);
    }

    console.log(`RelayKit registration smoke check passed (${session.userId})`);
  } finally {
    await existing?.logout().catch(() => undefined);
    await newcomer.logout().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`RelayKit registration smoke check failed: ${error.message}`);
    process.exit(1);
  });
