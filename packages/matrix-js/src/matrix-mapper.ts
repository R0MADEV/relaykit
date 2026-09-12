import {
  MsgType,
  ReceiptType,
  EventType, MatrixEvent, NotificationCountType, RelationType, type Room } from "matrix-js-sdk";
import type {
  Attachment,
  Conversation,
  MediaRef,
  Mentions,
  Message,
  GeoLocation,
  HistoryVisibility,
  JoinRule,
  MessageKind,
  NotificationLevel,
  Reaction,
  ReadReceipt,
  VoiceInfo,
  TypingUpdate,
  UserPresence
} from "@relaykit/core";
import { isDirectRoom } from "./matrix-conversations.js";

import { presenceStates } from "@relaykit/core";

interface MatrixReceiptContent {
  readonly [eventId: string]: { readonly [ReceiptType.Read]?: { readonly [userId: string]: { readonly ts?: unknown } } };
}

interface MatrixPresenceContent {
  readonly presence?: unknown;
  readonly status_msg?: unknown;
  readonly last_active_ago?: unknown;
}

interface MatrixMessageContent {
  readonly body?: unknown;
  readonly msgtype?: string;
  readonly format?: string;
  readonly formatted_body?: string;
  readonly "m.mentions"?: { readonly user_ids?: string[]; readonly room?: boolean };
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
    /** The colours of the image, blurred, where the clients that paint them put them. */
    readonly "xyz.amorgan.blurhash"?: unknown;
  };
  readonly "m.new_content"?: { readonly body?: unknown };
  readonly "m.relates_to"?: {
    readonly event_id?: string;
    readonly rel_type?: string;
    readonly is_falling_back?: boolean;
    readonly "m.in_reply_to"?: { readonly event_id?: string };
  };
}

const attachmentMsgTypes = new Set<string>([MsgType.File, MsgType.Image, MsgType.Video, MsgType.Audio]);

