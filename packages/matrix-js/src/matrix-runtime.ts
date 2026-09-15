import { RelayKitError } from "@relaykit/core";
import type { MatrixEvent, IndexedDBStore, AccessTokens } from "matrix-js-sdk";
import {
  ClientEvent,
  HttpApiEvent,
  RoomEvent,
  RoomMemberEvent,
  createClient,
  type MatrixClient,
  type Room,
  type RoomMember
} from "matrix-js-sdk";
import type { AdapterHandlers, Session } from "@relaykit/core";
import { createBrowserStore, handleSync, waitForInitialSync } from "./matrix-sync.js";
import {
  handleClientEvent,
  handleReceipt,
  handleRedaction,
  handleTimeline,
  handleTyping
} from "./matrix-handlers.js";
import { mapConversation } from "./matrix-conversation-mapper.js";
import { ReactionTracker } from "./reaction-tracker.js";
import { openTheWindow, type ConversationWindow } from "./matrix-window.js";
import { MatrixConference } from "./matrix-conference.js";
import { MatrixRtc } from "./matrix-rtc.js";
import { SecretStorageKeyHolder } from "./matrix-security.js";
import { MatrixVerificationTracker } from "./matrix-verification.js";
import type { MatrixJsAdapterOptions } from "./types.js";

export class MatrixRuntime {
  private client: MatrixClient | undefined;
  /**
   * Settles once the crypto stack is up.
   *
   * Starting without waiting to catch up comes back before any of this has happened, and the first thing a
   * screen asks is often whether it can read what was said before it. Told there is no cryptography, it draws
   * a signed-in application with nothing wrong — which is worse than waiting a moment for the truth.
   */
  private cryptoUp: Promise<void> = Promise.resolve();
  private cryptoIsUp: () => void = () => {};
  private store: IndexedDBStore | undefined;
  private handlers: AdapterHandlers = {};
  /** What this session is, as the homeserver would accept it now rather than when it started. */
  private session: Session | undefined;
  private readonly reactions = new ReactionTracker();
  private readonly lastTypingByRoom = new Map<string, string>();
  private window: ConversationWindow | undefined;
  readonly rtc: MatrixRtc;
  readonly conference: MatrixConference;
  readonly secretStorageKeys = new SecretStorageKeyHolder();
  readonly verification = new MatrixVerificationTracker();

  constructor(private readonly options: MatrixJsAdapterOptions) {
    this.rtc = new MatrixRtc(options.conferenceServiceUrl);
    this.conference = new MatrixConference(this.rtc);
  }

  /**
   * Trading a refresh token for a new access token, and telling whoever is holding the session.
   *
   * The SDK asks for this on its own when a request comes back saying the token has run out, and carries on
   * with the new one. Nobody else would know: an application that wrote the first session down and is never
   * told about this one signs its user out the next time it opens, for no reason anybody can see.
   */
  private async refreshTheToken(session: Session, refreshToken: string): Promise<AccessTokens> {
    const answer = await this.getClient().refreshToken(refreshToken);
    const expiry = answer.expires_in_ms ? new Date(Date.now() + answer.expires_in_ms) : undefined;
    const refreshed = {
      ...session,
      accessToken: answer.access_token,
      ...(answer.refresh_token ? { refreshToken: answer.refresh_token } : {}),
      ...(expiry ? { expiresAt: expiry.getTime() } : {})
    };
    this.session = refreshed;
    this.handlers.onSessionRefreshed?.(refreshed);
    return {
      accessToken: answer.access_token,
      ...(answer.refresh_token ? { refreshToken: answer.refresh_token } : {}),
      ...(expiry ? { expiry } : {})
    };
  }

  /**
   * Says the refresh token this session was given is worth nothing any more.
   *
   * A password change takes it away at the homeserver and says nothing about it. Whoever wrote the session
   * down is told, so what they have written is what the homeserver would actually accept.
   */
  forgetTheRefreshToken(): void {
    const held = this.session;
    if (!held?.refreshToken) return;
    const { refreshToken, expiresAt, ...withoutIt } = held;
    this.session = withoutIt;
    this.handlers.onSessionRefreshed?.(withoutIt);
  }

