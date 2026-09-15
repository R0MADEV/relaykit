import {
  ConditionKind,
  EventType,
  HistoryVisibility as MatrixHistoryVisibility,
  JoinRule as MatrixJoinRule,
  PushRuleKind,
  Visibility,
  THREAD_RELATION_TYPE,
  NotificationCountType,
  ReceiptType,
  Direction,
  type IRoomEvent,
  type MatrixClient,
  type Room
} from "matrix-js-sdk";
import { ThreadFilterType } from "matrix-js-sdk/lib/models/thread.js";
import type {
  RoomVersions,
  AvatarImage,
  Conversation,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  MarkReadOptions,
  Message,
  ThreadSummary,
  NotificationLevel,
  PublicConversation
} from "@relaykit/core";
import { mapMessages } from "./matrix-mapper.js";
import { mapConversation } from "./matrix-conversation-mapper.js";
import { waitForRoom } from "./matrix-room-operations.js";
import { uploadAvatarImage } from "./matrix-media.js";

export async function setMatrixTopic(
  client: MatrixClient,
  conversationId: string,
  topic: string
): Promise<Conversation> {
  await client.setRoomTopic(conversationId, topic);
  const conversation = mapConversation(await waitForRoom(client, conversationId));
  // The state event reaches the room through sync, so the answer already carries what was just set.
  return { ...conversation, topic };
}

export async function setMatrixConversationAvatar(
  client: MatrixClient,
  conversationId: string,
  image: AvatarImage
): Promise<Conversation> {
  const url = await uploadAvatarImage(client, image);
  await client.sendStateEvent(conversationId, EventType.RoomAvatar, { url }, "");
  const conversation = mapConversation(await waitForRoom(client, conversationId));
  return {
    ...conversation,
    avatar: {
      mimeType: image.mimeType,
      size: image.data.byteLength,
      source: JSON.stringify({ url })
    }
  };
}

/**
 * How much a conversation may interrupt is a push rule for that room. Silencing it means a rule that does
 * nothing, and mentions only means the room stops notifying while the rules about your name still apply.
 */
export async function setMatrixNotifications(
  client: MatrixClient,
  conversationId: string,
  level: NotificationLevel
): Promise<Conversation> {
  for (const kind of [PushRuleKind.Override, PushRuleKind.RoomSpecific]) {
    await client.deletePushRule("global", kind, conversationId).catch(() => undefined);
  }
  if (level === "none") {
    await client.addPushRule("global", PushRuleKind.Override, conversationId, {
      actions: [],
      conditions: [{ kind: ConditionKind.EventMatch, key: "room_id", pattern: conversationId }]
    });
  }
  if (level === "mentions") {
    await client.addPushRule("global", PushRuleKind.RoomSpecific, conversationId, { actions: [] });
  }
  // The copy of the rules this client holds is refreshed by sync, which has not happened yet. Asking the server
  // for them updates that copy, so what is read back is the decision just taken and not the one before it.
  await client.getPushRules();
  const conversation = mapConversation(await waitForRoom(client, conversationId));
  return level === "all" ? conversation : { ...conversation, notifications: level };
}

const historyVisibilityNames: Record<HistoryVisibility, MatrixHistoryVisibility> = {
  world: MatrixHistoryVisibility.WorldReadable,
  shared: MatrixHistoryVisibility.Shared,
  invited: MatrixHistoryVisibility.Invited,
  joined: MatrixHistoryVisibility.Joined
};

const joinRuleNames: Record<JoinRule, MatrixJoinRule> = {
  invite: MatrixJoinRule.Invite,
  public: MatrixJoinRule.Public,
  knock: MatrixJoinRule.Knock
};

export async function setMatrixJoinRule(
  client: MatrixClient,
  conversationId: string,
  rule: JoinRule
): Promise<Conversation> {
  await client.sendStateEvent(
    conversationId,
    EventType.RoomJoinRules,
    { join_rule: joinRuleNames[rule] },
    ""
  );
  return { ...mapConversation(await waitForRoom(client, conversationId)), joinRule: rule };
}

export async function setMatrixHistoryVisibility(
  client: MatrixClient,
  conversationId: string,
  visibility: HistoryVisibility
): Promise<Conversation> {
  await client.sendStateEvent(
    conversationId,
    EventType.RoomHistoryVisibility,
    { history_visibility: historyVisibilityNames[visibility] },
    ""
  );
  return { ...mapConversation(await waitForRoom(client, conversationId)), historyVisibility: visibility };
}

export async function knockMatrixConversation(
  client: MatrixClient,
  conversationId: string,
  options: KnockOptions
): Promise<void> {
  await client.knockRoom(conversationId, {
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.via ? { viaServers: [...options.via] } : {})
  });
}

