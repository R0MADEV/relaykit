import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, createConversationList } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingAdapter extends InMemoryAdapter {
  listings = 0;

  async listConversations() {
    this.listings += 1;
    return super.listConversations();
  }
}

async function startClient() {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("a message in a conversation already on the list does not re-read every conversation", async () => {
  const { adapter, client } = await startClient();
  const first = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  await client.conversations.create({ participantIds: ["carol"], title: "Otra" });
  const list = createConversationList(client);
  await list.refresh();
  adapter.listings = 0;

  adapter.receiveMessage(first.id, "bob", "hola");
  await settle();

  assert.equal(adapter.listings, 0, "the list should be updated in place, not read again");
  list.stop();
  await client.stop();
});

test("the conversation that just had a message moves to the top", async () => {
  const { adapter, client } = await startClient();
  const first = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const second = await client.conversations.create({ participantIds: ["carol"], title: "Otra" });
  const list = createConversationList(client);
  await list.refresh();

  adapter.receiveMessage(first.id, "bob", "lo mas reciente");
  await settle();

  assert.equal(list.get()[0]?.id, first.id);
  assert.equal(list.get()[1]?.id, second.id);
  list.stop();
  await client.stop();
});

test("a conversation nobody had seen before is read in", async () => {
  const { adapter, client } = await startClient();
  await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const list = createConversationList(client);
  await list.refresh();
  adapter.listings = 0;

  const invitation = adapter.receiveInvitation("dave");
  await settle();

  assert.ok(adapter.listings > 0, "a conversation that is not on the list has to be read in");
  assert.ok(list.get().some(item => item.id === invitation.id));
  list.stop();
  await client.stop();
});

test("subscribers are only told when something actually changed", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const list = createConversationList(client);
  await list.refresh();
  let told = 0;
  list.subscribe(() => { told += 1; });

  // Renaming to the name it already has changes nothing, so nobody should be woken up.
  await client.conversations.rename(conversation.id, "Equipo");
  await settle();

  assert.equal(told, 0);
  list.stop();
  await client.stop();
});

test("conversations with nothing said in them keep a steady order", async () => {
  const { client } = await startClient();
  for (let index = 0; index < 8; index += 1) {
    await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` });
  }

  const first = (await client.conversations.list()).map(item => item.id);
  const second = (await client.conversations.list()).map(item => item.id);
  const third = (await client.conversations.list()).map(item => item.id);

  assert.deepEqual(second, first, "listing again must not shuffle them");
  assert.deepEqual(third, first);
  await client.stop();
});

test("the screen and the client agree on the order of conversations", async () => {
  const { adapter, client } = await startClient();
  const made = [];
  for (let index = 0; index < 6; index += 1) {
    made.push(await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` }));
  }
  const list = createConversationList(client);
  await list.refresh();

  adapter.receiveMessage(made[4].id, "bob", "algo", { createdAt: 5000 });
  await settle();

  const onScreen = list.get().map(item => item.id);
  const fromTheClient = (await client.conversations.list()).map(item => item.id);
  assert.deepEqual(onScreen, fromTheClient);
  list.stop();
  await client.stop();
});
