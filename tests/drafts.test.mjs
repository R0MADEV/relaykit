import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(storage = new InMemoryStorage()) {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, storage, conversation };
}

test("what somebody was writing is kept and read back", async () => {
  const { client, conversation } = await startClient();

  await client.conversations.saveDraft(conversation.id, "estaba escribiendo esto");

  assert.equal(await client.conversations.draft(conversation.id), "estaba escribiendo esto");
  await client.stop();
});

test("a conversation nobody was writing in has no draft", async () => {
  const { client, conversation } = await startClient();

  assert.equal(await client.conversations.draft(conversation.id), undefined);
  await client.stop();
});

test("an unfinished message survives closing the application", async () => {
  const storage = new InMemoryStorage();
  const first = await startClient(storage);
  await first.client.conversations.saveDraft(first.conversation.id, "a medias");
  await first.client.stop();

  const second = new MessagingClient({ adapter: new InMemoryAdapter(), storage, session });
  await second.start();

  assert.equal(await second.conversations.draft(first.conversation.id), "a medias");
  await second.stop();
});

test("clearing what was written leaves no draft behind", async () => {
  const { client, conversation } = await startClient();
  await client.conversations.saveDraft(conversation.id, "me lo pienso");

  await client.conversations.saveDraft(conversation.id, "   ");

  assert.equal(await client.conversations.draft(conversation.id), undefined);
  await client.stop();
});

test("sending the message clears the draft, so it does not come back next time", async () => {
  const { client, conversation } = await startClient();
  await client.conversations.saveDraft(conversation.id, "hola");

  await client.messages.send(conversation.id, "hola");

  assert.equal(await client.conversations.draft(conversation.id), undefined);
  await client.stop();
});

test("drafts are private, so signing out takes them with it", async () => {
  const storage = new InMemoryStorage();
  const { client, conversation } = await startClient(storage);
  await client.conversations.saveDraft(conversation.id, "algo personal");

  await client.logout();

  assert.equal(await storage.getDraft(conversation.id), undefined);
});
