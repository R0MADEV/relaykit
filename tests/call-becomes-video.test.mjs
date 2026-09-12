import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

/**
 * A call that starts as a voice call and turns into a video one without ending, which is what anybody on a
 * phone expects: you are talking, you turn the camera on, you turn it off again, and the call carries on
 * throughout.
 *
 * Turning the camera on mid-call is the SDK's own upgrade: it asks for the camera, adds it to what is already
 * going and agrees the new shape with the other side. The call keeps its identity, so whatever was drawn for
 * it stays drawn.
 */
async function calling() {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "growing" });
  return { client, conversation };
}

test("a voice call turns into a video one without ending", async () => {
  const { client, conversation } = await calling();
  const call = await client.calls.place(conversation.id, { video: false });
  assert.equal(call.isVideo, false);

  await client.calls.muteCamera(call.id, false);

  const going = (await client.calls.list()).find(item => item.id === call.id);
  assert.ok(going, "the call ended when the camera was turned on");
  assert.equal(going.isVideo, true, "the call turned the camera on and still says it has no video");
  assert.equal(going.isCameraMuted, false);
  await client.stop();
});

test("and back to voice, still the same call", async () => {
  const { client, conversation } = await calling();
  const call = await client.calls.place(conversation.id, { video: true });

  await client.calls.muteCamera(call.id, true);

  const going = (await client.calls.list()).find(item => item.id === call.id);
  assert.ok(going, "the call ended when the camera was put away");
  assert.equal(going.isCameraMuted, true);
  assert.equal(going.state, "connected", "putting the camera away should not change what the call is doing");
  await client.stop();
});
