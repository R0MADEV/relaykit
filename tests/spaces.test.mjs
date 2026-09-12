import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("conversations can be grouped into a space", async () => {
  const { client } = await startClient();
  const space = await client.spaces.create({ title: "Irontec" });
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "General" });

  await client.spaces.add(space.id, conversation.id);

  assert.deepEqual((await client.spaces.list()).map(item => item.title), ["Irontec"]);
  assert.deepEqual((await client.spaces.conversations(space.id)).map(item => item.id), [conversation.id]);
  await client.stop();
});

test("a conversation can be taken out of a space", async () => {
  const { client } = await startClient();
  const space = await client.spaces.create({ title: "Irontec" });
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.spaces.add(space.id, conversation.id);

  await client.spaces.remove(space.id, conversation.id);

  assert.deepEqual(await client.spaces.conversations(space.id), []);
  await client.stop();
});

test("a space is not listed as an ordinary conversation", async () => {
  const { client } = await startClient();
  await client.spaces.create({ title: "Irontec" });
  const conversation = await client.conversations.create({ participantIds: ["bob"] });

  const conversations = await client.conversations.list();

  assert.deepEqual(conversations.map(item => item.id), [conversation.id]);
  await client.stop();
});

test("a space needs a name", async () => {
  const { client } = await startClient();

  await assert.rejects(client.spaces.create({ title: "  " }), { code: "INVALID_INPUT" });
  await client.stop();
});
