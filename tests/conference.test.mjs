import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * A conference is a call that is joined instead of answered: it is already going on, nobody is rung, and it
 * carries on when somebody leaves. A call between two people is one of these with two people in it, which is
 * why there is no separate thing for it.
 */
async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "conference" });
  return { adapter, client, conversation };
}

test("a conference is joined without ringing anybody", async () => {
  const { client, conversation } = await startClient();

  const call = await client.calls.join(conversation.id);

  assert.equal(call.conversationId, conversation.id);
  assert.equal(call.kind, "conference");
  // Nobody has to answer, so there is nothing to wait for.
  assert.equal(call.state, "connected");
  // A screen draws a padlock on this, and a conference that cannot say so is one that is not.
  assert.equal(call.isEncrypted, true);
  await client.stop();
});

test("a placed call is a direct one, so a screen knows it can be refused", async () => {
  const { client, conversation } = await startClient();

  const call = await client.calls.place(conversation.id, {});

  assert.equal(call.kind, "direct");
  await client.stop();
});

test("a conference says who is in it, because a screen draws one box each", async () => {
  const { client, conversation } = await startClient();

  const call = await client.calls.join(conversation.id);

  assert.deepEqual(
    call.participants.map(participant => participant.userId),
    ["alice"]
  );
  await client.stop();
});

test("somebody else joining is announced, so the screen adds a box", async () => {
  const { adapter, client, conversation } = await startClient();
  const call = await client.calls.join(conversation.id);
  const changed = new Promise(resolve => client.on("call.changed", resolve));

  adapter.joinCallAs(call.id, "bob");

  const seen = await changed;
  assert.deepEqual(
    seen.participants.map(participant => participant.userId),
    ["alice", "bob"]
  );
  await client.stop();
});

test("joining what is already joined does not start a second call", async () => {
  const { client, conversation } = await startClient();

  const first = await client.calls.join(conversation.id);
  const again = await client.calls.join(conversation.id);

  assert.equal(again.id, first.id);
  assert.equal((await client.calls.list()).length, 1);
  await client.stop();
});

test("leaving a conference takes this side out of it", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.join(conversation.id);

  await client.calls.hangUp(call.id);

  assert.deepEqual(await client.calls.list(), []);
  await client.stop();
});

test("a conference the others are still in carries on without this side", async () => {
  const { adapter, client, conversation } = await startClient();
  const call = await client.calls.join(conversation.id);
  adapter.joinCallAs(call.id, "bob");

  await client.calls.hangUp(call.id);

  // Leaving is not ending it: bob is still talking, and coming back has to find the same call.
  assert.equal(adapter.callIsGoingOn(call.id), true);
  await client.stop();
});

test("joining a conversation that is not there is refused", async () => {
  const { client } = await startClient();

  await assert.rejects(client.calls.join("!nowhere:localhost"), { code: "CONVERSATION_NOT_FOUND" });
  await client.stop();
});

test("a conference is left, not put on hold", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.join(conversation.id);

  // Nobody is waiting on the other end of a room, so there is nothing to make wait.
  await assert.rejects(client.calls.hold(call.id, true), { code: "NOT_SUPPORTED" });
  await client.stop();
});

test("a conference cannot be handed to somebody, because it is not a line", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.join(conversation.id);

  await assert.rejects(client.calls.transfer(call.id, "carol"), { code: "NOT_SUPPORTED" });
  await assert.rejects(client.calls.pressDigit(call.id, "1"), { code: "NOT_SUPPORTED" });
  await client.stop();
});

test("who is talking is told apart, so a grid is not repainted for it", async () => {
  const { adapter, client, conversation } = await startClient();
  const call = await client.calls.join(conversation.id);
  adapter.joinCallAs(call.id, "bob");
  const spoke = new Promise(resolve => client.on("call.speaking", resolve));

  adapter.startSpeaking(call.id, ["bob"]);

  const { callId, userIds } = await spoke;
  assert.equal(callId, call.id);
  assert.deepEqual(userIds, ["bob"]);
  await client.stop();
});

test("a conference somebody else starts is announced, so a screen can offer to join", async () => {
  const { adapter, client, conversation } = await startClient();
  const announced = new Promise(resolve => client.on("call.incoming", resolve));

  adapter.startConferenceAs(conversation.id, "bob");

  const call = await announced;
  assert.equal(call.kind, "conference");
  // Going on without this side, which for a room is what ringing means: there is something to join.
  assert.equal(call.state, "ringing");
  assert.deepEqual(
    call.participants.map(participant => participant.userId),
    ["bob"]
  );
  await client.stop();
});

test("joining what was announced is the same call, now with this side in it", async () => {
  const { adapter, client, conversation } = await startClient();
  const announced = new Promise(resolve => client.on("call.incoming", resolve));
  adapter.startConferenceAs(conversation.id, "bob");
  const ringing = await announced;

  const joined = await client.calls.join(conversation.id);

  assert.equal(joined.id, ringing.id);
  assert.equal(joined.state, "connected");
  assert.deepEqual(
    joined.participants.map(participant => participant.userId),
    ["bob", "alice"]
  );
  await client.stop();
});

test("a conference that everybody left is over, even for whoever never joined", async () => {
  const { adapter, client, conversation } = await startClient();
  const announced = new Promise(resolve => client.on("call.incoming", resolve));
  adapter.startConferenceAs(conversation.id, "bob");
  const ringing = await announced;
  const changed = new Promise(resolve => client.on("call.changed", resolve));

  adapter.endConference(ringing.id);

  assert.equal((await changed).state, "ended");
  assert.deepEqual(await client.calls.list(), []);
  await client.stop();
});
