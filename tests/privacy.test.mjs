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

test("a conversation created without saying otherwise is only for those invited", async () => {
  const { client, conversation } = await startClient();

  assert.equal(conversation.joinRule, "invite");
  assert.equal((await client.conversations.list())[0].joinRule, "invite");
  await client.stop();
});

test("who may come in can be changed, and anybody can be let in", async () => {
  const { client, conversation } = await startClient();

  const opened = await client.conversations.setJoinRule(conversation.id, "public");

  assert.equal(opened.joinRule, "public");
  assert.equal((await client.conversations.list())[0].joinRule, "public");
  await client.stop();
});

test("a conversation can ask people to knock instead of letting them straight in", async () => {
  const { client, conversation } = await startClient();

  const closed = await client.conversations.setJoinRule(conversation.id, "knock");

  assert.equal(closed.joinRule, "knock");
  await client.stop();
});

test("somebody who knocks is waiting, and letting them in makes them a participant", async () => {
  const { adapter, client, conversation } = await startClient();
  await client.conversations.setJoinRule(conversation.id, "knock");

  adapter.receiveKnock(conversation.id, "carol");

  const waiting = (await client.conversations.list())[0];
  assert.deepEqual(waiting.knockingIds, ["carol"]);
  await client.conversations.invite(conversation.id, "carol");
  const afterwards = (await client.conversations.list())[0];
  assert.deepEqual(afterwards.knockingIds, []);
  assert.ok(afterwards.participantIds.includes("carol"));
  await client.stop();
});

test("asking to come in reaches the conversation", async () => {
  const { adapter, client } = await startClient();
  const closed = await adapter.createConversation({ participantIds: [], title: "Cerrada" });
  await adapter.setJoinRule(closed.id, "knock");

  await client.conversations.knock(closed.id, { reason: "trabajo aqui" });

  assert.deepEqual(adapter.knocksOn(closed.id), [{ userId: "alice", reason: "trabajo aqui" }]);
  await client.stop();
});

test("how far back a newcomer can read is a decision of the conversation", async () => {
  const { client, conversation } = await startClient();

  const narrowed = await client.conversations.setHistoryVisibility(conversation.id, "joined");

  assert.equal(narrowed.historyVisibility, "joined");
  assert.equal((await client.conversations.list())[0].historyVisibility, "joined");
  await client.stop();
});

test("a rule nobody understands is refused before reaching the server", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.conversations.setJoinRule(conversation.id, "whenever"), /join rule/i);
  await assert.rejects(client.conversations.setHistoryVisibility(conversation.id, "sometimes"), /history/i);
  await client.stop();
});
