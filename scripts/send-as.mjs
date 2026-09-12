import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Says something in a conversation as somebody else, so a check can watch it arrive on a screen.
const [username, conversationId, body] = process.argv.slice(2);
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

if (!username || !conversationId || !body) {
  console.error("usage: send-as.mjs <username> <conversation> <what to say>");
  process.exit(1);
}

const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
try {
  await client.login({ homeserver, username, password: `${username}-password`, deviceName: "RelayKit sender" });
  await client.start();
  await client.conversations.join(conversationId).catch(() => undefined);
  await client.messages.send(conversationId, body);
  console.log(`said "${body}" in ${conversationId}`);
} catch (error) {
  // Said plainly, because whoever runs this only sees the exit code otherwise.
  console.error(`could not say it: ${error instanceof Error ? error.message : String(error)}`);
  await client.logout().catch(() => undefined);
  process.exit(1);
}
await client.logout().catch(() => undefined);
process.exit(0);
