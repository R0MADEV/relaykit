import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * Una encuesta no es un mensaje con botones: es una pregunta, unas respuestas y los votos de cada quien, y
 * tiene que poder cerrarse. Quien vota puede cambiar de idea, y solo cuenta su ultimo voto.
 */
async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "decisiones" });
  return { client, conversation };
}

test("se puede preguntar algo con varias respuestas", async () => {
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

test("una pregunta sin respuestas no es una encuesta", async () => {
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

test("votar cuenta, y cambiar de idea tambien: solo vale el ultimo voto", async () => {
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

test("una encuesta se puede cerrar, y despues ya no se vota", async () => {
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