  async start(session: Session, handlers: AdapterHandlers): Promise<void> {
    // First, before anything that waits: whoever asks about the keys in the meantime waits on this one.
    this.cryptoUp = new Promise(resolve => {
      this.cryptoIsUp = resolve;
    });
    this.handlers = handlers;
    this.session = session;
    this.store = createBrowserStore(this.options, session.userId, session.deviceId);
    this.client = createClient({
      baseUrl: session.homeserver,
      userId: session.userId,
      accessToken: session.accessToken,
      cryptoCallbacks: this.secretStorageKeys.callbacks,
      // Without it the SDK will not build a timeline around a message it was not already holding, which is
      // exactly the case that matters: a search result, or a link somebody sent from another conversation.
      timelineSupport: true,
      ...(session.refreshToken
        ? {
            refreshToken: session.refreshToken,
            tokenRefreshFunction: (refreshToken: string) => this.refreshTheToken(session, refreshToken)
          }
        : {}),
      ...(this.store ? { store: this.store } : {}),
      ...(session.deviceId ? { deviceId: session.deviceId } : {})
    });
    if (this.store) await this.store.startup();
    // A guest has no keys of its own and is refused everything to do with them, so it is told what it is
    // before anything asks: the SDK then leaves out the push rules and the filters it would also be refused.
    this.client.setGuest(session.isGuest === true);
    const cryptoOptions =
      typeof indexedDB === "undefined"
        ? { useIndexedDB: false }
        : {
            useIndexedDB: true,
            cryptoDatabasePrefix: `relaykit-crypto-${session.userId}-${session.deviceId ?? "unknown-device"}`
          };
    // Nothing encrypted can be read without an account, so there is nothing for a guest to set up.
    if (!session.isGuest) await this.client.initRustCrypto(cryptoOptions);
    this.cryptoIsUp();
    this.verification.start(this.client, handlers);
    // The homeserver refusing this session is not an ordinary error: nobody here asked for it, and there is
    // nothing left to do with this client. The SDK says so once, on its own channel.
    this.client.on(HttpApiEvent.SessionLoggedOut, this.handleSessionEnded);
    this.conference.watch(
      call => handlers.onCallChanged?.(call),
      speaking => handlers.onCallSpeaking?.(speaking),
      call => handlers.onCallIncoming?.(call)
    );
    // A conference somebody else starts rings here the way a room rings: as something there to join.
    this.conference.follow(this.client);
    this.client.on(ClientEvent.Sync, this.handleSync);
    this.client.on(RoomEvent.Timeline, this.handleTimeline);
    this.client.on(RoomEvent.Redaction, this.handleRedaction);
    this.client.on(RoomEvent.MyMembership, this.handleMembership);
    this.client.on(RoomEvent.Receipt, this.handleReceipt);
    this.client.on(RoomMemberEvent.Typing, this.handleTyping);
    this.client.on(ClientEvent.Event, this.handleClientEvent);
    // Asking for a window means the homeserver sends the most recent conversations instead of all of them.
    this.window =
      this.options.conversationWindow === undefined
        ? undefined
        : openTheWindow(this.client, this.options.conversationWindow);
    await waitForInitialSync(this.client, this.options.initialSyncLimit ?? 20, this.window?.sliding);
    // Rooms from before calls let only admins on one. An admin opens the ones they hold, in the background:
    // starting does not wait for it, and a room that will not open is left to say so when somebody calls.
    void this.rtc.openTheDoorsToCallsEverywhere(this.client);
  }

  whenCryptoIsUp(): Promise<void> {
    return this.cryptoUp;
  }

  /** Asking for more conversations than the window holds widens it and waits for the rest to arrive. */
  async widenTheWindow(upTo: number): Promise<void> {
    await this.window?.widen(upTo);
  }

  /** Makes sure one conversation is here, even when the window does not hold it. Nothing to do without one. */
  async reachFor(conversationId: string): Promise<void> {
    await this.window?.reach(conversationId);
  }

