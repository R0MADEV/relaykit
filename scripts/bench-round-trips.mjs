import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// How many times the homeserver is asked while painting a screen. Round trips are what a chat feels.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };

const asked = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  asked.set(shapeOf(url), (asked.get(shapeOf(url)) ?? 0) + 1);
  return realFetch(input, init);
};

/** Groups requests by what they are for, so identifiers do not turn every call into its own line. */
function shapeOf(url) {
  const path = new URL(url).pathname.replace(/^\/_matrix\/(client|media)\/[^/]+\//, "");
  return path
    .replace(/%40[^/]+/g, ":person")
    .replace(/%21[^/]+/g, ":conversation")
    .replace(/%24[^/]+/g, ":message")
    .replace(/\/[0-9a-zA-Z_-]{20,}/g, "/:id");
}

function report(title) {
  const lines = [...asked.entries()].sort((left, right) => right[1] - left[1]);
  const total = lines.reduce((sum, [, count]) => sum + count, 0);
  console.log(`\n${title}: ${total} requests`);
  for (const [shape, count] of lines.slice(0, 8)) {
    console.log(`  ${String(count).padStart(4)}  ${shape}`);
  }
  asked.clear();
}

async function main() {
  const client = new MessagingClient({ adapter: new MatrixJsAdapter(), storage: new InMemoryStorage() });
  await client.login({ ...alice, homeserver, deviceName: "RelayKit round trips" });
  await client.start();
  try {
    const conversations = await client.conversations.list();
    const people = [...new Set(conversations.flatMap(conversation => conversation.participantIds))];
    console.log(`${conversations.length} conversations, ${people.length} people`);
    asked.clear();

    // What a conversation list does: paint every name, then repaint on the next change.
    // Naming the conversation is what lets the names be answered from what has already been synced.
    const whereEachPersonIs = new Map();
    for (const conversation of conversations) {
      for (const person of conversation.participantIds) {
        if (!whereEachPersonIs.has(person)) whereEachPersonIs.set(person, conversation.id);
      }
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (const person of people) await client.users.profile(person, whereEachPersonIs.get(person));
    }
    report("painting every name three times");

    for (let pass = 0; pass < 3; pass += 1) {
      for (const person of people) await client.users.profile(person);
    }
    report("painting every name three times, without saying where");

    const busiest = conversations.find(item => (item.participantIds.length ?? 0) > 1) ?? conversations[0];
    await client.messages.list(busiest.id);
    report("opening a conversation");
  } finally {
    await client.logout().catch(() => undefined);
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error(`round trip measurement failed: ${error.message}`);
  process.exit(1);
});
