import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * A poll is not a message with buttons: it is a question, some answers and each person's vote, and it has to
 * be closeable. Whoever votes can change their mind, and only their last vote counts.
 */
async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "decisiones" });
  return { client, conversation };
}

test("something can be asked with several answers", async () => {
  const { client, conversation } = await startClient();

  const poll = await client.polls.start(conversation.id, {
    question: "¿A que hora comemos?",
    answers: ["A las 14", "A las 15"]
  });

  assert.equal(poll.question, "¿A que hora comemos?");
  assert.deepEqual(poll.answers.map(answer => answer.text), ["A las 14", "A las 15"]);
  assert.equal(poll.isClosed, false);
  await client.stop();
});

test("a question with no answers is not a poll", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(
    client.polls.start(conversation.id, { question: "¿Y bien?", answers: [] }),
    { code: "INVALID_INPUT" }
  );
  await assert.rejects(
    client.polls.start(conversation.id, { question: "   ", answers: ["si", "no"] }),
    { code: "INVALID_INPUT" }
  );
  await client.stop();
});

test("a vote counts, and so does changing your mind: only the last one stands", async () => {
  const { client, conversation } = await startClient();
  const poll = await client.polls.start(conversation.id, {
    question: "¿A que hora comemos?",
    answers: ["A las 14", "A las 15"]
  });

  await client.polls.vote(conversation.id, poll.id, poll.answers[0].id);
  await client.polls.vote(conversation.id, poll.id, poll.answers[1].id);

  const [visto] = await client.polls.list(conversation.id);
  assert.equal(visto.answers[0].votes, 0, "el primer voto siguio contando");
  assert.equal(visto.answers[1].votes, 1);
  await client.stop();
});

test("a poll can be closed, and after that there is no voting", async () => {
  const { client, conversation } = await startClient();
  const poll = await client.polls.start(conversation.id, {
    question: "¿A que hora comemos?",
    answers: ["A las 14", "A las 15"]
  });

  await client.polls.close(conversation.id, poll.id);

  const [cerrada] = await client.polls.list(conversation.id);
  assert.equal(cerrada.isClosed, true);
  await assert.rejects(
    client.polls.vote(conversation.id, poll.id, poll.answers[0].id),
    { code: "INVALID_INPUT" }
  );
  await client.stop();
});
