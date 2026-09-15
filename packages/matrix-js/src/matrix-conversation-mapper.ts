import { EventType, KnownMembership, NotificationCountType, type Room } from "matrix-js-sdk";
import type { Conversation, HistoryVisibility, JoinRule, MediaRef, NotificationLevel } from "@relaykit/core";
import { isDirectRoom } from "./matrix-conversations.js";
import { mapMessages } from "./matrix-mapper.js";

const joinRuleNames: Record<string, JoinRule> = { invite: "invite", public: "public", knock: "knock" };

const historyVisibilityNames: Record<string, HistoryVisibility> = {
  world_readable: "world",
  shared: "shared",
  invited: "invited",
  joined: "joined"
};

/**
 * A room, read as a conversation.
 *
 * Apart from the mapping of messages because they answer different questions: one is what a conversation is
 * — who is in it, what it is called, how far it has been read — and the other is what somebody said. They
 * were in one file and the file was the two of them.
 */
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
  const members = room
    .getMembers()
    .filter(
      member => member.membership === KnownMembership.Join || member.membership === KnownMembership.Invite
    );
  const conversation: Conversation = {
    id: room.roomId,
    ...whatItIsCalled(room),
    // Whoever left or was banned is no longer part of the conversation, only those in it or invited to it.
    participantIds: members.map(member => member.userId),
    invitedIds: members
      .filter(member => member.membership === KnownMembership.Invite)
      .map(member => member.userId),
    // Whoever asked to come in is still at the door, so they are listed apart from the participants.
    knockingIds: room
      .getMembers()
      .filter(member => member.membership === KnownMembership.Knock)
      .map(member => member.userId),
    membership: room.getMyMembership() === KnownMembership.Invite ? "invite" : "join",
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
  const topic = room.currentState
    .getStateEvents(EventType.RoomTopic, "")
    ?.getContent<{ topic?: string }>().topic;
  return typeof topic === "string" && topic.length > 0 ? { topic } : undefined;
}
function mapRoomAvatar(room: Room): { avatar: MediaRef } | undefined {
  const url = room.currentState.getStateEvents(EventType.RoomAvatar, "")?.getContent<{ url?: string }>().url;
  if (typeof url !== "string" || url.length === 0) return undefined;
  return { avatar: { mimeType: "image/*", source: JSON.stringify({ url }) } };
}

/**
 * What a conversation is called, when it is called anything.
 *
 * matrix-js-sdk answers `room.name` with the room id when it cannot work one out — no name of its own, and
 * the people in it not loaded yet, which is every conversation for the first moments of a sync. Handing that
 * on is passing an identifier off as something a person chose, and every screen then paints
 * `!xUJktYKBXBpvxYpryi:localhost` where a name belongs.
 *
 * Nothing is the honest answer, and it is one an application can do something with: a one-to-one is called
 * by the other person, a group by who is in it. An identifier is not a name in any of those.
 */
function whatItIsCalled(room: Room): { title?: string } {
  // What the room was called, out of its own state. `room.name` is a convenience the SDK works out from the
  // state plus the people in it, and it answers with the room id whenever it cannot — which on a browser
  // restoring a local copy is every conversation for the first moments after it opens.
  const given = room.currentState.getStateEvents(EventType.RoomName, "")?.getContent<{ name?: string }>();
  if (typeof given?.name === "string" && given.name.trim()) return { title: given.name };
  const worked = room.name;
  // And an identifier is not a name, whoever handed it over.
  if (!worked || worked === room.roomId) return {};
  return { title: worked };
}