  async stop(): Promise<void> {
    // Nothing is coming up any more. Anybody still waiting for the crypto stack is let go, to be refused by
    // the client for the real reason — that it is stopped — rather than left hanging for ever.
    this.cryptoIsUp();
    if (!this.client) return;
    this.client.removeListener(ClientEvent.Sync, this.handleSync);
    this.client.removeListener(RoomEvent.Timeline, this.handleTimeline);
    this.client.removeListener(RoomEvent.Redaction, this.handleRedaction);
    this.client.removeListener(RoomEvent.MyMembership, this.handleMembership);
    this.client.removeListener(RoomEvent.Receipt, this.handleReceipt);
    this.client.removeListener(RoomMemberEvent.Typing, this.handleTyping);
    this.client.removeListener(ClientEvent.Event, this.handleClientEvent);
    this.client.stopClient();
    // The sync response in flight is still being worked on, and the sdk frees the encryption before it stops
    // the sync. Giving it a turn to finish keeps that work from reaching for something that is no longer there.
    await new Promise(resolve => setTimeout(resolve, 0));
    // The store goes with it. Leaving it open would keep where the sync had got to, which sounds better, but a
    // second client over the same store in the same page brings the page down.
    await this.store?.destroy();
    this.client = undefined;
    this.store = undefined;
    this.handlers = {};
    this.reactions.clear();
    this.verification.stop();
    this.lastTypingByRoom.clear();
    this.window = undefined;
    await this.conference.forget();
  }

  async logout(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.logout();
    } finally {
      await this.stop();
    }
  }

  getClient(): MatrixClient {
    if (!this.client) throw new RelayKitError("NOT_STARTED", "The client has not been started");
    return this.client;
  }

  private readonly handleTimeline = (
    event: MatrixEvent,
    room: Room | undefined,
    start: boolean | undefined
  ): void => {
    this.reactions.track(event);
    void this.handleTimelineEvent(event, room, start);
  };

  private async handleTimelineEvent(
    event: MatrixEvent,
    room: Room | undefined,
    start: boolean | undefined
  ): Promise<void> {
    const resolvedRoom = room ?? this.findRoom(event);
    handleTimeline(event, resolvedRoom, start, this.handlers, {
      decryptEvent: current => this.getClient().decryptEventIfNeeded(current),
      notificationFor: current => {
        const actions = this.getClient().getPushActionsForEvent(current);
        return { notify: actions?.notify === true, isMention: actions?.tweaks?.highlight === true };
      },
      ownUserId: () => this.getClient().getUserId() ?? undefined
    });
  }

  private readonly handleRedaction = (event: MatrixEvent, room: Room | undefined): void => {
    handleRedaction(event, room, this.handlers, this.reactions);
  };

  private readonly handleReceipt = (event: MatrixEvent, room: Room): void =>
    handleReceipt(event, room?.roomId ?? event.getRoomId(), this.handlers);

  private readonly handleTyping = (event: MatrixEvent, member: RoomMember): void => {
    // The room comes from the member the notification is about, because the event itself does not carry one.
    const roomId = member?.roomId ?? event.getRoomId();
    const userIds = JSON.stringify(event.getContent<{ user_ids?: unknown }>().user_ids ?? []);
    const alreadyEmitted = roomId !== undefined && this.lastTypingByRoom.get(roomId) === userIds;
    if (alreadyEmitted) return;
    if (roomId) this.lastTypingByRoom.set(roomId, userIds);
    handleTyping(event, roomId, this.handlers);
  };

  private readonly handleClientEvent = (event: MatrixEvent): void => {
    this.aggregate(event);
    handleClientEvent(event, this.handlers);
  };

  /**
   * Polls and location beacons are not kept like a message: the sdk gathers each one and the replies hanging
   * off it into a thing of its own, and that gathering happens as the sync hands the events over. The ordinary
   * sync does it; the sliding sync the window uses never does, so with a window open a poll would arrive and
   * never exist. Doing it here, where every event the sync brought in passes, is what makes a poll the same
   * poll whether or not the conversations came through a window.
   */
  private aggregate(event: MatrixEvent): void {
    if (!this.window) return;
    const roomId = event.getRoomId();
    if (roomId === undefined) return;
    this.getClient().processAggregatedTimelineEvents(this.getClient().getRoom(roomId) ?? undefined, [event]);
  }

  private readonly handleMembership = (room: Room): void => {
    this.handlers.onConversationUpdated?.(mapConversation(room));
    // A room this account just joined, or made, or was only now told about: if it is closed to calls and
    // this account may open it, it is opened now, so that whoever tries to call in it first is not refused.
    void this.rtc.openTheDoorToCallsIfClosed(this.getClient(), room).catch(() => undefined);
  };

  private readonly handleSessionEnded = (): void => {
    this.handlers.onSessionEnded?.();
  };

  private readonly handleSync = (state: string): void => handleSync(state, this.handlers);

  private findRoom(event: MatrixEvent): Room | undefined {
    const roomId = event.getRoomId();
    return roomId ? (this.getClient().getRoom(roomId) ?? undefined) : undefined;
  }
}
