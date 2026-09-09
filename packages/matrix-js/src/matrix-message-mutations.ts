import { MsgType, RelationType, type MatrixClient } from "matrix-js-sdk";
import type { ConversationId, Message, MessageId } from "@relaykit/core";

export async function editMatrixMessage(
  client: MatrixClient,
  conversationId: ConversationId,
  message: Message,
  body: string
): Promise<Message> {
  await client.sendMessage(conversationId, {
    msgtype: MsgType.Text,
    body: `* ${body}`,
    "m.new_content": { msgtype: MsgType.Text, body },
    "m.relates_to": { rel_type: RelationType.Replace, event_id: message.id }
  });
  return { ...message, body, editedAt: Date.now() };
}

export async function deleteMatrixMessage(
  client: MatrixClient,
  conversationId: ConversationId,
  message: Message
): Promise<Message> {
  await client.redactEvent(conversationId, message.id);
  return { ...message, body: "", deletedAt: Date.now() };
}

export function findMessage(messages: readonly Message[], messageId: MessageId): Message {
  const message = messages.find(item => item.id === messageId);
  if (!message) {
    throw new Error("The message does not exist");
  }
  return message;
}
