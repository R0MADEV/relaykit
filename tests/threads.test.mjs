import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  return { adapter, client, conversation };
}

test("an answer can hang from a message and be read as a thread", async () => {
  const { client, conversation } = await startClient();
  const root = await client.messages.send(conversation.id, "¿Quién se encarga del despliegue?");

  const answer = await client.messages.send(conversation.id, "Yo lo hago", { threadId: root.id });
  await client.messages.send(conversation.id, "Nada que ver", {});

  assert.equal(answer.threadId, root.id);
  const thread = await client.messages.thread(conversation.id, root.id);
  assert.deepEqual(thread.map(message => message.body), ["Yo lo hago"]);
  await client.stop();
});

test("the main timeline does not repeat what belongs to a thread", async () => {
  const { client, conversation } = await startClient();
  const root = await client.messages.send(conversation.id, "raiz");
  await client.messages.send(conversation.id, "dentro del hilo", { threadId: root.id });

  const timeline = await client.messages.list(conversation.id);

  assert.deepEqual(timeline.map(message => message.body), ["raiz"]);
  await client.stop();
});

test("a thread answer validates what it hangs from", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.messages.send(conversation.id, "suelto", { threadId: "  " }), { code: "INVALID_INPUT" });
  await assert.rejects(client.messages.thread(conversation.id, ""), { code: "INVALID_INPUT" });
  await client.stop();
});

test("what a person is allowed to do in a conversation can be asked", async () => {
  const { adapter, client, conversation } = await startClient();

  const permissions = await client.conversations.permissions(conversation.id);

  assert.equal(permissions.canSend, true);
  assert.equal(permissions.canInvite, true);
  assert.equal(permissions.canRemove, true);
  assert.equal(permissions.canRename, true);

  adapter.setPowerLevel(conversation.id, "alice", 0);
  const asMember = await client.conversations.permissions(conversation.id);
  assert.equal(asMember.canSend, true);
  assert.equal(asMember.canRemove, false, "an ordinary member cannot throw anybody out");
  await client.stop();
});

test("somebody can be made a moderator", async () => {
  const { adapter, client, conversation } = await startClient();

  await client.conversations.setRole(conversation.id, "bob", "moderator");

  assert.equal(adapter.powerLevelOf(conversation.id, "bob"), 50);
  await client.conversations.setRole(conversation.id, "bob", "member");
  assert.equal(adapter.powerLevelOf(conversation.id, "bob"), 0);
  await client.stop();
});
