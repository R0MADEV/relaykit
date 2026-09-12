import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class FailingAdapter extends InMemoryAdapter {
  failSends = false;

  async sendMessage(conversationId, body, ...rest) {
    if (this.failSends) throw new Error("the homeserver is not answering");
    return super.sendMessage(conversationId, body, ...rest);
  }
}

async function startClient(cache) {
  const adapter = new FailingAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session, ...cache && { cache } });
  await client.start();
  return { adapter, client, storage };
}

async function makeConversations(client, howMany) {
  const made = [];
  for (let index = 0; index < howMany; index += 1) {
    made.push(await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` }));
  }
  return made;
}

test("the local store does not keep every conversation there has ever been", async () => {
  const { client, storage } = await startClient({ conversations: 3 });
  await makeConversations(client, 5);

  await client.conversations.list();

  assert.equal((await storage.getConversations()).length, 3);
  await client.stop();
});

test("the conversations kept are the ones with the most recent activity", async () => {
  const { adapter, client, storage } = await startClient({ conversations: 2 });
  const made = await makeConversations(client, 4);
  adapter.receiveMessage(made[3].id, "bob", "la mas reciente");
  adapter.receiveMessage(made[0].id, "bob", "tambien reciente");

  await client.conversations.list();

  const kept = (await storage.getConversations()).map(item => item.id).sort();
  assert.deepEqual(kept, [made[0].id, made[3].id].sort());
  await client.stop();
});

test("a conversation with something still waiting to be sent is never dropped", async () => {
  const { adapter, client, storage } = await startClient({ conversations: 1 });
  const made = await makeConversations(client, 3);
  adapter.failSends = true;
  await client.messages.send(made[0].id, "esto no ha salido").catch(() => undefined);
  adapter.failSends = false;
  adapter.receiveMessage(made[2].id, "bob", "lo mas reciente");

  await client.conversations.list();

  const kept = (await storage.getConversations()).map(item => item.id);
  assert.ok(kept.includes(made[0].id), `the one with something queued must stay: ${kept.join(", ")}`);
  await client.stop();
});

test("without a limit nothing is dropped", async () => {
  const { client, storage } = await startClient();
  await makeConversations(client, 6);

  await client.conversations.list();

  assert.equal((await storage.getConversations()).length, 6);
  await client.stop();
});
