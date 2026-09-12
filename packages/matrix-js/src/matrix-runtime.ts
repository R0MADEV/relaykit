import {
  ClientEvent,
  HttpApiEvent,
  MatrixEvent,
  RoomEvent,
  RoomMemberEvent,
  IndexedDBStore,
  createClient,
  type MatrixClient,
  type Room,
  type RoomMember
} from "matrix-js-sdk";
import type { AdapterHandlers, Session } from "@relaykit/core";
import { createBrowserStore, handleSync, waitForInitialSync } from "./matrix-sync.js";
import { handleClientEvent, handleReceipt, handleRedaction, handleTimeline, handleTyping } from "./matrix-handlers.js";
import { mapConversation } from "./matrix-mapper.js";
import { ReactionTracker } from "./reaction-tracker.js";
import { openTheWindow, type ConversationWindow } from "./matrix-window.js";
import { SecretStorageKeyHolder } from "./matrix-security.js";
import { MatrixVerificationTracker } from "./matrix-verification.js";
import type { MatrixJsAdapterOptions } from "./types.js";

export class MatrixRuntime {
  private client: MatrixClient | undefined;
  private store: IndexedDBStore | undefined;
  private handlers: AdapterHandlers = {};
  private readonly reactions = new ReactionTracker();
  private readonly lastTypingByRoom = new Map<string, string>();
  private window: ConversationWindow | undefined;
  readonly secretStorageKeys = new SecretStorageKeyHolder();
  readonly verification = new MatrixVerificationTracker();

  constructor(private readonly options: MatrixJsAdapterOptions) {}

  async start(session: Session, handlers: AdapterHandlers): Promise<void> {
    this.handlers = handlers;
    this.store = createBrowserStore(this.options, session.userId, session.deviceId);
    this.client = createClient({
      baseUrl: session.homeserver,
      userId: session.userId,
      accessToken: session.accessToken,
      cryptoCallbacks: this.secretStorageKeys.callbacks,
      ...(this.store ? { store: this.store } : {}),
      ...(session.deviceId ? { deviceId: session.deviceId } : {})
    });
    if (this.store) await this.store.startup();
    const cryptoOptions = typeof indexedDB === "undefined"
      ? { useIndexedDB: false }
      : { useIndexedDB: true, cryptoDatabasePrefix: `relaykit-crypto-${session.userId}-${session.deviceId ?? "unknown-device"}` };
    await this.client.initRustCrypto(cryptoOptions);
    this.verification.start(this.client, handlers);
    // The homeserver refusing this session is not an ordinary error: nobody here asked for it, and there is
    // nothing left to do with this client. The SDK says so once, on its own channel.
    this.client.on(HttpApiEvent.SessionLoggedOut, this.handleSessionEnded);
    this.client.on(ClientEvent.Sync, this.handleSync);
    this.client.on(RoomEvent.Timeline, this.handleTimeline);
    this.client.on(RoomEvent.Redaction, this.handleRedaction);
    this.client.on(RoomEvent.MyMembership, this.handleMembership);
    this.client.on(RoomEvent.Receipt, this.handleReceipt);
    this.client.on(RoomMemberEvent.Typing, this.handleTyping);
    this.client.on(ClientEvent.Event, this.handleClientEvent);
    // Asking for a window means the homeserver sends the most recent conversations instead of all of them.
    this.window = this.options.conversationWindow === undefined
      ? undefined
      : openTheWindow(this.client, this.options.conversationWindow);
    await waitForInitialSync(this.client, this.options.initialSyncLimit ?? 20, this.window?.sliding);
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
    if (!this.client) throw new Error("The Matrix adapter is not started");
    return this.client;
  }

  private readonly handleTimeline = (event: MatrixEvent, room: Room | undefined, start: boolean | undefined): void => {
    this.reactions.track(event);
    void this.handleTimelineEvent(event, room, start);
  };

  private async handleTimelineEvent(event: MatrixEvent, room: Room | undefined, start: boolean | undefined): Promise<void> {
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

  private readonly handleClientEvent = (event: MatrixEvent): void => handleClientEvent(event, this.handlers);

  private readonly handleMembership = (room: Room): void => {
    this.handlers.onConversationUpdated?.(mapConversation(room));
  };

  private readonly handleSessionEnded = (): void => {
    this.handlers.onSessionEnded?.();
  };

  private readonly handleSync = (state: string): void => handleSync(state, this.handlers);

  private findRoom(event: MatrixEvent): Room | undefined {
    const roomId = event.getRoomId();
    return roomId ? this.getClient().getRoom(roomId) ?? undefined : undefined;
  }
}
