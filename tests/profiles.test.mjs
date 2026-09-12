import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("somebody is called what their profile says", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });

  const profile = await client.users.profile("bob");

  assert.equal(profile.displayName, "Bob");
  await client.stop();
});

test("somebody who goes by another name in a conversation is called that there", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });
  adapter.setConversationName(conversation.id, "bob", "Bob de guardia");

  const inside = await client.users.profile("bob", conversation.id);

  assert.equal(inside.displayName, "Bob de guardia");
  await client.stop();
});

test("the name somebody uses in one conversation does not leak into another", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });
  adapter.setConversationName(conversation.id, "bob", "Bob de guardia");
  const other = await client.conversations.create({ participantIds: ["bob"], title: "Otra" });

  const elsewhere = await client.users.profile("bob", other.id);

  assert.equal(elsewhere.displayName, "Bob");
  await client.stop();
});

test("without a name of their own in the conversation the profile name is used", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob" });

  const inside = await client.users.profile("bob", conversation.id);

  assert.equal(inside.displayName, "Bob");
  await client.stop();
});
