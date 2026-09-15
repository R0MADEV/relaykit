import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, RelayKitError } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

async function aConversationWith(client, howMany) {
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Historia" });
  const sent = [];
  for (let each = 1; each <= howMany; each += 1) {
    sent.push(await client.messages.send(conversation.id, `mensaje ${each}`));
  }
  return { conversation, sent };
}

test("a message can be read with what was said around it", async () => {
  const { client } = await startClient();
  const { conversation, sent } = await aConversationWith(client, 9);
  const middle = sent[4];

  const around = await client.messages.around(conversation.id, middle.id, 2);

  assert.equal(around.message.id, middle.id);
  assert.deepEqual(
    around.before.map(message => message.body),
    ["mensaje 3", "mensaje 4"]
  );
  assert.deepEqual(
    around.after.map(message => message.body),
    ["mensaje 6", "mensaje 7"]
  );
});

test("what is around a message nobody said is refused, not made up", async () => {
  const { client } = await startClient();
  const { conversation } = await aConversationWith(client, 2);
  await assert.rejects(() => client.messages.around(conversation.id, "no-such-message"), RelayKitError);
});

test("searching the homeserver comes back a page at a time", async () => {
  const { client } = await startClient();
  const { conversation } = await aConversationWith(client, 6);
  await client.messages.send(conversation.id, "aguja en el pajar");

  const first = await client.messages.searchRemote("mensaje", { limit: 2 });
  assert.equal(first.messages.length, 2);
  assert.ok(first.cursor, "there is more, so there is a way to ask for it");

  const next = await client.messages.searchRemote("mensaje", { cursor: first.cursor });
  assert.ok(next.messages.length > 0);
  const twice = next.messages.filter(message => first.messages.some(one => one.id === message.id));
  assert.equal(twice.length, 0, "the second page is not the first one again");
});

test("a session refreshed on its own is handed out, so it can be kept", async () => {
  const { client, adapter } = await startClient();
  const kept = [];
  client.on("session.refreshed", refreshed => kept.push(refreshed));

  adapter.refreshTheSession({ ...session, accessToken: "token-2", refreshToken: "refresh-2" });

  assert.equal(kept.length, 1);
  assert.equal(kept[0].accessToken, "token-2");
});

test("going back in a conversation does not drag thread answers into it", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Hilos" });
  const root = await client.messages.send(conversation.id, "la pregunta");
  await client.messages.send(conversation.id, "en el hilo", { threadId: root.id });
  await client.messages.send(conversation.id, "otra cosa");

  const older = await client.messages.loadMore(conversation.id, 50);

  assert.deepEqual(
    older.messages.map(message => message.body),
    ["la pregunta", "otra cosa"],
    "what hangs from a thread is read as a thread, going back as well as coming in"
  );
});
