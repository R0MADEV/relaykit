import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const picture = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("a conversation can have a description", async () => {
  const { client, conversation } = await startClient();

  const updated = await client.conversations.setTopic(conversation.id, "Coordinacion del despliegue");

  assert.equal(updated.topic, "Coordinacion del despliegue");
  assert.equal((await client.conversations.list())[0].topic, "Coordinacion del despliegue");
  await client.stop();
});

test("a conversation can have a picture that is downloaded like any other media", async () => {
  const { client, conversation } = await startClient();

  const updated = await client.conversations.setAvatar(conversation.id, picture);

  assert.ok(updated.avatar?.source);
  assert.deepEqual(await client.media.download(updated.avatar), picture.data);
  await client.stop();
});

test("a conversation can be silenced and heard again", async () => {
  const { client, conversation } = await startClient();

  await client.conversations.setNotifications(conversation.id, "none");
  assert.equal((await client.conversations.list())[0].notifications, "none");

  await client.conversations.setNotifications(conversation.id, "mentions");
  assert.equal((await client.conversations.list())[0].notifications, "mentions");

  await client.conversations.setNotifications(conversation.id, "all");
  assert.equal((await client.conversations.list())[0].notifications, undefined);
  await client.stop();
});

test("a silenced conversation stops raising notifications", async () => {
  const { adapter, client, conversation } = await startClient();
  const notifications = [];
  client.on("notification", notification => notifications.push(notification.body));

  await client.conversations.setNotifications(conversation.id, "none");
  adapter.receiveMessage(conversation.id, "bob", "callado");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(notifications, []);
  await client.stop();
});

test("messages can be pinned and unpinned", async () => {
  const { client, conversation } = await startClient();
  const message = await client.messages.send(conversation.id, "acuerdo importante");

  await client.conversations.pin(conversation.id, message.id);
  assert.deepEqual((await client.conversations.pinned(conversation.id)).map(item => item.id), [message.id]);

  await client.conversations.unpin(conversation.id, message.id);

  assert.deepEqual(await client.conversations.pinned(conversation.id), []);
  await client.stop();
});
