import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(storage = new InMemoryStorage()) {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  return { adapter, client, storage };
}

function cutTheNetwork(adapter) {
  const gone = () => Promise.reject(new Error("the homeserver is not answering"));
  adapter.listConversations = gone;
  adapter.listMessages = gone;
  adapter.getProfile = gone;
}

test("looking for a conversation works with no homeserver, like looking for a message", async () => {
  const { adapter, client } = await startClient();
  await client.conversations.create({ participantIds: ["bob"], title: "Soporte nivel 2" });
  await client.conversations.list();

  cutTheNetwork(adapter);

  const found = await client.conversations.search("soporte");
  assert.deepEqual(found.map(item => item.title), ["Soporte nivel 2"]);
  await client.stop();
});

test("what somebody is called is still known with no homeserver", async () => {
  const storage = new InMemoryStorage();
  const first = await startClient(storage);
  first.adapter.setProfile("bob", { displayName: "Bob" });
  const conversation = await first.client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  await first.client.users.profile("bob", conversation.id);
  await first.client.stop();

  const withoutNetwork = new MessagingClient({ adapter: brokenAdapter(), storage, session });
  await withoutNetwork.start();

  const known = await withoutNetwork.users.profile("bob", conversation.id);
  assert.equal(known.displayName, "Bob");
  await withoutNetwork.stop();
});

function brokenAdapter() {
  const adapter = new InMemoryAdapter();
  adapter.getProfile = () => Promise.reject(new Error("the homeserver is not answering"));
  return adapter;
}

test("somebody nobody ever asked about says so instead of making a name up", async () => {
  const { client } = await startClient();
  const withoutNetwork = new MessagingClient({ adapter: brokenAdapter(), storage: new InMemoryStorage(), session });
  await withoutNetwork.start();

  await assert.rejects(withoutNetwork.users.profile("carol"), /not answering/i);
  await client.stop();
  await withoutNetwork.stop();
});
