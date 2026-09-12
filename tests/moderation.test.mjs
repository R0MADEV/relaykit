import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob", "carol"] });
  return { adapter, client, conversation };
}

test("someone can be removed from a conversation", async () => {
  const { client, conversation } = await startClient();

  const updated = await client.conversations.remove(conversation.id, "bob", "spam");

  assert.ok(!updated.participantIds.includes("bob"));
  assert.ok(updated.participantIds.includes("carol"));
  await assert.rejects(client.conversations.remove(conversation.id, "  "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("someone can be banned and allowed back", async () => {
  const { client, conversation } = await startClient();

  const banned = await client.conversations.ban(conversation.id, "bob", "insultos");
  assert.ok(!banned.participantIds.includes("bob"));

  const lifted = await client.conversations.unban(conversation.id, "bob");

  assert.ok(!lifted.participantIds.includes("bob"), "lifting a ban does not put anyone back in");
  await client.stop();
});

test("a conversation can be marked as a favourite and unmarked", async () => {
  const { client, conversation } = await startClient();

  await client.conversations.setFavourite(conversation.id, true);
  assert.equal((await client.conversations.list())[0].isFavourite, true);

  await client.conversations.setFavourite(conversation.id, false);

  assert.equal((await client.conversations.list())[0].isFavourite, undefined);
  await client.stop();
});

test("a person can be ignored and stops being heard", async () => {
  const { adapter, client, conversation } = await startClient();
  const received = [];
  client.on("message.received", message => received.push(message.body));

  await client.users.ignore("bob");
  assert.deepEqual(await client.users.ignored(), ["bob"]);

  adapter.receiveMessage(conversation.id, "bob", "no me deberias leer");
  adapter.receiveMessage(conversation.id, "carol", "a mi si");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(received, ["a mi si"]);
  await client.users.unignore("bob");
  assert.deepEqual(await client.users.ignored(), []);
  await client.stop();
});
