import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingAdapter extends InMemoryAdapter {
  lookups = 0;

  async getProfile(userId, conversationId) {
    this.lookups += 1;
    return super.getProfile(userId, conversationId);
  }
}

async function startClient() {
  const adapter = new CountingAdapter();
  let now = 0;
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session, now: () => now });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation, at: value => { now = value; } };
}

test("painting the same name twenty times asks once", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });

  for (let index = 0; index < 20; index += 1) await client.users.profile("bob");

  assert.equal(adapter.lookups, 1);
  await client.stop();
});

test("each person is asked about once", async () => {
  const { adapter, client } = await startClient();

  await client.users.profile("bob");
  await client.users.profile("carol");
  await client.users.profile("bob");

  assert.equal(adapter.lookups, 2);
  await client.stop();
});

test("the name somebody uses in a conversation is remembered apart from the one they use everywhere", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });
  adapter.setConversationName(conversation.id, "bob", "Bob de guardia");

  const everywhere = await client.users.profile("bob");
  const here = await client.users.profile("bob", conversation.id);

  assert.equal(everywhere.displayName, "Bob");
  assert.equal(here.displayName, "Bob de guardia");
  assert.equal(adapter.lookups, 2);
  await client.stop();
});

test("a name that has been held long enough is asked for again", async () => {
  const { adapter, client, at } = await startClient();
  await client.users.profile("bob");

  at(10 * 60 * 1000);
  await client.users.profile("bob");

  assert.equal(adapter.lookups, 2);
  await client.stop();
});

test("changing my own name does not leave the old one being shown", async () => {
  const { adapter, client } = await startClient();
  await client.users.profile("alice");

  await client.users.setDisplayName("Alicia");

  assert.equal((await client.users.profile("alice")).displayName, "Alicia");
  await client.stop();
});

test("signing out forgets who everyone was", async () => {
  const { adapter, client } = await startClient();
  await client.users.profile("bob");

  await client.stop();
  await client.start();
  await client.users.profile("bob");

  assert.equal(adapter.lookups, 2);
  await client.stop();
});
