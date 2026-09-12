import { M_POLL_END, M_POLL_RESPONSE, M_POLL_START, type MatrixClient, type Room } from "matrix-js-sdk";
import type { ConversationId, MessageId, Poll, PollAnswer, StartPollInput } from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";

/**
 * Una encuesta en Matrix son tres eventos que se relacionan: la pregunta, los votos que cuelgan de ella y el
 * cierre. Los nombres los pone el SDK, que ademas conoce el nombre inestable que usan los clientes que se
 * adelantaron al spec: sin eso, una encuesta creada por Element no se veria aqui.
 */
export async function startMatrixPoll(
  client: MatrixClient,
  conversationId: ConversationId,
  input: StartPollInput
): Promise<Poll> {
  const answers = input.answers.map((text, index) => ({ id: `${index}`, "m.text": text }));
  const content = {
    [M_POLL_START.name]: {
      question: { "m.text": input.question },
      kind: "m.poll.undisclosed",
      max_selections: input.maxSelections ?? 1,
      answers
    },
    // Lo mismo en texto plano, para quien no sepa de encuestas: vera la pregunta y las opciones.
    "m.text": [input.question, ...input.answers.map((text, index) => `${index + 1}. ${text}`)].join("\n")
  };
  const sent = await client.sendEvent(conversationId, M_POLL_START.name as never, content as never);
  // Mandarla y verla no son el mismo momento. Quien la crea la va a pintar acto seguido, y una lista vacia
  // justo despues de preguntar algo parece que no ha funcionado.
  await waitUntilThePollArrives(client, conversationId, sent.event_id);
  return {
    id: sent.event_id,
    conversationId,
    question: input.question,
    answers: input.answers.map((text, index) => ({ id: `${index}`, text, votes: 0 })),
    startedBy: client.getSafeUserId(),
    startedAt: Date.now(),
    isClosed: false
  };
}

async function waitUntilThePollArrives(
  client: MatrixClient,
  conversationId: string,
  pollId: string,
  timeoutMs = 10000
): Promise<void> {
  const room = await waitForRoom(client, conversationId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (room.polls.has(pollId)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Votar otra vez no suma: sustituye. Es el propio protocolo el que dice que solo cuenta el ultimo voto. */
export async function voteInMatrixPoll(
  client: MatrixClient,
  conversationId: ConversationId,
  pollId: MessageId,
  answerId: string
): Promise<void> {
  const sent = await client.sendEvent(conversationId, M_POLL_RESPONSE.name as never, {
    "m.relates_to": { rel_type: "m.reference", event_id: pollId },
    [M_POLL_RESPONSE.name]: { answers: [answerId] }
  } as never);
  // Igual que al preguntar: si votar vuelve, el voto cuenta. Quien acaba de votar repinta el recuento, y verlo
  // igual que antes parece que el voto se ha perdido.
  await waitUntilTheAnswerArrives(client, conversationId, pollId, sent.event_id);
}

async function waitUntilTheAnswerArrives(
  client: MatrixClient,
  conversationId: string,
  pollId: string,
  answerId: string,
  timeoutMs = 10000
): Promise<void> {
  const room = await waitForRoom(client, conversationId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = room.polls.get(pollId);
    const responses = await poll?.getResponses();
    const hasIt = responses?.getRelations().some(response => response.getId() === answerId);
    if (hasIt) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Cerrar es definitivo: lo que valga en ese momento es el resultado. */
export async function closeMatrixPoll(
  client: MatrixClient,
  conversationId: ConversationId,
  pollId: MessageId
): Promise<void> {
  await client.sendEvent(conversationId, M_POLL_END.name as never, {
    "m.relates_to": { rel_type: "m.reference", event_id: pollId },
    [M_POLL_END.name]: {},
    "m.text": "La encuesta se ha cerrado"
  } as never);
  // Y lo mismo al cerrar: si cerrar vuelve, esta cerrada.
  const room = await waitForRoom(client, conversationId);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (room.polls.get(pollId)?.isEnded) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * El SDK mantiene las encuestas de una sala y sus votos, con la misma regla de "solo el ultimo voto". Se le
 * pregunta a el en vez de recorrer el historial contando referencias a mano.
 */
export async function listMatrixPolls(
  client: MatrixClient,
  conversationId: ConversationId
): Promise<readonly Poll[]> {
  const room = await waitForRoom(client, conversationId);
  const polls = [...room.polls.values()];
  return Promise.all(polls.map(poll => describe(client, room, poll)));
}

async function describe(client: MatrixClient, room: Room, poll: {
  pollId: string;
  pollEvent: { question: { text: string }; answers: readonly { id: string; text: string }[] };
  isEnded: boolean;
  getResponses: () => Promise<{ getRelations: () => readonly { getSender: () => string | undefined; getContent: () => Record<string, unknown> }[] }>;
}): Promise<Poll> {
  const responses = await poll.getResponses();
  // Solo el ultimo voto de cada persona, que es lo que dice el protocolo.
  const lastByPerson = new Map<string, string>();
  for (const response of responses.getRelations()) {
    const sender = response.getSender();
    const chosen = (response.getContent()[M_POLL_RESPONSE.name] as { answers?: string[] } | undefined)?.answers?.[0];
    if (sender && chosen) lastByPerson.set(sender, chosen);
  }
  const chosen = [...lastByPerson.values()];
  const answers: PollAnswer[] = poll.pollEvent.answers.map(answer => ({
    id: answer.id,
    text: answer.text,
    votes: chosen.filter(answerId => answerId === answer.id).length
  }));
  const own = lastByPerson.get(client.getSafeUserId());
  return {
    id: poll.pollId,
    conversationId: room.roomId,
    question: poll.pollEvent.question.text,
    answers,
    startedBy: client.getSafeUserId(),
    startedAt: Date.now(),
    isClosed: poll.isEnded,
    ...(own ? { ownAnswerId: own } : {})
  };
}
