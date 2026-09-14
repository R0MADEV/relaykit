import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, createMessageTimeline } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * A conversation with more said in it than a screen opens with, read by a device that was not there when it
 * was said: no local copy, so what is on screen is what the homeserver has handed over and nothing else.
 */
async function conversationOf(said, showAtMost) {
  const adapter = new InMemoryAdapter({ showAtMost });
  const writing = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await writing.start();
  const conversation = await writing.conversations.create({ participantIds: ["bob"] });
  for (let at = 1; at <= said; at += 1) {
    await writing.messages.send(conversation.id, `dicho ${at}`);
    // Far enough apart to be ordered by when they were said rather than by the tie breaker.
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  await writing.stop();

  const client = new MessagingClient({ adapter, session });
  await client.start();
  return { client, conversation };
}

test("a timeline opens with what a screen holds and can go back for the rest", async () => {
  const { client, conversation } = await conversationOf(12, 5);
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  assert.deepEqual(
    timeline.get().map(message => message.body),
    ["dicho 8", "dicho 9", "dicho 10", "dicho 11", "dicho 12"]
  );

  assert.equal(await timeline.loadMore(4), true, "there is more before it");
  assert.deepEqual(
    timeline.get().map(message => message.body),
    ["dicho 4", "dicho 5", "dicho 6", "dicho 7", "dicho 8", "dicho 9", "dicho 10", "dicho 11", "dicho 12"]
  );

  timeline.stop();
  await client.stop();
});

test("a timeline that has reached the start of the conversation says there is no more", async () => {
  const { client, conversation } = await conversationOf(3, 2);
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  assert.equal(await timeline.loadMore(10), false);
  assert.equal(timeline.get().length, 3);

  timeline.stop();
  await client.stop();
});

test("a timeline that was never told a limit shows everything and has nothing to go back for", async () => {
  const { client, conversation } = await conversationOf(4);
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  assert.equal(timeline.get().length, 4);
  assert.equal(await timeline.loadMore(10), false);

  timeline.stop();
  await client.stop();
});

test("going back never loses what is already on screen, whatever comes back", async () => {
  const { client, conversation } = await conversationOf(6, 3);
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  const was = timeline.get().map(message => message.body);
  // Older history is out of reach right now, which is the moment a local copy is all there is to show.
  client.messages.loadMore = async () => ({ messages: [], hasMore: false });

  assert.equal(await timeline.loadMore(3), false);

  assert.deepEqual(
    timeline.get().map(message => message.body),
    was,
    "a timeline that could not reach further back must keep what it had"
  );
  timeline.stop();
  await client.stop();
});
