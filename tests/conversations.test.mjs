import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingAdapter extends InMemoryAdapter {
  created = 0;
  lastCreateInput = undefined;
  lastJoinHints = undefined;

  async createConversation(input) {
    this.created += 1;
    this.lastCreateInput = input;
    return super.createConversation(input);
  }

  async joinConversation(conversationId, via = []) {
    this.lastJoinHints = via;
    return super.joinConversation(conversationId, via);
  }
}

function collectUpdates(client) {
  const updates = [];
  client.on("conversation.updated", updated => updates.push(updated));
  return updates;
}

async function startClient() {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("open reuses the existing direct conversation instead of creating a duplicate", async () => {
  const { adapter, client } = await startClient();

  const first = await client.conversations.open("bob");
  const second = await client.conversations.open("bob");

  assert.equal(first.isDirect, true);
  assert.deepEqual(first.participantIds, ["bob"]);
  assert.equal(second.id, first.id);
  assert.equal(adapter.created, 1);
  assert.equal((await client.conversations.findDirect("bob"))?.id, first.id);
  assert.equal(await client.conversations.findDirect("carol"), undefined);
  await client.stop();
});

test("a group with the same participant is not treated as the direct conversation", async () => {
  const { adapter, client } = await startClient();
  await client.conversations.create({ participantIds: ["bob", "carol"], title: "Team" });
  await client.conversations.create({ participantIds: ["bob"], title: "Not direct" });

  const direct = await client.conversations.open("bob");

  assert.equal(direct.isDirect, true);
  assert.equal(adapter.created, 3);
  await client.stop();
});

test("conversations.search matches title and participants case-insensitively", async () => {
  const { client } = await startClient();
  const support = await client.conversations.create({ participantIds: ["bob"], title: "Soporte" });
  const withCarol = await client.conversations.create({ participantIds: ["Carol"] });
  await client.conversations.create({ participantIds: ["dave"], title: "Ventas" });

  assert.deepEqual((await client.conversations.search("sop")).map(item => item.id), [support.id]);
  assert.deepEqual((await client.conversations.search("carol")).map(item => item.id), [withCarol.id]);
  assert.deepEqual(await client.conversations.search("nothing"), []);
  await assert.rejects(client.conversations.search("  "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("messages.search finds local messages across or within conversations, newest first", async () => {
  const { client } = await startClient();
  const one = await client.conversations.create({ participantIds: ["bob"] });
  const two = await client.conversations.create({ participantIds: ["carol"] });
  await client.messages.send(one.id, "Budget for Q3");
  await new Promise(resolve => setTimeout(resolve, 2));
  await client.messages.send(two.id, "budget approved");
  const deleted = await client.messages.send(two.id, "budget draft");
  await client.messages.delete(two.id, deleted.id);
  await client.messages.send(two.id, "unrelated");

  const everywhere = await client.messages.search("BUDGET");
  assert.deepEqual(everywhere.map(item => item.body), ["budget approved", "Budget for Q3"]);
  const inTwo = await client.messages.search("budget", { conversationId: two.id });
  assert.deepEqual(inTwo.map(item => item.body), ["budget approved"]);
  await assert.rejects(client.messages.search(""), { code: "INVALID_INPUT" });
  await client.stop();
});

test("a conversation counts the messages received since they were last read", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const updates = [];
  client.on("conversation.updated", updated => updates.push(updated));

  await client.messages.send(conversation.id, "propio");
  assert.equal((await client.conversations.list()).find(item => item.id === conversation.id).unreadCount, 0);

  adapter.receiveMessage(conversation.id, "bob", "hola");
  adapter.receiveMessage(conversation.id, "bob", "¿estas?");

  const withUnread = (await client.conversations.list()).find(item => item.id === conversation.id);
  assert.equal(withUnread.unreadCount, 2);
  assert.equal(updates.at(-1).unreadCount, 2);

  await client.messages.markRead(conversation.id, withUnread.lastMessage.id);

  assert.equal((await client.conversations.list()).find(item => item.id === conversation.id).unreadCount, 0);
  await client.stop();
});

test("conversations are listed with the most recent activity first", async () => {
  const { adapter, client } = await startClient();
  const quiet = await client.conversations.create({ participantIds: ["bob"] });
  const busy = await client.conversations.create({ participantIds: ["carol"] });
  await client.messages.send(quiet.id, "antiguo");
  await new Promise(resolve => setTimeout(resolve, 2));
  adapter.receiveMessage(busy.id, "carol", "reciente");

  const listed = await client.conversations.list();

  assert.deepEqual(listed.map(item => item.id), [busy.id, quiet.id]);
  await client.stop();
});

test("leaving a conversation removes it from the list and from local storage", async () => {
  const adapter = new CountingAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "hasta luego");
  assert.equal((await storage.getMessages(conversation.id)).length, 1);

  await client.conversations.leave(conversation.id);

  assert.deepEqual(await client.conversations.list(), []);
  assert.deepEqual(await storage.getConversations(), []);
  assert.deepEqual(await storage.getMessages(conversation.id), []);
  await client.stop();
});

test("a participant can be invited to an existing conversation", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const updates = collectUpdates(client);

  const updated = await client.conversations.invite(conversation.id, "carol");

  assert.ok(updated.participantIds.includes("carol"));
  assert.ok(updates.at(-1).participantIds.includes("carol"));
  await assert.rejects(client.conversations.invite(conversation.id, "  "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("a conversation can be renamed", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Antiguo" });

  const renamed = await client.conversations.rename(conversation.id, "Nuevo");

  assert.equal(renamed.title, "Nuevo");
  assert.equal((await client.conversations.list())[0].title, "Nuevo");
  await assert.rejects(client.conversations.rename(conversation.id, "   "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("listing conversations only writes the ones that changed", async () => {
  class CountingStorage extends InMemoryStorage {
    saves = 0;

    async saveConversation(conversation) {
      this.saves += 1;
      return super.saveConversation(conversation);
    }
  }

  const adapter = new CountingAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const first = await client.conversations.create({ participantIds: ["bob"] });
  await client.conversations.create({ participantIds: ["carol"] });

  await client.conversations.list();
  const afterFirstList = storage.saves;
  await client.conversations.list();

  assert.equal(storage.saves, afterFirstList, "an unchanged list should not be written again");

  adapter.receiveMessage(first.id, "bob", "algo nuevo");
  await client.conversations.list();

  assert.equal(storage.saves, afterFirstList + 1, "only the conversation that changed should be written");
  await client.stop();
});

test("open joins a direct invitation from that user instead of starting a second conversation", async () => {
  const { adapter, client } = await startClient();
  const invitation = adapter.receiveInvitation("bob");

  const opened = await client.conversations.open("bob");

  assert.equal(opened.id, invitation.id, "both sides must end up in the same conversation");
  assert.equal(opened.membership, "join");
  assert.equal(adapter.created, 0, "no new conversation should be created");
});

test("open ignores an invitation that is not a direct conversation with that user", async () => {
  const { adapter, client } = await startClient();
  adapter.receiveInvitation("carol");

  const opened = await client.conversations.open("bob");

  assert.equal(opened.isDirect, true);
  assert.deepEqual(opened.participantIds, ["bob"]);
  assert.equal(adapter.created, 1);
});

test("a new conversation reports the people who have not accepted yet", async () => {
  const { adapter, client } = await startClient();

  const conversation = await client.conversations.create({ participantIds: ["bob"] });

  assert.deepEqual(conversation.invitedIds, ["bob"]);
  assert.ok(conversation.participantIds.includes("bob"), "an invited person is still part of the conversation");

  adapter.acceptInvitation(conversation.id, "bob");
  const listed = await client.conversations.list();

  assert.deepEqual(listed[0].invitedIds, []);
  await client.stop();
});

test("a conversation can be created open to anyone and joined with server hints", async () => {
  const { adapter, client } = await startClient();

  const conversation = await client.conversations.create({ participantIds: [], title: "Comunidad", public: true });
  assert.equal(adapter.lastCreateInput.public, true);

  await client.conversations.join(conversation.id, { via: ["fed1", "  "] });

  assert.deepEqual(adapter.lastJoinHints, ["fed1"], "blank hints are dropped");
  await client.stop();
});

test("joining without hints keeps working", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });

  await client.conversations.join(conversation.id);

  assert.deepEqual(adapter.lastJoinHints, []);
  await client.stop();
});

test("searching on the server returns what the homeserver finds", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.receiveMessage(conversation.id, "bob", "el presupuesto de julio");

  const found = await client.messages.searchRemote("presupuesto");

  assert.deepEqual(found.map(message => message.body), ["el presupuesto de julio"]);
  await assert.rejects(client.messages.searchRemote("   "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("what the conversation reports as changed is kept, not only announced", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  await client.conversations.list();

  await adapter.renameConversation(conversation.id, "Equipo de guardia");

  const stored = (await storage.getConversations()).find(item => item.id === conversation.id);
  assert.equal(stored?.title, "Equipo de guardia");
  await client.stop();
});
