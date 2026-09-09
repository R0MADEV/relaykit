import {
  ClientEvent,
  MatrixEvent,
  RoomEvent,
  RoomMemberEvent,
  UserEvent,
  IndexedDBStore,
  createClient,
  type MatrixClient,
  type Room
} from "matrix-js-sdk";
import type { AdapterHandlers, Session } from "@relaykit/core";
import { createBrowserStore, handleSync, waitForInitialSync } from "./matrix-sync.js";
import { handlePresence, handleReceipt, handleRedaction, handleTimeline, handleTyping } from "./matrix-handlers.js";
import { mapConversation } from "./matrix-mapper.js";
import { ReactionTracker } from "./reaction-tracker.js";
import { SecretStorageKeyHolder } from "./matrix-security.js";
import { MatrixVerificationTracker } from "./matrix-verification.js";
import type { MatrixJsAdapterOptions } from "./types.js";

export class MatrixRuntime {
  private client: MatrixClient | undefined;
  private store: IndexedDBStore | undefined;
  private handlers: AdapterHandlers = {};
  private readonly reactions = new ReactionTracker();
  private readonly lastTypingByRoom = new Map<string, string>();
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
    this.client.on(ClientEvent.Sync, this.handleSync);
    this.client.on(RoomEvent.Timeline, this.handleTimeline);
    this.client.on(RoomEvent.Redaction, this.handleRedaction);
    this.client.on(RoomEvent.MyMembership, this.handleMembership);
    this.client.on(RoomEvent.Receipt, this.handleReceipt);
    this.client.on(RoomMemberEvent.Typing, this.handleTyping);
    this.client.on(UserEvent.Presence, this.handlePresence);
    await waitForInitialSync(this.client, this.options.initialSyncLimit ?? 20);
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    this.client.removeListener(ClientEvent.Sync, this.handleSync);
    this.client.removeListener(RoomEvent.Timeline, this.handleTimeline);
    this.client.removeListener(RoomEvent.Redaction, this.handleRedaction);
    this.client.removeListener(RoomEvent.MyMembership, this.handleMembership);
    this.client.removeListener(RoomEvent.Receipt, this.handleReceipt);
    this.client.removeListener(RoomMemberEvent.Typing, this.handleTyping);
    this.client.removeListener(UserEvent.Presence, this.handlePresence);
    this.client.stopClient();
    await this.store?.destroy();
    this.client = undefined;
    this.store = undefined;
    this.handlers = {};
    this.reactions.clear();
    this.verification.stop();
    this.lastTypingByRoom.clear();
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

  private readonly handleReceipt = (event: MatrixEvent): void => handleReceipt(event, this.handlers);

  private readonly handleTyping = (event: MatrixEvent): void => {
    const roomId = event.getRoomId();
    const userIds = JSON.stringify(event.getContent<{ user_ids?: unknown }>().user_ids ?? []);
    const alreadyEmitted = roomId !== undefined && this.lastTypingByRoom.get(roomId) === userIds;
    if (alreadyEmitted) return;
    if (roomId) this.lastTypingByRoom.set(roomId, userIds);
    handleTyping(event, this.handlers);
  };

  private readonly handlePresence = (event: MatrixEvent | undefined): void => handlePresence(event, this.handlers);

  private readonly handleMembership = (room: Room): void => {
    this.handlers.onConversationUpdated?.(mapConversation(room));
  };

  private readonly handleSync = (state: string): void => handleSync(state, this.handlers);

  private findRoom(event: MatrixEvent): Room | undefined {
    const roomId = event.getRoomId();
    return roomId ? this.getClient().getRoom(roomId) ?? undefined : undefined;
  }
}
