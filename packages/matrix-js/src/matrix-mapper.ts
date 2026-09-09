import { MatrixEvent, NotificationCountType, RelationType, type Room } from "matrix-js-sdk";
import type { Attachment, Conversation, MediaRef, Message, PresenceState, Reaction, ReadReceipt, TypingUpdate, UserPresence } from "@relaykit/core";
import { isDirectRoom } from "./matrix-conversations.js";

const presenceStates: readonly PresenceState[] = ["online", "offline", "unavailable"];

interface MatrixReceiptContent {
  readonly [eventId: string]: { readonly "m.read"?: { readonly [userId: string]: { readonly ts?: unknown } } };
}

interface MatrixPresenceContent {
  readonly presence?: unknown;
  readonly status_msg?: unknown;
  readonly last_active_ago?: unknown;
}

interface MatrixMessageContent {
  readonly body?: unknown;
  readonly msgtype?: string;
  readonly url?: unknown;
  readonly file?: { readonly url?: unknown };
  readonly info?: {
    readonly mimetype?: unknown;
    readonly size?: unknown;
    readonly w?: unknown;
    readonly h?: unknown;
    readonly thumbnail_url?: unknown;
    readonly thumbnail_file?: { readonly url?: unknown };
    readonly thumbnail_info?: { readonly mimetype?: unknown; readonly size?: unknown; readonly w?: unknown; readonly h?: unknown };
  };
  readonly "m.new_content"?: { readonly body?: unknown };
  readonly "m.relates_to"?: {
    readonly event_id?: string;
    readonly rel_type?: string;
    readonly "m.in_reply_to"?: { readonly event_id?: string };
  };
}

const attachmentMsgTypes = new Set(["m.file", "m.image", "m.video", "m.audio"]);

