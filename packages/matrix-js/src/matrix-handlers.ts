import type { MatrixEvent } from "matrix-js-sdk";
import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";
import type { AdapterHandlers, Message } from "@relaykit/core";
import {
  isMessageEdit,
  mapMessage,
  mapPresence,
  mapReaction,
  mapReadReceipts,
  mapRedactedMessage,
  mapTyping
} from "./matrix-mapper.js";
import { mapConversation } from "./matrix-conversation-mapper.js";
import type { ReactionTracker } from "./reaction-tracker.js";

export interface TimelineContext {
  readonly decryptEvent: (event: MatrixEvent) => Promise<void>;
  /** The homeserver push rules decide what deserves the user's attention. */
  readonly notificationFor: (event: MatrixEvent) => { readonly notify: boolean; readonly isMention: boolean };
  readonly ownUserId: () => string | undefined;
}

export function handleTimeline(
  event: MatrixEvent,
  room: Room | undefined,
  toStartOfTimeline: boolean | undefined,
  handlers: AdapterHandlers,
  context: TimelineContext
): void {
  handleTimelineEvent(event, room, toStartOfTimeline, handlers, context, false);
}

function handleTimelineEvent(
  event: MatrixEvent,
  room: Room | undefined,
  toStartOfTimeline: boolean | undefined,
  handlers: AdapterHandlers,
  context: TimelineContext,
  decrypted: boolean
): void {
  if (toStartOfTimeline || !room) {
    return;
  }
  const eventId = event.getId();
  if (eventId?.startsWith("~")) {
    return;
  }
  if (event.isEncrypted() && !decrypted) {
    void context
      .decryptEvent(event)
      .then(() => handleTimelineEvent(event, room, false, handlers, context, true))
      .catch(error => handlers.onError?.(error instanceof Error ? error : new Error(String(error))));
    return;
  }

  handlers.onConversationUpdated?.(mapConversation(room));
  const reaction = mapReaction(event);
  if (reaction) {
    handlers.onReactionAdded?.(reaction);
    return;
  }
  const message = mapMessage(event);
  if (!message) {
    return;
  }
  if (isMessageEdit(event)) {
    handlers.onMessageUpdated?.(message);
    return;
  }
  handlers.onMessageReceived?.(message);
  notify(event, message, handlers, context);
}

function notify(
  event: MatrixEvent,
  message: Message,
  handlers: AdapterHandlers,
  context: TimelineContext
): void {
  const isOwnMessage = message.senderId === context.ownUserId();
  if (isOwnMessage) return;
  const { notify: shouldNotify, isMention } = context.notificationFor(event);
  if (!shouldNotify) return;
  handlers.onNotification?.({
    conversationId: message.conversationId,
    messageId: message.id,
    senderId: message.senderId,
    body: message.body,
    isMention
  });
}

export function handleRedaction(
  event: MatrixEvent,
  room: Room | undefined,
  handlers: AdapterHandlers,
  tracker: ReactionTracker
): void {
  if (tracker.remove(event, room, handlers)) {
    return;
  }
  const redactedId = event.event.redacts;
  const redacted = redactedId && room ? room.findEventById(redactedId) : undefined;
  const message = redacted ? mapRedactedMessage(redacted, event) : undefined;
  if (message) {
    handlers.onMessageUpdated?.(message);
  }
}

export function handleReceipt(
  event: MatrixEvent,
  roomId: string | undefined,
  handlers: AdapterHandlers
): void {
  for (const receipt of mapReadReceipts(event, roomId)) {
    handlers.onReceiptReceived?.(receipt);
  }
}

export function handleTyping(
  event: MatrixEvent,
  roomId: string | undefined,
  handlers: AdapterHandlers
): void {
  const update = mapTyping(event, roomId);
  if (update) {
    handlers.onTypingChanged?.(update);
  }
}

/**
 * Presence taken from the general stream instead of the stream tied to each person: that one only fires when
 * the sdk happens to have built that person's object with re-emission set up, so it drops updates at random.
 */
/**
 * Account data, which is where Matrix keeps the things about a conversation that nobody ever says in it:
 * whether it is a direct chat, whether it is a favourite, whether it was marked unread. A screen following
 * only the timeline has all of that wrong until somebody speaks — which is what needing a reload looks like.
 *
 * Only the conversations the change actually names are read again. Reading every one of them because a
 * setting moved is what makes a busy account crawl.
 */
export function handleAccountData(
  event: MatrixEvent,
  client: Pick<MatrixClient, "getRoom">,
  handlers: AdapterHandlers
): void {
  if (event.getType() !== EventType.Direct) return;
  const byPerson = event.getContent<Record<string, string[]>>();
  const named = new Set(Object.values(byPerson).flat());
  for (const roomId of named) {
    const room = client.getRoom(roomId);
    if (room) handlers.onConversationUpdated?.(mapConversation(room));
  }
}

/** The same, for what is kept against one conversation rather than against the account. */
export function handleRoomAccountData(room: Room | undefined, handlers: AdapterHandlers): void {
  if (!room) return;
  handlers.onConversationUpdated?.(mapConversation(room));
}

export function handleClientEvent(event: MatrixEvent, handlers: AdapterHandlers): void {
  if (event.getType() !== EventType.Presence) return;
  handlePresence(event, handlers);
}

export function handlePresence(event: MatrixEvent | undefined, handlers: AdapterHandlers): void {
  const presence = event ? mapPresence(event, Date.now()) : undefined;
  if (presence) {
    handlers.onPresenceChanged?.(presence);
  }
}
