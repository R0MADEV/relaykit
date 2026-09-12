import "fake-indexeddb/auto";
import { IndexedDbStorage } from "@relaykit/browser-storage";
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

// What a long session holds on to. A chat that is left open for a day should not keep growing.
const conversations = Number(process.env.BENCH_CONVERSATIONS ?? 200);
const messagesEach = Number(process.env.BENCH_MESSAGES ?? 500);
const people = Number(process.env.BENCH_PEOPLE ?? 400);
const session = { homeserver: "memory://bench", userId: "alice", accessToken: "token" };
const picture = { mimeType: "image/png", data: new Uint8Array(50 * 1024).fill(7) };

function heldMegabytes() {
  globalThis.gc?.();
  return Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
}

async function main() {
  const adapter = new InMemoryAdapter();
  await adapter.start(session, {});
  const storage = new IndexedDbStorage(`memory-${Date.now()}`, { encryptionSecret: "device-secret" });
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();

  const ids = [];
  for (let index = 0; index < conversations; index += 1) {
    const conversation = await adapter.createConversation({ participantIds: ["bob"], title: `Sala ${index}` });
    ids.push(conversation.id);
    for (let message = 0; message < messagesEach; message += 1) {
      adapter.receiveMessage(conversation.id, "bob", `mensaje ${message} de la sala ${index}`);
    }
  }
  for (let index = 0; index < people; index += 1) {
    adapter.setProfile(`person-${index}`, { displayName: `Persona ${index}`, avatar: picture });
  }

  const beforeUsing = heldMegabytes();
  console.log(`after filling ${conversations} conversations of ${messagesEach} messages   ${String(beforeUsing).padStart(5)} MB`);

  // A day of use: every conversation opened, every face painted.
  for (const id of ids) await client.messages.list(id);
  for (let index = 0; index < people; index += 1) await client.users.avatar(`person-${index}`);
  console.log(`after opening every conversation and every face  ${String(heldMegabytes()).padStart(5)} MB`);

  // And again, which should cost nothing new.
  for (const id of ids) await client.messages.list(id);
  for (let index = 0; index < people; index += 1) await client.users.avatar(`person-${index}`);
  console.log(`after doing all of it a second time              ${String(heldMegabytes()).padStart(5)} MB`);

  await client.stop();
  console.log(`after stopping                                  ${String(heldMegabytes()).padStart(5)} MB`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
