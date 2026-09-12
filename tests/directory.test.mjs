import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({
    participantIds: [],
    title: "Soporte",
    public: true,
    encrypted: false
  });
  return { adapter, client, conversation };
}

test("a conversation can be given a name people can type", async () => {
  const { client, conversation } = await startClient();

  const named = await client.conversations.setAlias(conversation.id, "#soporte:memory");

  assert.equal(named.alias, "#soporte:memory");
  assert.equal((await client.conversations.list())[0].alias, "#soporte:memory");
  await client.stop();
});

test("a name that is not a name is refused before reaching the server", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.conversations.setAlias(conversation.id, "soporte"), /alias/i);
  await client.stop();
});

test("a conversation nobody listed is not found by looking", async () => {
  const { client } = await startClient();

  assert.deepEqual(await client.conversations.discover("Soporte"), []);
  await client.stop();
});

test("a conversation nobody can enter stays out of sight even when listed", async () => {
  const { client, conversation } = await startClient();
  await client.conversations.setJoinRule(conversation.id, "invite");

  await client.conversations.publish(conversation.id, true);

  assert.deepEqual(await client.conversations.discover("Soporte"), []);
  await client.stop();
});

test("a conversation that is listed can be found by anybody looking for it", async () => {
  const { client, conversation } = await startClient();

  await client.conversations.publish(conversation.id, true);

  const found = await client.conversations.discover("Soporte");
  assert.equal(found.length, 1);
  assert.equal(found[0].id, conversation.id);
  assert.equal(found[0].title, "Soporte");
  await client.stop();
});

test("taking a conversation off the list takes it out of sight", async () => {
  const { client, conversation } = await startClient();
  await client.conversations.publish(conversation.id, true);

  await client.conversations.publish(conversation.id, false);

  assert.deepEqual(await client.conversations.discover("Soporte"), []);
  await client.stop();
});

test("looking with nothing in mind lists what there is", async () => {
  const { client, conversation } = await startClient();
  await client.conversations.publish(conversation.id, true);

  const found = await client.conversations.discover();

  assert.equal(found.length, 1);
  assert.equal(typeof found[0].participantCount, "number");
  await client.stop();
});
