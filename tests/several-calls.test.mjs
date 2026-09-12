import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

/**
 * More than one call at a time, which is what a phone on a desk does all day: one you are talking on, others
 * waiting on hold, and moving between them without losing any.
 *
 * Each call is its own thing with its own conversation, so what has to be true is that they do not tread on
 * one another: holding one leaves the other alone, hanging one up leaves the other going.
 */
async function calling() {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const withBob = await client.conversations.create({ participantIds: ["bob"], title: "bob" });
  const withCarol = await client.conversations.create({ participantIds: ["carol"], title: "carol" });
  return { client, withBob, withCarol };
}

test("two calls at once are both going on, and each is its own", async () => {
  const { client, withBob, withCarol } = await calling();

  const toBob = await client.calls.place(withBob.id, {});
  const toCarol = await client.calls.place(withCarol.id, {});

  const going = await client.calls.list();
  assert.equal(going.length, 2, "a second call replaced the first instead of joining it");
  assert.notEqual(toBob.id, toCarol.id);
  assert.deepEqual(going.map(call => call.conversationId).sort(), [withBob.id, withCarol.id].sort());
  await client.stop();
});

test("holding one leaves the other talking", async () => {
  const { client, withBob, withCarol } = await calling();
  const toBob = await client.calls.place(withBob.id, {});
  const toCarol = await client.calls.place(withCarol.id, {});

  await client.calls.hold(toBob.id, true);

  const going = await client.calls.list();
  assert.equal(going.find(call => call.id === toBob.id)?.isOnHold, true);
  assert.equal(going.find(call => call.id === toCarol.id)?.isOnHold, false, "holding one held the other too");
  await client.stop();
});

test("hanging one up leaves the other going", async () => {
  const { client, withBob, withCarol } = await calling();
  const toBob = await client.calls.place(withBob.id, {});
  const toCarol = await client.calls.place(withCarol.id, {});

  await client.calls.hangUp(toBob.id);

  const going = await client.calls.list();
  assert.equal(going.length, 1, "hanging one up took the other with it");
  assert.equal(going[0].id, toCarol.id);
  await client.stop();
});

test("silencing one does not silence the other", async () => {
  const { client, withBob, withCarol } = await calling();
  const toBob = await client.calls.place(withBob.id, {});
  const toCarol = await client.calls.place(withCarol.id, {});

  await client.calls.muteMicrophone(toBob.id, true);

  const going = await client.calls.list();
  assert.equal(going.find(call => call.id === toBob.id)?.isMicrophoneMuted, true);
  assert.equal(going.find(call => call.id === toCarol.id)?.isMicrophoneMuted, false);
  await client.stop();
});