function mapAttachment(content: MatrixMessageContent, name: string): Attachment | undefined {
  if (!attachmentMsgTypes.has(String(content.msgtype))) return undefined;
  const url = typeof content.file?.url === "string" ? content.file.url : content.url;
  if (typeof url !== "string") return undefined;
  const info = content.info ?? {};
  const thumbnail = mapThumbnail(info);
  const blurhash = info["xyz.amorgan.blurhash"];
  return {
    ...(typeof blurhash === "string" ? { blurhash } : {}),
    id: url,
    name,
    mimeType: typeof info.mimetype === "string" ? info.mimetype : "application/octet-stream",
    ...(typeof info.size === "number" ? { size: info.size } : {}),
    ...(typeof info.w === "number" ? { width: info.w } : {}),
    ...(typeof info.h === "number" ? { height: info.h } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(mapVoice(content) ?? {}),
    source: JSON.stringify(content.file ? { url, file: content.file } : { url })
  };
}

/** A voice note says so with an empty marker; without it an audio file is just a file somebody attached. */
function mapVoice(content: MatrixMessageContent): { voice: VoiceInfo } | undefined {
  const record = content as unknown as Record<string, unknown>;
  if (record["org.matrix.msc3245.voice"] === undefined) return undefined;
  const audio = (record["org.matrix.msc1767.audio"] ?? {}) as { duration?: unknown; waveform?: unknown };
  const fallback = (content.info as { duration?: unknown } | undefined)?.duration;
  const duration = typeof audio.duration === "number" ? audio.duration : fallback;
  if (typeof duration !== "number") return undefined;
  const waveform = Array.isArray(audio.waveform) ? audio.waveform.filter(value => typeof value === "number") : [];
  return { voice: { durationMs: duration, ...(waveform.length > 0 ? { waveform } : {}) } };
}

/** A place is read from the pieces when they are there, and from the geo URI when they are not. */
function mapLocation(content: MatrixMessageContent): { location: GeoLocation } | undefined {
  if (content.msgtype !== MsgType.Location) return undefined;
  const record = content as unknown as Record<string, unknown>;
  const asset = (record["org.matrix.msc3488.location"] ?? {}) as { uri?: unknown; description?: unknown };
  const uri = typeof asset.uri === "string" ? asset.uri : record["geo_uri"];
  if (typeof uri !== "string" || !uri.startsWith("geo:")) return undefined;
  const [latitude, longitude] = uri.slice(4).split(";")[0]?.split(",").map(Number) ?? [];
  if (latitude === undefined || longitude === undefined || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return undefined;
  }
  const description = typeof asset.description === "string" ? asset.description : undefined;
  return { location: { latitude, longitude, ...(description ? { description } : {}) } };
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
    // A local echo has no server id yet. Its state belongs to the outbox, which knows if it is still going out.
    if (event.getId()?.startsWith("~")) continue;
    const message = mapMessage(event);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

/**
 * Somebody who read a conversation and put it back on the pile. It is their own mark, kept alongside the
 * conversation, and absent when nobody ever made one.
 */
function mapUnreadMark(room: Room): { isUnread: boolean } | undefined {
  const marked = room.getAccountData(EventType.MarkedUnread)?.getContent<{ unread?: boolean }>();
  return typeof marked?.unread === "boolean" ? { isUnread: marked.unread } : undefined;
}

export function mapConversation(room: Room): Conversation {
  const messages = mapMessages(room.getLiveTimeline().getEvents());
  const lastMessage = messages.at(-1);
  const members = room.getMembers()
    .filter(member => member.membership === "join" || member.membership === "invite");
  const conversation: Conversation = {
    id: room.roomId,
    title: room.name,
    // Whoever left or was banned is no longer part of the conversation, only those in it or invited to it.
    participantIds: members.map(member => member.userId),
    invitedIds: members.filter(member => member.membership === "invite").map(member => member.userId),
    // Whoever asked to come in is still at the door, so they are listed apart from the participants.
    knockingIds: room.getMembers().filter(member => member.membership === "knock").map(member => member.userId),
    membership: room.getMyMembership() === "invite" ? "invite" : "join",
    unreadCount: room.getUnreadNotificationCount(NotificationCountType.Total),
    ...(isDirectRoom(room) ? { isDirect: true } : {}),
    ...(room.tags?.["m.favourite"] ? { isFavourite: true } : {}),
    isEncrypted: room.hasEncryptionStateEvent(),
    ...(mapUnreadMark(room) ?? {}),
    ...(mapTopic(room) ?? {}),
    ...(mapRoomAvatar(room) ?? {}),
    ...(mapNotifications(room) ?? {}),
    ...(mapJoinRule(room) ?? {}),
    ...(mapHistoryVisibility(room) ?? {}),
    ...(mapReadMarker(room) ?? {}),
    ...(mapAlias(room) ?? {}),
    ...(mapPinned(room) ?? {}),
    ...(mapReplacement(room) ?? {}),
    ...(mapPredecessor(room) ?? {})
  };

  return lastMessage ? { ...conversation, lastMessage } : conversation;
}

/**
 * How loud a conversation is allowed to be is a push rule, and the two quiet settings are told apart the way
 * every other Matrix client tells them apart: an override rule silences the room, a room rule leaves only mentions.
 */
function mapNotifications(room: Room): { notifications: NotificationLevel } | undefined {
  const rules = room.client?.pushRules?.global;
  const isForThisRoom = (rule: { rule_id?: string; enabled?: boolean }) =>
    rule.rule_id === room.roomId && rule.enabled !== false;
  if (rules?.override?.some(isForThisRoom)) return { notifications: "none" };
  if (rules?.room?.some(isForThisRoom)) return { notifications: "mentions" };
  return undefined;
}

const joinRuleNames: Record<string, JoinRule> = { invite: "invite", public: "public", knock: "knock" };

const historyVisibilityNames: Record<string, HistoryVisibility> = {
  world_readable: "world",
  shared: "shared",
  invited: "invited",
  joined: "joined"
};

/** Where this person stopped reading, which is their own decision and travels with their account. */
/** The name people type, which is the canonical alias and not any of the other names pointing here. */
/** A conversation nobody talks in any more says where everyone went, so nobody is left behind in it. */
function mapReplacement(room: Room): { replacedBy: string } | undefined {
  const replacement = room.currentState
    .getStateEvents(EventType.RoomTombstone, "")
    ?.getContent<{ replacement_room?: string }>().replacement_room;
  return typeof replacement === "string" && replacement.length > 0 ? { replacedBy: replacement } : undefined;
}

function mapPredecessor(room: Room): { replaces: string } | undefined {
  const predecessor = room.currentState
    .getStateEvents(EventType.RoomCreate, "")
    ?.getContent<{ predecessor?: { room_id?: string } }>().predecessor;
  const previous = predecessor?.room_id;
  return typeof previous === "string" && previous.length > 0 ? { replaces: previous } : undefined;
}

/** What this conversation keeps to hand, so it is still known when there is no homeserver to ask. */
function mapPinned(room: Room): { pinnedIds: readonly string[] } | undefined {
  const pinned = room.currentState
    .getStateEvents(EventType.RoomPinnedEvents, "")
    ?.getContent<{ pinned?: unknown }>().pinned;
  if (!Array.isArray(pinned)) return undefined;
  const ids = pinned.filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? { pinnedIds: ids } : undefined;
}

function mapAlias(room: Room): { alias: string } | undefined {
  const alias = room.getCanonicalAlias();
  return alias ? { alias } : undefined;
}

function mapReadMarker(room: Room): { lastReadMessageId: string } | undefined {
  const marker = room.getAccountData(EventType.FullyRead)?.getContent<{ event_id?: string }>().event_id;
  return typeof marker === "string" && marker.length > 0 ? { lastReadMessageId: marker } : undefined;
}

function mapJoinRule(room: Room): { joinRule: JoinRule } | undefined {
  const known = joinRuleNames[room.getJoinRule()];
  // A rule RelayKit does not model, such as "restricted", is left unsaid rather than reported as something else.
  return known ? { joinRule: known } : undefined;
}

function mapHistoryVisibility(room: Room): { historyVisibility: HistoryVisibility } | undefined {
  const known = historyVisibilityNames[room.currentState.getHistoryVisibility()];
  return known ? { historyVisibility: known } : undefined;
}

function mapTopic(room: Room): { topic: string } | undefined {
  const topic = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent<{ topic?: string }>().topic;
  return typeof topic === "string" && topic.length > 0 ? { topic } : undefined;
}

function mapRoomAvatar(room: Room): { avatar: MediaRef } | undefined {
  const url = room.currentState.getStateEvents(EventType.RoomAvatar, "")?.getContent<{ url?: string }>().url;
  if (typeof url !== "string" || url.length === 0) return undefined;
  return { avatar: { mimeType: "image/*", source: JSON.stringify({ url }) } };
}

export function mapMessage(event: MatrixEvent): Message | undefined {
  // A sticker is its own event type, not a message with a msgtype. Everything else about its shape is the same.
  const isSticker = event.getType() === EventType.Sticker;
  if (event.getType() !== EventType.RoomMessage && !isSticker) {
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
  const relatedMessageId = relation?.rel_type === RelationType.Thread ? undefined : relation?.event_id;
  const id = relatedMessageId ?? event.getId();
  const senderId = event.getSender();
  const conversationId = event.getRoomId();
  const transactionId = event.getUnsigned().transaction_id;

  if (body === undefined || (!body && !undecryptable) || !id || !senderId || !conversationId) {
    return undefined;
  }

  // No msgtype, but the same shape as an image: whoever receives it draws it on its own, with no file name
  // and no download button.
  const attachment = isSticker
    ? mapAttachment({ ...content, msgtype: MsgType.Image }, body)
    : mapAttachment(content, body);
  const isThreaded = relation?.rel_type === RelationType.Thread;
  const threadId = isThreaded ? relation?.event_id : undefined;
  // Inside a thread the reply pointer is only a fallback for clients that do not know about threads.
  const replyToId = isThreaded && relation?.is_falling_back !== false
    ? undefined
    : relation?.["m.in_reply_to"]?.event_id;
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
    ...(undecryptable ? { undecryptable: true } : {}),
    ...(threadId ? { threadId } : {}),
    ...(mapFormatted(content) ?? {}),
    ...(mapMentions(content) ?? {}),
    ...(isSticker ? { kind: "sticker" as const } : mapKind(content.msgtype) ?? {}),
    ...(mapLocation(content) ?? {})
  };

  return message;
}

function mapFormatted(content: MatrixMessageContent): { formattedBody: string } | undefined {
  const isHtml = content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string";
  return isHtml ? { formattedBody: content.formatted_body as string } : undefined;
}

function mapMentions(content: MatrixMessageContent): { mentions: Mentions } | undefined {
  const raw = content["m.mentions"];
  if (!raw) return undefined;
  const userIds = Array.isArray(raw.user_ids) ? raw.user_ids.filter((id): id is string => typeof id === "string") : [];
  const everyone = raw.room === true;
  if (userIds.length === 0 && !everyone) return undefined;
  return { mentions: { ...(userIds.length > 0 ? { userIds } : {}), ...(everyone ? { everyone: true } : {}) } };
}

function mapKind(msgtype: string | undefined): { kind: MessageKind } | undefined {
  if (msgtype === MsgType.Emote) return { kind: "action" };
  if (msgtype === MsgType.Notice) return { kind: "notice" };
  return undefined;
}

export function isMessageEdit(event: MatrixEvent): boolean {
  const content = event.getContent<MatrixMessageContent>();
  return content["m.relates_to"]?.rel_type === RelationType.Replace;
}

export function mapReaction(event: MatrixEvent): Reaction | undefined {
  if (event.getType() !== EventType.Reaction) {
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
  if (redacted.getType() !== EventType.RoomMessage) {
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

/** Like a typing notification, a receipt arrives with no room of its own, so it comes from what was told. */
export function mapReadReceipts(event: MatrixEvent, roomId: string | undefined): ReadReceipt[] {
  const conversationId = roomId ?? event.getRoomId();
  if (!conversationId) {
    return [];
  }
  const content = event.getContent<MatrixReceiptContent>();
  const receipts: ReadReceipt[] = [];
  for (const [messageId, receiptTypes] of Object.entries(content)) {
    for (const [userId, receipt] of Object.entries(receiptTypes[ReceiptType.Read] ?? {})) {
      const readAt = typeof receipt.ts === "number" ? receipt.ts : Date.now();
      receipts.push({ conversationId, messageId, userId, readAt });
    }
  }
  return receipts;
}

/**
 * A typing notification arrives as an ephemeral event with no room of its own, so the room has to come from
 * whoever was told about it. Reading it off the event drops every notification a real homeserver sends.
 */
export function mapTyping(event: MatrixEvent, roomId: string | undefined): TypingUpdate | undefined {
  const conversationId = roomId ?? event.getRoomId();
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
