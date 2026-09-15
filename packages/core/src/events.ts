import type {
  Session,
  Call,
  CallSpeaking,
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
  notification: Notification;
  /** A call has begun in a conversation of this account, and nobody here is on it yet. A screen rings on this. */
  "call.incoming": Call;
  /** A call moved on: somebody came or went, a camera went on, it ended. */
  "call.changed": Call;
  /**
   * Who is talking now, told apart from `call.changed` because it changes several times a second and a
   * grid should light up a border without repainting every face.
   */
  "call.speaking": CallSpeaking;
  /** The homeserver no longer accepts this session: suspended, revoked, or signed out from elsewhere. */
  "session.ended": undefined;
  /**
   * The homeserver handed out a new access token before the old one ran out.
   *
   * Given out so it can be kept: an application that wrote the first session down and never hears about this
   * one is one that signs its user out the next time it opens, for no reason anybody can see.
   */
  "session.refreshed": Session;
  /**
   * Who is signed in, whenever that changes: signing in, registering, coming in as a guest, coming back from
   * somebody else's sign-in, a token renewed on its own, and signing out — which says `undefined`.
   *
   * One event for all of them on purpose. Anything that has to follow who is signed in — writing the session
   * down, opening the right local copy — has exactly one thing to follow, instead of six places to remember.
   */
  "session.changed": Session | undefined;
  "verification.requested": VerificationSession;
  "verification.changed": VerificationSession;
  error: Error;
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

  /**
   * Tells everybody, and lets nobody stop the telling.
   *
   * These are emitted from the middle of the library's own work — a message arriving, a session changing, a
   * call moving — so a bug in one application's screen would otherwise stop the next listener hearing about
   * it and leave that work half done. What went wrong is handed on instead, and everybody still hears.
   *
   * Over a copy, because a listener may well unsubscribe itself, or subscribe another, while being told.
   */
  emit(payload: Payload, wentWrong: (error: unknown) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(payload);
      } catch (error) {
        wentWrong(error);
      }
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
    notification: new EventChannel<Notification>(),
    "call.incoming": new EventChannel<Call>(),
    "call.changed": new EventChannel<Call>(),
    "call.speaking": new EventChannel<CallSpeaking>(),
    "session.ended": new EventChannel<undefined>(),
    "session.refreshed": new EventChannel<Session>(),
    "session.changed": new EventChannel<Session | undefined>(),
    "verification.requested": new EventChannel<VerificationSession>(),
    "verification.changed": new EventChannel<VerificationSession>(),
    error: new EventChannel<Error>()
  };

  on<Name extends EventName>(name: Name, listener: EventListener<Name>): () => void {
    return this.channels[name].on(listener);
  }

  /**
   * `wentWrong` is told about a listener that threw, and nothing else happens. A library cannot decide what
   * an application should do about its own bug, and it certainly cannot stop working over one.
   */
  emit<Name extends EventName>(
    name: Name,
    payload: ClientEventMap[Name],
    wentWrong: (error: unknown) => void
  ): void {
    this.channels[name].emit(payload, wentWrong);
  }
}