/**
 * Replaces a conversation with a new one that carries on from it. The homeserver decides the version, because
 * asking for one it does not know leaves everyone stranded in a conversation nobody can join.
 */
export async function upgradeMatrixConversation(
  client: MatrixClient,
  conversationId: string
): Promise<Conversation> {
  const capabilities = await client.getCapabilities();
  const version = capabilities["m.room_versions"]?.default ?? "10";
  const { replacement_room: replacementId } = await client.upgradeRoom(conversationId, version);
  const replacement = mapConversation(await waitForRoom(client, replacementId));
  return { ...replacement, replaces: conversationId };
}

export async function setMatrixAlias(
  client: MatrixClient,
  conversationId: string,
  alias: string
): Promise<Conversation> {
  await client.createAlias(alias, conversationId);
  // The canonical alias is the one clients show, so the name just given is made the canonical one.
  await client.sendStateEvent(conversationId, EventType.RoomCanonicalAlias, { alias }, "");
  return { ...mapConversation(await waitForRoom(client, conversationId)), alias };
}

export async function publishMatrixConversation(
  client: MatrixClient,
  conversationId: string,
  listed: boolean
): Promise<void> {
  await client.setRoomDirectoryVisibility(conversationId, listed ? Visibility.Public : Visibility.Private);
}

/** The public list of the homeserver, which is how somebody finds a conversation nobody invited them to. */
export async function discoverMatrixConversations(
  client: MatrixClient,
  query: string | undefined
): Promise<readonly PublicConversation[]> {
  const { chunk } = await client.publicRooms(query ? { filter: { generic_search_term: query } } : {});
  return chunk.map(room => ({
    id: room.room_id,
    participantCount: room.num_joined_members,
    ...(room.name ? { title: room.name } : {}),
    ...(room.topic ? { topic: room.topic } : {}),
    ...(room.canonical_alias ? { alias: room.canonical_alias } : {}),
    ...(room.join_rule === "knock" || room.join_rule === "public" ? { joinRule: room.join_rule } : {})
  }));
}

const pinnedEvent = EventType.RoomPinnedEvents;

/**
 * Both go out: the receipt tells the others how far this person read, the marker remembers it for themselves.
 * Reading quietly skips the first, which is what somebody who does not want to be seen reading asks for.
 *
 * The receipt needs the message in hand; the marker only needs to know how far. A message older than what is
 * held locally still moves the marker, which is what reading from a notification needs.
 */
export async function markMatrixRead(
  client: MatrixClient,
  conversationId: string,
  messageId: string,
  options: MarkReadOptions = {}
): Promise<void> {
  const room = client.getRoom(conversationId);
  if (!room) throw new Error("The conversation does not exist");
  const event = room.findEventById(messageId);
  // A thread is read on its own. The marker belongs to the whole conversation, so moving it here would say
  // the conversation was read, which is exactly what reading one thread does not mean.
  //
  // The SDK works the thread out from the event itself and drops the count on this device at once, so what it
  // needs is the event. Somebody reading from a notification does not have it loaded, in a thread no less than
  // anywhere else, so it is fetched: one request, and everything after it is the SDK's own doing.
  if (options.threadId) {
    const receiptType = options.private ? ReceiptType.ReadPrivate : ReceiptType.Read;
    const read = event ?? client.getEventMapper()(await client.fetchRoomEvent(conversationId, messageId));
    await client.sendReceipt(read, receiptType);
    return;
  }
  const told = options.private ? [undefined, event] : [event, undefined];
  await client.setRoomReadMarkers(conversationId, messageId, told[0], told[1]);
}

/**
 * What hangs off the messages of a conversation. The homeserver keeps threads as their own timelines, so this
 * is what it already knows rather than a walk through everything ever said.
 */
export async function listMatrixThreads(
  client: MatrixClient,
  conversationId: string
): Promise<readonly ThreadSummary[]> {
  const room = await waitForRoom(client, conversationId);
  // The SDK makes this request itself. Its other way in, `room.fetchRoomThreads`, is a one-shot bootstrap for
  // a screen that then listens: on the second call it returns without asking, so a thread started afterwards
  // never turns up. This one asks every time, which is what a list somebody refreshes needs.
  const { chunk } = await client.createThreadListMessagesRequest(
    conversationId,
    null,
    threadsPerAsk,
    Direction.Backward,
    ThreadFilterType.All
  );
  return chunk.map(root => summarise(client, room, root));
}

/** More threads than any screen shows at once, so a list costs one request rather than paging for it. */
const threadsPerAsk = 100;

