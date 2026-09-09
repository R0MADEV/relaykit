import { EventType, RelationType, type MatrixClient } from "matrix-js-sdk";
import type { ConversationId, MessageId, Reaction } from "@relaykit/core";

export async function addMatrixReaction(
  client: MatrixClient,
  conversationId: ConversationId,
  messageId: MessageId,
  key: string
): Promise<Reaction> {
  const response = await client.sendEvent(conversationId, EventType.Reaction, {
    "m.relates_to": { rel_type: RelationType.Annotation, event_id: messageId, key }
  });
  const senderId = client.getUserId();
  if (!senderId) {
    throw new Error("Matrix client has no user ID");
  }
  return { id: response.event_id, messageId, senderId, key, createdAt: Date.now() };
}

export async function removeMatrixReaction(
  client: MatrixClient,
  conversationId: ConversationId,
  reactionId: string
): Promise<void> {
  await client.redactEvent(conversationId, reactionId);
}
