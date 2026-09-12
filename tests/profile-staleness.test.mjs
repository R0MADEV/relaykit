import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session, now: () => 0 });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("somebody renaming themselves in a conversation is seen straight away", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setConversationName(conversation.id, "bob", "Bob");
  assert.equal((await client.users.profile("bob", conversation.id)).displayName, "Bob");

  adapter.setConversationName(conversation.id, "bob", "Bob de guardia");
  await adapter.renameConversation(conversation.id, "Equipo");
  await settle();

  assert.equal((await client.users.profile("bob", conversation.id)).displayName, "Bob de guardia");
  await client.stop();
});

test("a new picture in a conversation is seen straight away", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob", avatar: { mimeType: "image/png", data: new Uint8Array([1]) } });
  assert.equal((await client.users.avatar("bob", { conversationId: conversation.id }))?.data[0], 1);

  adapter.setProfile("bob", { displayName: "Bob", avatar: { mimeType: "image/png", data: new Uint8Array([2]) } });
  await adapter.renameConversation(conversation.id, "Equipo");
  await settle();

  assert.equal((await client.users.avatar("bob", { conversationId: conversation.id }))?.data[0], 2);
  await client.stop();
});

test("a change in one conversation does not throw away what is known about another", async () => {
  const { adapter, client, conversation } = await startClient();
  const other = await client.conversations.create({ participantIds: ["carol"], title: "Otra" });
  adapter.setConversationName(other.id, "carol", "Carol");
  await client.users.profile("carol", other.id);
  let lookups = 0;
  const original = adapter.getProfile.bind(adapter);
  adapter.getProfile = (...args) => {
    lookups += 1;
    return original(...args);
  };

  await adapter.renameConversation(conversation.id, "Equipo");
  await settle();
  await client.users.profile("carol", other.id);

  assert.equal(lookups, 0, "the other conversation was not the one that changed");
  await client.stop();
});

test("the name somebody uses everywhere is not thrown away by a conversation changing", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });
  await client.users.profile("bob");
  let lookups = 0;
  const original = adapter.getProfile.bind(adapter);
  adapter.getProfile = (...args) => {
    lookups += 1;
    return original(...args);
  };

  await adapter.renameConversation(conversation.id, "Equipo");
  await settle();
  await client.users.profile("bob");

  assert.equal(lookups, 0);
  await client.stop();
});
