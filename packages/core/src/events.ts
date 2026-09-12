import type {
  ConnectionStatus,
  Conversation,
  Message,
  Reaction,
  ReadReceipt,
  SyncStatus,
  Notification,
  TypingUpdate,
  UserPresence,
  VerificationSession
} from "./models.js";

export interface ClientEventMap {
  "connection.changed": ConnectionStatus;
  "sync.changed": SyncStatus;
  "conversation.updated": Conversation;
  "message.received": Message;
  "message.updated": Message;
  "reaction.added": Reaction;
  "reaction.removed": Reaction;
  "typing.changed": TypingUpdate;
  "receipt.received": ReadReceipt;
  "presence.changed": UserPresence;
  "notification": Notification;
  /** The homeserver no longer accepts this session: suspended, revoked, or signed out from elsewhere. */
  "session.ended": undefined;
  "verification.requested": VerificationSession;
  "verification.changed": VerificationSession;
  "error": Error;
}

export type EventName = keyof ClientEventMap;
export type EventListener<Name extends EventName> = (payload: ClientEventMap[Name]) => void;
export type ClientEvents = ClientEventMap;

class EventChannel<Payload> {
  private readonly listeners = new Set<(payload: Payload) => void>();

  on(listener: (payload: Payload) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload: Payload): void {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }
}

export class EventBus {
  private readonly channels: {
    [Name in EventName]: EventChannel<ClientEventMap[Name]>;
  } = {
    "connection.changed": new EventChannel<ConnectionStatus>(),
    "sync.changed": new EventChannel<SyncStatus>(),
    "conversation.updated": new EventChannel<Conversation>(),
    "message.received": new EventChannel<Message>(),
    "message.updated": new EventChannel<Message>(),
    "reaction.added": new EventChannel<Reaction>(),
    "reaction.removed": new EventChannel<Reaction>(),
    "typing.changed": new EventChannel<TypingUpdate>(),
    "receipt.received": new EventChannel<ReadReceipt>(),
    "presence.changed": new EventChannel<UserPresence>(),
    "notification": new EventChannel<Notification>(),
    "session.ended": new EventChannel<undefined>(),
    "verification.requested": new EventChannel<VerificationSession>(),
    "verification.changed": new EventChannel<VerificationSession>(),
    "error": new EventChannel<Error>()
  };

  on<Name extends EventName>(name: Name, listener: EventListener<Name>): () => void {
    return this.channels[name].on(listener);
  }

  emit<Name extends EventName>(name: Name, payload: ClientEventMap[Name]): void {
    this.channels[name].emit(payload);
  }
}
