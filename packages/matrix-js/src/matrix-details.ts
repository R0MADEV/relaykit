import {
  ConditionKind,
  EventType,
  HistoryVisibility as MatrixHistoryVisibility,
  JoinRule as MatrixJoinRule,
  PushRuleActionName,
  PushRuleKind,
  RuleId,
  TweakName,
  Visibility,
  Method,
  THREAD_RELATION_TYPE,
  NotificationCountType,
  ReceiptType,
  type INotificationsResponse,
  Direction,
  type IRoomEvent,
  type MatrixClient,
  type Room
} from "matrix-js-sdk";
import { ThreadFilterType } from "matrix-js-sdk/lib/models/thread.js";
import type {
  AvatarImage,
  Conversation,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  MarkReadOptions,
  Message,
  Notification,
  ThreadSummary,
  NotificationLevel,
  PublicConversation,
  PushRegistration
} from "@relaykit/core";
import { mapConversation, mapMessages } from "./matrix-mapper.js";
import { waitForRoom } from "./matrix-room-operations.js";

export async function setMatrixTopic(client: MatrixClient, conversationId: string, topic: string): Promise<Conversation> {
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
  const bytes = image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength);
  const upload = await client.uploadContent(new Blob([bytes as ArrayBuffer]), {
    type: image.mimeType,
    includeFilename: false
  });
  await client.sendStateEvent(conversationId, EventType.RoomAvatar, { url: upload.content_uri }, "");
  const conversation = mapConversation(await waitForRoom(client, conversationId));
  return {
    ...conversation,
    avatar: { mimeType: image.mimeType, size: image.data.byteLength, source: JSON.stringify({ url: upload.content_uri }) }
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

/**
 * The homeserver never reaches a browser or a phone by itself: it hands the notification to a push gateway,
 * which is what Matrix calls a pusher. `event_id_only` keeps the message out of the gateway, so what is said
 * stays between the devices even when the notification travels through somebody else's server.
 */
/**
 * A word worth interrupting for is a content rule named after the word itself. Being named already has its own
 * rule, so this is only for the words somebody chose to care about.
 */
export async function watchForMatrixKeyword(client: MatrixClient, word: string): Promise<void> {
  await client.addPushRule("global", PushRuleKind.ContentSpecific, word, {
    pattern: word,
    actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Highlight, value: true }]
  });
  await client.getPushRules();
}

export async function stopWatchingForMatrixKeyword(client: MatrixClient, word: string): Promise<void> {
  await client.deletePushRule("global", PushRuleKind.ContentSpecific, word).catch(() => undefined);
  await client.getPushRules();
}

export async function listMatrixKeywords(client: MatrixClient): Promise<readonly string[]> {
  const rules = await client.getPushRules();
  return (rules.global.content ?? [])
    // The rules the homeserver ships with start with a dot, and they are not words anybody chose.
    .filter(rule => !rule.rule_id.startsWith("."))
    .map(rule => rule.pattern ?? rule.rule_id);
}

export async function registerMatrixPush(client: MatrixClient, registration: PushRegistration): Promise<void> {
  await client.setPusher({
    pushkey: registration.deviceToken,
    kind: "http",
    app_id: registration.appId,
    app_display_name: registration.appName,
    device_display_name: registration.deviceName ?? registration.appName,
    lang: registration.language ?? "en",
    data: { url: registration.gatewayUrl, format: "event_id_only", ...registration.data },
    // Replacing rather than appending, so registering twice does not leave the old one notifying as well.
    append: false
  });
}

export async function listMatrixPushRegistrations(client: MatrixClient): Promise<readonly PushRegistration[]> {
  const { pushers } = await client.getPushers();
  return pushers.map(pusher => {
    const { url, format, ...rest } = (pusher.data ?? {}) as Record<string, string>;
    return {
      gatewayUrl: url ?? "",
      deviceToken: pusher.pushkey,
      appId: pusher.app_id,
      appName: pusher.app_display_name,
      ...(pusher.device_display_name ? { deviceName: pusher.device_display_name } : {}),
      ...(pusher.lang ? { language: pusher.lang } : {}),
      ...(Object.keys(rest).length > 0 ? { data: rest } : {})
    };
  });
}

