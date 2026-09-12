import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class FlakyAdapter extends InMemoryAdapter {
  reachable = true;

  async addReaction(...args) {
    if (!this.reachable) throw new Error("the homeserver is not answering");
    return super.addReaction(...args);
  }

  async removeReaction(...args) {
    if (!this.reachable) throw new Error("the homeserver is not answering");
    return super.removeReaction(...args);
  }

  async editMessage(...args) {
    if (!this.reachable) throw new Error("the homeserver is not answering");
    return super.editMessage(...args);
  }

  async deleteMessage(...args) {
    if (!this.reachable) throw new Error("the homeserver is not answering");
    return super.deleteMessage(...args);
  }
}

async function startClient() {
  const adapter = new FlakyAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const sent = await client.messages.send(conversation.id, "algo que decir");
  return { adapter, client, conversation, sent };
}

const comeBack = async adapter => {
  adapter.reachable = true;
  adapter.simulateConnection("connected");
  await new Promise(resolve => setTimeout(resolve, 20));
};

test("a reaction given with no homeserver is given when there is one", async () => {
  const { adapter, client, conversation, sent } = await startClient();
  const given = [];
  client.on("reaction.added", reaction => given.push(reaction.key));
  adapter.reachable = false;

  const shownMeanwhile = await client.reactions.add(conversation.id, sent.id, "👍");
  assert.equal(shownMeanwhile.key, "👍", "something has to be shown while it waits");
  assert.deepEqual(given, [], "nobody has been told yet");

  await comeBack(adapter);

  assert.deepEqual(given, ["👍"]);
  await client.stop();
});

test("taking a reaction back with no homeserver is taken back when there is one", async () => {
  const { adapter, client, conversation, sent } = await startClient();
  const taken = [];
  client.on("reaction.removed", reaction => taken.push(reaction.key));
  const given = await client.reactions.add(conversation.id, sent.id, "👍");
  adapter.reachable = false;

  await client.reactions.remove(conversation.id, given.id);
  assert.deepEqual(taken, [], "nobody has been told yet");

  await comeBack(adapter);

  assert.deepEqual(taken, ["👍"]);
  await client.stop();
});

test("a correction made with no homeserver is made when there is one", async () => {
  const { adapter, client, conversation, sent } = await startClient();
  adapter.reachable = false;

  await client.messages.edit(conversation.id, sent.id, "mejor dicho asi");
  await comeBack(adapter);

  const messages = await client.messages.list(conversation.id);
  assert.ok(messages.some(message => message.body === "mejor dicho asi"));
  await client.stop();
});

test("only the last wording is sent, not every correction on the way", async () => {
  const { adapter, client, conversation, sent } = await startClient();
  adapter.reachable = false;
  let edits = 0;
  const original = FlakyAdapter.prototype.editMessage;
  adapter.editMessage = function (...args) {
    if (this.reachable) edits += 1;
    return original.apply(this, args);
  };

  await client.messages.edit(conversation.id, sent.id, "primera");
  await client.messages.edit(conversation.id, sent.id, "segunda");
  await comeBack(adapter);

  assert.equal(edits, 1);
  const messages = await client.messages.list(conversation.id);
  assert.ok(messages.some(message => message.body === "segunda"));
  await client.stop();
});

test("with a homeserver there, everything happens at once as before", async () => {
  const { client, conversation, sent } = await startClient();

  const given = await client.reactions.add(conversation.id, sent.id, "👍");

  assert.equal(given.key, "👍");
  await client.stop();
});