function mapAttachment(content: MatrixMessageContent, name: string): Attachment | undefined {
  if (!attachmentMsgTypes.has(String(content.msgtype))) return undefined;
  const url = typeof content.file?.url === "string" ? content.file.url : content.url;
  if (typeof url !== "string") return undefined;
  const info = content.info ?? {};
  const thumbnail = mapThumbnail(info);
  return {
    id: url,
    name,
    mimeType: typeof info.mimetype === "string" ? info.mimetype : "application/octet-stream",
    ...(typeof info.size === "number" ? { size: info.size } : {}),
    ...(typeof info.w === "number" ? { width: info.w } : {}),
    ...(typeof info.h === "number" ? { height: info.h } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    source: JSON.stringify(content.file ? { url, file: content.file } : { url })
  };
}

function mapThumbnail(info: NonNullable<MatrixMessageContent["info"]>): MediaRef | undefined {
  const url = typeof info.thumbnail_file?.url === "string" ? info.thumbnail_file.url : info.thumbnail_url;
  if (typeof url !== "string") return undefined;
  const thumbnailInfo = info.thumbnail_info ?? {};
  return {
    mimeType: typeof thumbnailInfo.mimetype === "string" ? thumbnailInfo.mimetype : "application/octet-stream",
    ...(typeof thumbnailInfo.size === "number" ? { size: thumbnailInfo.size } : {}),
    ...(typeof thumbnailInfo.w === "number" ? { width: thumbnailInfo.w } : {}),
    ...(typeof thumbnailInfo.h === "number" ? { height: thumbnailInfo.h } : {}),
    source: JSON.stringify(info.thumbnail_file ? { url, file: info.thumbnail_file } : { url })
  };
}

export function mapMessages(events: readonly MatrixEvent[]): Message[] {
  const messages: Message[] = [];
  for (const event of events) {
    const message = mapMessage(event);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

export function mapConversation(room: Room): Conversation {
  const messages = mapMessages(room.getLiveTimeline().getEvents());
  const lastMessage = messages.at(-1);
  const conversation: Conversation = {
    id: room.roomId,
    title: room.name,
    // Whoever left or was banned is no longer part of the conversation, only those in it or invited to it.
    participantIds: room.getMembers()
      .filter(member => member.membership === "join" || member.membership === "invite")
      .map(member => member.userId),
    membership: room.getMyMembership() === "invite" ? "invite" : "join",
    unreadCount: room.getUnreadNotificationCount(NotificationCountType.Total),
    ...(isDirectRoom(room) ? { isDirect: true } : {})
  };

  return lastMessage ? { ...conversation, lastMessage } : conversation;
}

export function mapMessage(event: MatrixEvent): Message | undefined {
  if (event.getType() !== "m.room.message") {
    return undefined;
  }

  const content = event.getContent<MatrixMessageContent>();
  // The SDK puts its own "unable to decrypt" notice in the body, which is not something to show as a message.
  const undecryptable = event.isDecryptionFailure();
  const relation = content["m.relates_to"];
  const isEdit = relation?.rel_type === RelationType.Replace;
  const editedBody = content["m.new_content"]?.body;
  const bodyValue = isEdit && typeof editedBody === "string" ? editedBody : content.body;
  const body = undecryptable ? "" : (typeof bodyValue === "string" ? bodyValue : undefined);
  const relatedMessageId = relation?.event_id;
  const id = relatedMessageId ?? event.getId();
  const senderId = event.getSender();
  const conversationId = event.getRoomId();
  const transactionId = event.getUnsigned().transaction_id;

  if (body === undefined || (!body && !undecryptable) || !id || !senderId || !conversationId) {
    return undefined;
  }

  const attachment = mapAttachment(content, body);
  const replyToId = relation?.["m.in_reply_to"]?.event_id;
  const message: Message = {
    id,
    conversationId,
    senderId,
    body,
    createdAt: event.getTs(),
    status: "sent",
    ...(transactionId ? { transactionId } : {}),
    ...(isEdit ? { editedAt: event.getTs() } : {}),
    ...(attachment ? { attachment } : {}),
    ...(replyToId ? { replyToId } : {}),
    ...(undecryptable ? { undecryptable: true } : {})
  };

  return message;
}

export function isMessageEdit(event: MatrixEvent): boolean {
  const content = event.getContent<MatrixMessageContent>();
  return content["m.relates_to"]?.rel_type === RelationType.Replace;
}

export function mapReaction(event: MatrixEvent): Reaction | undefined {
  if (event.getType() !== "m.reaction") {
    return undefined;
  }

  const content = event.getContent<{ "m.relates_to"?: {
    event_id?: string;
    key?: string;
    rel_type?: string;
  } }>();
  const relation = content["m.relates_to"];
  const id = event.getId();
  const senderId = event.getSender();

  if (relation?.rel_type !== RelationType.Annotation || !relation.event_id || !relation.key || !id || !senderId) {
    return undefined;
  }

  return {
    id,
    messageId: relation.event_id,
    senderId,
    key: relation.key,
    createdAt: event.getTs()
  };
}

export function mapRedactedMessage(redacted: MatrixEvent, redaction: MatrixEvent): Message | undefined {
  if (redacted.getType() !== "m.room.message") {
    return undefined;
  }
  const id = redacted.getId();
  const senderId = redacted.getSender();
  const conversationId = redacted.getRoomId();
  if (!id || !senderId || !conversationId) {
    return undefined;
  }
  return {
    id,
    conversationId,
    senderId,
    body: "",
    createdAt: redacted.getTs(),
    status: "sent",
    deletedAt: redaction.getTs()
  };
}

export function mapReadReceipts(event: MatrixEvent): ReadReceipt[] {
  const conversationId = event.getRoomId();
  if (!conversationId) {
    return [];
  }
  const content = event.getContent<MatrixReceiptContent>();
  const receipts: ReadReceipt[] = [];
  for (const [messageId, receiptTypes] of Object.entries(content)) {
    for (const [userId, receipt] of Object.entries(receiptTypes["m.read"] ?? {})) {
      const readAt = typeof receipt.ts === "number" ? receipt.ts : Date.now();
      receipts.push({ conversationId, messageId, userId, readAt });
    }
  }
  return receipts;
}

export function mapTyping(event: MatrixEvent): TypingUpdate | undefined {
  const conversationId = event.getRoomId();
  if (!conversationId) {
    return undefined;
  }
  const userIds = event.getContent<{ user_ids?: unknown }>().user_ids;
  return { conversationId, userIds: Array.isArray(userIds) ? userIds.filter(isString) : [] };
}

export function mapPresence(event: MatrixEvent, now: number): UserPresence | undefined {
  const userId = event.getSender();
  const content = event.getContent<MatrixPresenceContent>();
  const presence = presenceStates.find(state => state === content.presence);
  if (!userId || !presence) {
    return undefined;
  }
  return {
    userId,
    presence,
    ...(typeof content.status_msg === "string" ? { statusMessage: content.status_msg } : {}),
    ...(typeof content.last_active_ago === "number" ? { lastActiveAt: now - content.last_active_ago } : {})
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