export async function unregisterMatrixPush(client: MatrixClient, deviceToken: string): Promise<void> {
  const { pushers } = await client.getPushers();
  const registered = pushers.find(pusher => pusher.pushkey === deviceToken);
  if (!registered) return;
  await client.removePusher(deviceToken, registered.app_id);
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
  await client.sendStateEvent(conversationId, EventType.RoomJoinRules, { join_rule: joinRuleNames[rule] }, "");
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
  const aggregated = root.unsigned?.["m.relations"]?.[THREAD_RELATION_TYPE.name] as ThreadAggregation | undefined;
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

/** A person worth not being interrupted by. What they say still arrives; it just stops making a noise. */
export async function listMatrixMutedUsers(client: MatrixClient): Promise<readonly string[]> {
  const rules = await client.getPushRules();
  return (rules.global?.sender ?? [])
    .filter(rule => rule.enabled !== false && rule.actions.length === 0)
    .map(rule => rule.rule_id);
}

export async function setMatrixUserMuted(client: MatrixClient, userId: string, muted: boolean): Promise<void> {
  // Deleting first either way: adding a rule that is already there would leave two saying the same thing.
  await client.deletePushRule("global", PushRuleKind.SenderSpecific, userId).catch(() => undefined);
  if (muted) {
    await client.addPushRule("global", PushRuleKind.SenderSpecific, userId, { actions: [] });
  }
  await client.getPushRules();
}

/**
 * How much anything at all may interrupt, for the whole account. Silence is the master rule the protocol
 * keeps for exactly this; mentions only is every rule about ordinary messages turned off, which leaves the
 * ones about being named still working.
 */
const rulesAboutOrdinaryMessages = [
  RuleId.Message,
  RuleId.EncryptedMessage,
  // A direct message is an ordinary message too: "mentions only" that still rings for every DM is not that.
  RuleId.DM,
  RuleId.EncryptedDM
];

export async function getMatrixNotificationLevel(client: MatrixClient): Promise<NotificationLevel> {
  const rules = await client.getPushRules();
  const isSilent = (rules.global?.override ?? []).some(rule => rule.rule_id === RuleId.Master && rule.enabled);
  if (isSilent) return "none";
  const underlying = rules.global?.underride ?? [];
  const ordinaryMessagesAreOff = rulesAboutOrdinaryMessages.every(ruleId => {
    const rule = underlying.find(candidate => candidate.rule_id === ruleId);
    return rule !== undefined && rule.enabled === false;
  });
  return ordinaryMessagesAreOff ? "mentions" : "all";
}

export async function setMatrixNotificationLevel(client: MatrixClient, level: NotificationLevel): Promise<void> {
  await client.setPushRuleEnabled("global", PushRuleKind.Override, RuleId.Master, level === "none");
  for (const ruleId of rulesAboutOrdinaryMessages) {
    await client.setPushRuleEnabled("global", PushRuleKind.Underride, ruleId, level === "all")
      .catch(() => undefined);
  }
  // What this client holds is refreshed by sync, which has not happened yet: asking updates it now, so reading
  // back gives the decision just taken and not the one before it.
  await client.getPushRules();
}

/**
 * What the homeserver is holding for this account. An application that was closed has no events to work it
 * out from, so it asks. A highlight is the protocol saying this one names the person, which deserves more.
 */
export async function listMatrixPending(client: MatrixClient, limit: number): Promise<readonly Notification[]> {
  // The SDK only reaches this endpoint through its notification timeline, which asks for highlights alone.
  // What a cold start has to show is everything waiting, so it is asked for directly.
  const response = await client.http.authedRequest<INotificationsResponse>(
    Method.Get,
    "/notifications",
    { limit: String(limit) }
  );
  return (response.notifications ?? []).map(waiting => ({
    conversationId: waiting.room_id,
    messageId: waiting.event.event_id,
    senderId: waiting.event.sender,
    body: typeof waiting.event.content?.body === "string" ? waiting.event.content.body : "",
    isMention: waiting.actions.some(action => isHighlight(action))
  }));
}

/** The protocol says a message names somebody by tweaking "highlight" on, which is not a plain string action. */
function isHighlight(action: unknown): boolean {
  if (typeof action !== "object" || action === null) return false;
  const tweak = action as { set_tweak?: unknown; value?: unknown };
  return tweak.set_tweak === "highlight" && tweak.value !== false;
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

export async function pinMatrixMessage(client: MatrixClient, conversationId: string, messageId: string): Promise<void> {
  const pinned = await readPinnedIds(client, conversationId);
  if (pinned.includes(messageId)) return;
  await client.sendStateEvent(conversationId, pinnedEvent, { pinned: [...pinned, messageId] }, "");
}

export async function unpinMatrixMessage(client: MatrixClient, conversationId: string, messageId: string): Promise<void> {
  const pinned = await readPinnedIds(client, conversationId);
  await client.sendStateEvent(conversationId, pinnedEvent, { pinned: pinned.filter(id => id !== messageId) }, "");
}

export async function listMatrixPinnedMessages(client: MatrixClient, conversationId: string): Promise<readonly Message[]> {
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
