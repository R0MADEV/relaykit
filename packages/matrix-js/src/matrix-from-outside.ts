import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

import { RelayKitError, type ConversationId, type MessageId, type MessageSurroundings } from "@relaykit/core";
import { mapMessages } from "./matrix-mapper.js";

/**
 * One message with what was said on either side of it.
 *
 * The homeserver looks it up: what a client has is whatever the sync happened to bring, and a message found
 * by searching is almost never in it. The SDK builds a timeline round the message and says where in it the
 * message itself sits, so the two sides are read off from there rather than counted here.
 */
export async function readAroundMatrixMessage(
  client: MatrixClient,
  conversationId: ConversationId,
  messageId: MessageId,
  limit: number
): Promise<MessageSurroundings> {
  const room = client.getRoom(conversationId);
  if (!room) {
    throw new RelayKitError("CONVERSATION_NOT_FOUND", `There is no conversation called ${conversationId}`);
  }
  const timeline = await client
    .getEventTimeline(room.getUnfilteredTimelineSet(), messageId)
    .catch(() => null);
  if (!timeline) throw new RelayKitError("MESSAGE_NOT_FOUND", `There is no message called ${messageId}`);
  const events = timeline.getEvents();
  const at = events.findIndex(event => event.getId() === messageId);
  if (at < 0) throw new RelayKitError("MESSAGE_NOT_FOUND", `There is no message called ${messageId}`);
  for (const event of events) {
    if (event.isEncrypted()) await client.decryptEventIfNeeded(event);
  }
  const [message] = await mapMessages([events[at] as MatrixEvent]);
  if (!message) throw new RelayKitError("MESSAGE_NOT_FOUND", `There is no message called ${messageId}`);
  return {
    message,
    before: await mapMessages(events.slice(Math.max(0, at - limit), at)),
    after: await mapMessages(events.slice(at + 1, at + 1 + limit))
  };
}
