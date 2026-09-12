import {
  EventType, MatrixEvent, type Room } from "matrix-js-sdk";
import type { MCallReplacesEvent } from "matrix-js-sdk/lib/webrtc/callEventTypes.js";
import type { AdapterHandlers, CallTransfer, Message } from "@relaykit/core";
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

/**
 * How long after it was said a transfer still means anything. A call the SDK places gives itself a minute to
 * be answered, and a transfer is an instruction to ring somebody now: past that, whatever it was about is
 * over.
 */
const stillWorthRinging = 60 * 1000;

/**
 * The SDK's own event and its own shape: nothing here is guessed at from a string.
 *
 * Old ones ring nobody. They arrive again every time a client catches up — replaying sync from storage, or
 * coming back after being away — and acting on one rings somebody out of nowhere about a call that ended long
 * ago. The SDK ignores stale incoming calls for the same reason.
 */
export function mapTransfer(event: MatrixEvent, room: Pick<Room, "roomId">): CallTransfer | undefined {
  if (event.getType() !== EventType.CallReplaces) return undefined;
  if (event.getLocalAge() > stillWorthRinging) return undefined;
  const said = event.getContent() as MCallReplacesEvent;
  const target = said.target_user;
  if (!target?.id) return undefined;
  return {
    conversationId: room.roomId,
    callId: said.call_id,
    toUserId: target.id,
    ...(target.display_name ? { toDisplayName: target.display_name } : {})
  };
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
  // Being asked to pass a call on. The SDK sends this and hangs up, and does nothing with it when it
  // arrives: without telling somebody, a transfer is one side hanging up and the other simply cut off.
  const passedOn = mapTransfer(event, room);
  if (passedOn) {
    handlers.onCallTransferred?.(passedOn);
    return;
  }
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

export function handleReceipt(event: MatrixEvent, roomId: string | undefined, handlers: AdapterHandlers): void {
  for (const receipt of mapReadReceipts(event, roomId)) {
    handlers.onReceiptReceived?.(receipt);
  }
}

export function handleTyping(event: MatrixEvent, roomId: string | undefined, handlers: AdapterHandlers): void {
  const update = mapTyping(event, roomId);
  if (update) {
    handlers.onTypingChanged?.(update);
  }
}

/**
 * Presence taken from the general stream instead of the stream tied to each person: that one only fires when
 * the sdk happens to have built that person's object with re-emission set up, so it drops updates at random.
 */
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
