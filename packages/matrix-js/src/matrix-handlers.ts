import { MatrixEvent, type Room } from "matrix-js-sdk";
import type { AdapterHandlers, Message } from "@relaykit/core";
import {
  isMessageEdit,
  mapConversation,
  mapMessage,
  mapPresence,
  mapReaction,
  mapReadReceipts,
  mapRedactedMessage,
  mapTyping
} from "./matrix-mapper.js";
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
    void context.decryptEvent(event)
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

function notify(event: MatrixEvent, message: Message, handlers: AdapterHandlers, context: TimelineContext): void {
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

export function handleReceipt(event: MatrixEvent, handlers: AdapterHandlers): void {
  for (const receipt of mapReadReceipts(event)) {
    handlers.onReceiptReceived?.(receipt);
  }
}

export function handleTyping(event: MatrixEvent, handlers: AdapterHandlers): void {
  const update = mapTyping(event);
  if (update) {
    handlers.onTypingChanged?.(update);
  }
}

export function handlePresence(event: MatrixEvent | undefined, handlers: AdapterHandlers): void {
  const presence = event ? mapPresence(event, Date.now()) : undefined;
  if (presence) {
    handlers.onPresenceChanged?.(presence);
  }
}
