import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

test("a conversation left somewhere else stops being in the local copy", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const first = new MessagingClient({ adapter, storage, session });
  await first.start();
  const staying = await first.conversations.create({ participantIds: ["bob"], title: "Se queda" });
  const going = await first.conversations.create({ participantIds: ["bob"], title: "Se va" });
  await first.conversations.list();
  await first.stop();

  // Left from another device, or swept away by whoever runs the homeserver. Either way this browser was
  // never told, and finds out by asking.
  await adapter.leaveConversation(going.id);

  const again = new MessagingClient({ adapter, storage, session });
  await again.start();
  await again.conversations.list();
  await again.stop();

  // Not just missing from the answer: gone from what is written down. Otherwise it is painted on every
  // start, before the first sync finishes, as a conversation that is not there any more.
  const kept = await storage.getConversations();
  assert.deepEqual(
    kept.map(each => each.id),
    [staying.id]
  );
});

test("what is waiting to be sent is never dropped, wherever it is waiting", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Con cola" });
  await client.conversations.list();
  await storage.saveMessage({
    id: "pendiente-1",
    conversationId: conversation.id,
    senderId: "alice",
    body: "todavia no ha salido",
    createdAt: 1,
    status: "queued"
  });
  await client.stop();

  await adapter.leaveConversation(conversation.id);
  const again = new MessagingClient({ adapter, storage, session });
  await again.start();
  await again.conversations.list();
  await again.stop();

  const kept = await storage.getConversations();
  assert.equal(kept.length, 1, "a conversation with something still waiting to go out was thrown away");
});
