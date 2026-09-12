import "fake-indexeddb/auto";
import { IndexedDbStorage } from "@relaykit/browser-storage";
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

// What a loaded account costs locally. Not a benchmark of the homeserver: everything here is on this machine.
const conversations = Number(process.env.BENCH_CONVERSATIONS ?? 60);
const messagesEach = Number(process.env.BENCH_MESSAGES ?? 400);
const session = { homeserver: "memory://bench", userId: "alice", accessToken: "token" };

function message(conversationId, index) {
  return {
    id: `${conversationId}-${index}`,
    conversationId,
    senderId: "bob",
    body: `mensaje ${index} de ${conversationId} con algo de texto para que no sea trivial descifrarlo`,
    createdAt: 1700000000000 + index,
    status: "sent"
  };
}

/** Arrivals are persisted without waiting, so the benchmark has to let those writes finish. */
function settled() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function time(name, work) {
  const started = performance.now();
  const result = await work();
  const took = performance.now() - started;
  console.log(`${name.padEnd(42)} ${took.toFixed(1).padStart(8)} ms`);
  return result;
}

/** An adapter that already knows about every conversation and its messages, as a synced client would. */
async function loadedAdapter(howMany, messagesEach) {
  const adapter = new InMemoryAdapter();
  await adapter.start({ homeserver: "memory://bench", userId: "alice", accessToken: "token" }, {});
  const conversationIds = [];
  for (let index = 0; index < howMany; index += 1) {
    const conversation = await adapter.createConversation({ participantIds: ["bob"], title: `Sala ${index}` });
    conversationIds.push(conversation.id);
    for (let message = 0; message < messagesEach; message += 1) {
      adapter.receiveMessage(conversation.id, "bob", `mensaje ${message} de ${conversation.id} con algo de texto`);
    }
  }
  return { adapter, conversationIds };
}

async function main() {
  const storage = new IndexedDbStorage(`bench-${Date.now()}`, { encryptionSecret: "device-secret" });
  const ids = Array.from({ length: conversations }, (_, index) => `conversation-${index}`);

  await time(`keep ${conversations * messagesEach} messages`, async () => {
    for (const id of ids) {
      await storage.saveMessages(Array.from({ length: messagesEach }, (_, index) => message(id, index)));
    }
    await storage.saveConversations(ids.map(id => ({
      id,
      participantIds: ["bob"],
      lastMessage: message(id, messagesEach - 1)
    })));
  });

  await time("read one conversation", () => storage.getMessages(ids[0]));
  if (process.env.BENCH_COMPARE) {
    // What reading one conversation cost before the index: every message of every conversation, decrypted.
    await time("read one conversation, walking them all", async () => {
      const everything = [];
      for (const id of ids) everything.push(...await storage.getMessages(id));
      return everything.filter(item => item.conversationId === ids[0]);
    });
  }
  await time("read the queue", () => storage.getPendingMessages());
  await time("read the conversation list", () => storage.getConversations());

  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage, session });
  await client.start();
  await time("search, stopping at fifty", () => client.messages.search("mensaje"));
  await time("search one conversation", () => client.messages.search("mensaje", { conversationId: ids[0] }));
  await client.stop();

  // The same thing through the client, which is what an application actually calls, and twice: opening a
  // conversation a second time is the common case and should not cost the same as the first.
  const { adapter, conversationIds } = await loadedAdapter(ids.length, messagesEach);
  const loaded = new MessagingClient({ adapter, storage, session });
  await loaded.start();
  await time("list conversations, first time", () => loaded.conversations.list());
  await time("list conversations, again", () => loaded.conversations.list());
  await time("open a conversation, first time", () => loaded.messages.list(conversationIds[0]));
  await time("open a conversation, again", () => loaded.messages.list(conversationIds[0]));

  // A burst of messages arriving from sync, which is what a busy group looks like.
  const burst = 200;
  await time(`receive ${burst} messages arriving at once`, async () => {
    for (let index = 0; index < burst; index += 1) {
      adapter.receiveMessage(conversationIds[1], "bob", `llega ${index}`);
    }
    await settled();
  });

  await time("send 50 messages", async () => {
    for (let index = 0; index < 50; index += 1) {
      await loaded.messages.send(conversationIds[2], `enviado ${index}`);
    }
  });

  await time("load an older page", () => loaded.messages.loadMore(conversationIds[0], 50));
  await loaded.stop();
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
