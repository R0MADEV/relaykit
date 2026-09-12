import { M_POLL_END, M_POLL_RESPONSE, M_POLL_START, type MatrixClient, type Room } from "matrix-js-sdk";
import type { ConversationId, MessageId, Poll, PollAnswer, StartPollInput } from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";

/**
 * A poll in Matrix is three events that relate to each other: the question, the votes hanging off it, and the
 * close. The SDK names them, and it also knows the unstable name used by the clients that got there before
 * the spec did: without that, a poll started from Element would not show up here.
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
    // The same in plain text, for whoever knows nothing about polls: they see the question and the options.
    "m.text": [input.question, ...input.answers.map((text, index) => `${index + 1}. ${text}`)].join("\n")
  };
  const sent = await client.sendEvent(conversationId, M_POLL_START.name as never, content as never);
  // Sending it and seeing it are not the same moment. Whoever asks something is about to paint it, and an
  // empty list right after asking looks like nothing happened. If `start` gives back a poll, that poll exists.
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

/** Voting again does not add up: it replaces. The protocol itself says only the last vote of each person counts. */
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
  // As with asking: if voting comes back, the vote counts. Whoever just voted repaints the tally, and seeing
  // it unchanged looks like the vote was lost.
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

/** Closing is final: whatever stands at that moment is the result. */
export async function closeMatrixPoll(
  client: MatrixClient,
  conversationId: ConversationId,
  pollId: MessageId
): Promise<void> {
  await client.sendEvent(conversationId, M_POLL_END.name as never, {
    "m.relates_to": { rel_type: "m.reference", event_id: pollId },
    [M_POLL_END.name]: {},
    "m.text": "The poll has been closed"
  } as never);
  // And the same on closing: if closing comes back, it is closed.
  const room = await waitForRoom(client, conversationId);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (room.polls.get(pollId)?.isEnded) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * The SDK keeps the polls of a room and their votes, with the same "only the last vote" rule. It is asked
 * rather than walking the history counting references by hand.
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
  // Only the last vote of each person, which is what the protocol says.
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