function summarise(client: MatrixClient, room: Room, root: IRoomEvent): ThreadSummary {
  const aggregated = root.unsigned?.["m.relations"]?.[THREAD_RELATION_TYPE.name] as
    ThreadAggregation | undefined;
  // The homeserver sends the latest answer along, but in an encrypted conversation it arrives as a locked box.
  // The SDK has already opened the one it holds, so that is the one shown whenever it is to hand.
  const latest = aggregated?.latest_event?.event_id;
  const held = latest ? room.findEventById(latest) : undefined;
  const lastMessage = held ? mapMessages([held])[0] : undefined;
  const readUpTo = room.getThread(root.event_id)?.getEventReadUpTo(client.getSafeUserId(), false);
  return {
    conversationId: room.roomId,
    rootId: root.event_id,
    replyCount: aggregated?.count ?? 0,
    ...(lastMessage ? { lastMessage } : {}),
    ...(readUpTo ? { lastReadMessageId: readUpTo } : {}),
    unreadCount: room.getThreadUnreadNotificationCount(root.event_id, NotificationCountType.Total)
  };
}

/** What the homeserver bundles onto a thread root. The SDK names the relation but not this shape. */
interface ThreadAggregation {
  readonly count?: number;
  readonly latest_event?: { readonly event_id?: string };
}

/** Somebody who read a conversation and wants it back on the pile. It is their own mark, not a shared one. */
export async function setMatrixUnread(
  client: MatrixClient,
  conversationId: string,
  unread: boolean
): Promise<Conversation> {
  await client.setRoomAccountData(conversationId, EventType.MarkedUnread, { unread });
  return { ...mapConversation(await waitForRoom(client, conversationId)), isUnread: unread };
}

export async function pinMatrixMessage(
  client: MatrixClient,
  conversationId: string,
  messageId: string
): Promise<void> {
  const pinned = await readPinnedIds(client, conversationId);
  if (pinned.includes(messageId)) return;
  await client.sendStateEvent(conversationId, pinnedEvent, { pinned: [...pinned, messageId] }, "");
}

export async function unpinMatrixMessage(
  client: MatrixClient,
  conversationId: string,
  messageId: string
): Promise<void> {
  const pinned = await readPinnedIds(client, conversationId);
  await client.sendStateEvent(
    conversationId,
    pinnedEvent,
    { pinned: pinned.filter(id => id !== messageId) },
    ""
  );
}

export async function listMatrixPinnedMessages(
  client: MatrixClient,
  conversationId: string
): Promise<readonly Message[]> {
  const room = await waitForRoom(client, conversationId);
  const pinned = await readPinnedIds(client, conversationId);
  const events = pinned.map(id => room.findEventById(id)).filter(event => event !== undefined);
  for (const event of events) {
    if (event.isEncrypted()) await client.decryptEventIfNeeded(event);
  }
  return mapMessages(events);
}

async function readPinnedIds(client: MatrixClient, conversationId: string): Promise<readonly string[]> {
  const room = await waitForRoom(client, conversationId);
  const content = room.currentState.getStateEvents(pinnedEvent, "")?.getContent<{ pinned?: string[] }>();
  return content?.pinned ?? [];
}

/**
 * Takes a conversation already left out of this account's history.
 *
 * Leaving stops it arriving; forgetting stops it being there at all. A conversation forgotten while still in
 * it comes back on the next sync, which is why the two are separate and in that order.
 */
export async function forgetMatrixConversation(client: MatrixClient, conversationId: string): Promise<void> {
  await client.forget(conversationId);
}

/** Filing a conversation under a name of this person's own. It is account data: nobody else sees it. */
export async function setMatrixConversationTag(
  client: MatrixClient,
  conversationId: string,
  tag: string
): Promise<void> {
  await client.setRoomTag(conversationId, tag, {});
}

export async function removeMatrixConversationTag(
  client: MatrixClient,
  conversationId: string,
  tag: string
): Promise<void> {
  await client.deleteRoomTag(conversationId, tag);
}

/**
 * What a conversation is filed under.
 *
 * `m.favourite` and `m.lowpriority` are the protocol's own and are already answered elsewhere — as
 * `isFavourite` and as how loud a conversation may be — so they are left out of what is a list of this
 * person's own names.
 */
export async function listMatrixConversationTags(
  client: MatrixClient,
  conversationId: string
): Promise<readonly string[]> {
  const { tags } = await client.getRoomTags(conversationId);
  return Object.keys(tags ?? {}).filter(tag => !tag.startsWith("m."));
}

/** Which room versions this homeserver admits, which is what an upgrade has to choose from. */
export async function listMatrixRoomVersions(client: MatrixClient): Promise<RoomVersions> {
  const said = await client.getCapabilities();
  const versions = said["m.room_versions"];
  const available = Object.keys(versions?.available ?? {});
  const preferred = versions?.default ?? available[0] ?? "";
  // A homeserver that says nothing about versions still has one; saying nothing is not the same as none.
  return { preferred, available: available.length > 0 ? available : [preferred].filter(Boolean) };
}
