import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/** An adapter that takes its time to catch up, which is what a real one does over a network. */
class SlowAdapter extends InMemoryAdapter {
  releaseSync = () => {};
  syncing = new Promise(resolve => { this.releaseSync = resolve; });

  async start(currentSession, handlers) {
    await super.start(currentSession, handlers);
    await this.syncing;
  }
}

async function fillTheStore() {
  const storage = new InMemoryStorage();
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "De ayer" });
  adapter.receiveMessage(conversation.id, "bob", "lo de ayer");
  await client.conversations.list();
  await client.messages.list(conversation.id);
  await client.stop();
  return { storage, conversation };
}

test("starting without waiting comes back before the server has answered", async () => {
  const { storage } = await fillTheStore();
  const adapter = new SlowAdapter();
  const client = new MessagingClient({ adapter, storage, session });

  await client.start({ waitForSync: false });

  assert.ok(true, "it came back instead of waiting for the sync");
  adapter.releaseSync();
  await client.stop();
});

test("what was there yesterday is shown before the server has answered", async () => {
  const { storage, conversation } = await fillTheStore();
  const adapter = new SlowAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start({ waitForSync: false });

  const listed = await client.conversations.list();
  const messages = await client.messages.list(conversation.id);

  assert.deepEqual(listed.map(item => item.id), [conversation.id]);
  assert.deepEqual(messages.map(item => item.body), ["lo de ayer"]);
  adapter.releaseSync();
  await client.stop();
});

test("once the server answers, what it says is what is shown", async () => {
  const { storage, conversation } = await fillTheStore();
  const adapter = new SlowAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start({ waitForSync: false });
  adapter.releaseSync();
  await new Promise(resolve => setTimeout(resolve, 5));

  const listed = await client.conversations.list();

  assert.deepEqual(listed.map(item => item.id), [], "the server knows of no conversation, and that is the truth");
  assert.notEqual(conversation.id, undefined);
  await client.stop();
});

test("what was left in the queue still goes out when starting without waiting", async () => {
  const storage = new InMemoryStorage();
  const failing = new InMemoryAdapter();
  const first = new MessagingClient({ adapter: failing, storage, session });
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  failing.sendMessage = () => Promise.reject(new Error("the homeserver went away"));
  await first.messages.send(conversation.id, "quedo pendiente").catch(() => undefined);
  await first.stop();

  const adapter = new SlowAdapter();
  const second = new MessagingClient({ adapter, storage, session });
  await second.start({ waitForSync: false });
  adapter.releaseSync();
  await new Promise(resolve => setTimeout(resolve, 20));

  const sent = await second.messages.list(conversation.id);
  assert.ok(
    sent.some(message => message.body === "quedo pendiente" && message.status === "sent"),
    `it was left as ${sent.map(message => `${message.body}:${message.status}`).join(", ")}`
  );
  await second.stop();
});

test("stopping before the server answers leaves the client stopped, not connected", async () => {
  const { storage } = await fillTheStore();
  const adapter = new SlowAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  const states = [];
  client.on("connection.changed", status => states.push(status));
  client.on("sync.changed", status => states.push(status));
  await client.start({ waitForSync: false });

  await client.stop();
  adapter.releaseSync();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(states.at(-1), "disconnected", `it ended up as ${states.join(", ")}`);
});

test("stopping before the server answers does not send what was in the queue afterwards", async () => {
  const storage = new InMemoryStorage();
  const failing = new InMemoryAdapter();
  const first = new MessagingClient({ adapter: failing, storage, session });
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  failing.sendMessage = () => Promise.reject(new Error("the homeserver went away"));
  await first.messages.send(conversation.id, "quedo pendiente").catch(() => undefined);
  await first.stop();

  const adapter = new SlowAdapter();
  let sends = 0;
  const originalSend = adapter.sendMessage.bind(adapter);
  adapter.sendMessage = (...args) => {
    sends += 1;
    return originalSend(...args);
  };
  const second = new MessagingClient({ adapter, storage, session });
  await second.start({ waitForSync: false });

  await second.stop();
  adapter.releaseSync();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(sends, 0, "a stopped client should not be sending anything");
});

test("a client that could not catch up ends up stopped, not pretending to work", async () => {
  const { storage } = await fillTheStore();
  const adapter = new InMemoryAdapter();
  adapter.start = () => Promise.reject(new Error("that session is no good"));
  const client = new MessagingClient({ adapter, storage, session });
  const errors = [];
  client.on("error", error => errors.push(error.message));

  await client.start({ waitForSync: false });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.ok(errors.length > 0, "whoever is listening has to be told");
  // Starting again would throw if the client still thought it was running.
  adapter.start = InMemoryAdapter.prototype.start.bind(adapter);
  await client.start({ waitForSync: false });
  await client.stop();
});

test("starting the usual way still waits, so nothing changes for whoever did not ask", async () => {
  const { storage } = await fillTheStore();
  const adapter = new SlowAdapter();
  const client = new MessagingClient({ adapter, storage, session });
  let finished = false;

  const starting = client.start().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(finished, false, "it should still be waiting for the server");

  adapter.releaseSync();
  await starting;
  assert.equal(finished, true);
  await client.stop();
});
