import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(howMany) {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const made = [];
  for (let index = 0; index < howMany; index += 1) {
    const conversation = await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` });
    adapter.receiveMessage(conversation.id, "bob", `algo ${index}`, { createdAt: 1000 + index });
    made.push(conversation);
  }
  return { adapter, client, made };
}

test("a screen can ask for only the first few conversations", async () => {
  const { client } = await startClient(60);

  const shown = await client.conversations.list({ limit: 40 });

  assert.equal(shown.length, 40);
  await client.stop();
});

test("the ones it gives are the ones with the most recent activity", async () => {
  const { client, made } = await startClient(10);

  const shown = await client.conversations.list({ limit: 3 });

  assert.deepEqual(shown.map(item => item.id), [made[9].id, made[8].id, made[7].id]);
  await client.stop();
});

test("asking for more than there are gives what there is", async () => {
  const { client } = await startClient(5);

  const shown = await client.conversations.list({ limit: 40 });

  assert.equal(shown.length, 5);
  await client.stop();
});

test("scrolling on asks for more and keeps the same order", async () => {
  const { client, made } = await startClient(10);

  const firstFew = await client.conversations.list({ limit: 4 });
  const more = await client.conversations.list({ limit: 8 });

  assert.deepEqual(more.slice(0, 4).map(item => item.id), firstFew.map(item => item.id));
  assert.equal(more.length, 8);
  assert.equal(made.length, 10);
  await client.stop();
});

test("asking without saying how many gives them all, as before", async () => {
  const { client } = await startClient(12);

  const shown = await client.conversations.list();

  assert.equal(shown.length, 12);
  await client.stop();
});

test("a number that is not a count is refused", async () => {
  const { client } = await startClient(3);

  await assert.rejects(client.conversations.list({ limit: 0 }), /how many/i);
  await client.stop();
});

test("conversations with nothing said in them keep a steady order as more arrive", async () => {
  const { adapter, client } = await startClient(4);
  // A conversation nobody has said anything in, which is what ties the order.
  const quiet = [];
  for (let index = 0; index < 6; index += 1) {
    quiet.push(await client.conversations.create({ participantIds: ["bob"], title: `Callada ${index}` }));
  }

  const firstFew = await client.conversations.list({ limit: 6 });
  const more = await client.conversations.list({ limit: 10 });

  assert.deepEqual(
    more.slice(0, 6).map(item => item.id),
    firstFew.map(item => item.id),
    "asking for more must not reshuffle what was already on screen"
  );
  assert.equal(quiet.length, 6);
  assert.notEqual(adapter, undefined);
  await client.stop();
});
