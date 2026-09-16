import type {
  HistoryAdapter,
  AvatarImage,
  ConversationPermissions,
  ConversationRole,
  CreateSpaceInput,
  NotificationLevel,
  PublicConversation,
  PushRegistration,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  SendContent,
  Space,
  Device,
  MediaRef,
  SignOutOptions,
  ReadReceipt,
  User,
  FileInput,
  AdapterHandlers,
  MessagingAdapter,
  Conversation,
  ConversationId,
  CreateConversationInput,
  Message,
  Session,
  LoginCredentials,
  RegisterCredentials,
  Reaction,
  MessagePage,
  Participant,
  MessageId,
  MessageSurroundings,
  RemoteSearchOptions,
  RemoteSearchPage,
  RoomVersions,
  SpaceChild,
  PresenceUpdate,
  UserId,
  UserPresence,
  MarkReadOptions,
  Notification,
  ThreadSummary,
  LinkPreview,
  MediaLimits,
  CallingAdapter,
  CryptoAdapter,
  DevicesAdapter,
  LocationAdapter,
  MediaAdapter,
  PollsAdapter,
  PushAdapter,
  ReactionsAdapter,
  SpacesAdapter,
  ConversationSettingsAdapter,
  EditingAdapter,
  IgnoringAdapter,
  ModerationAdapter,
  PinsAdapter,
  PresenceAdapter,
  ReceiptsAdapter,
  SearchAdapter,
  ThreadsAdapter
} from "@relaykit/core";
import { ReceiptType } from "matrix-js-sdk";
import { loginWithPassword, registerWithPassword } from "./matrix-auth.js";
import type { MatrixJsAdapterOptions } from "./types.js";
import { deleteMatrixMessage, editMatrixMessage, findMessage } from "./matrix-message-mutations.js";
import { addMatrixReaction, removeMatrixReaction } from "./matrix-reactions.js";
import { listMatrixMessages } from "./matrix-timeline.js";
import {
  createConversation,
  joinConversation,
  listMatrixConversations,
  listMatrixThread,
  loadMoreMessages,
  searchMatrixMessages
} from "./matrix-room-operations.js";
import { sendMessage } from "./matrix-sending.js";
import { listMatrixParticipants, readMatrixPermissions, setMatrixRole } from "./matrix-permissions.js";
import {
  discoverMatrixConversations,
  knockMatrixConversation,
  listMatrixPinnedMessages,
  forgetMatrixConversation,
  listMatrixConversationTags,
  listMatrixRoomVersions,
  markMatrixRead,
  removeMatrixConversationTag,
  setMatrixConversationTag,
  listMatrixThreads,
  setMatrixUnread,
  pinMatrixMessage,
  publishMatrixConversation,
  setMatrixAlias,
  upgradeMatrixConversation,
  setMatrixHistoryVisibility,
  setMatrixJoinRule,
  setMatrixConversationAvatar,
  setMatrixNotifications,
  setMatrixTopic,
  unpinMatrixMessage
} from "./matrix-details.js";
import {
  watchForMatrixKeyword,
  stopWatchingForMatrixKeyword,
  listMatrixKeywords,
  registerMatrixPush,
  listMatrixPushRegistrations,
  unregisterMatrixPush,
  listMatrixMutedUsers,
  setMatrixUserMuted,
  getMatrixNotificationLevel,
  setMatrixNotificationLevel,
  listMatrixPending
} from "./matrix-notifying.js";
import {
  addToMatrixSpace,
  createMatrixSpace,
  listMatrixSpaceConversations,
  listMatrixSpaces,
  listMatrixSpaceChildren,
  removeFromMatrixSpace
} from "./matrix-spaces.js";
import { MatrixRuntime } from "./matrix-runtime.js";
import {
  changeMatrixMembership,
  inviteToMatrixConversation,
  leaveMatrixConversation,
  renameMatrixConversation,
  setMatrixFavourite
} from "./matrix-conversations.js";
import {
  MatrixMedia,
  downloadMatrixAttachment,
  previewMatrixLink,
  askWhatTheHomeserverTakes
} from "./matrix-media.js";
import {
  getMatrixAvatar,
  searchMatrixUsers,
  getMatrixPresence,
  getMatrixProfile,
  listMatrixDevices,
  setMatrixAvatar,
  signOutMatrixDevices
} from "./matrix-profiles.js";
import { withTranslatedErrors, type WhatWasBeingLookedFor } from "./matrix-errors.js";
import { MatrixCrypto } from "./matrix-crypto.js";
import { readAroundMatrixMessage } from "./matrix-from-outside.js";
import { MatrixSso } from "./matrix-sso.js";
import { MatrixAccount, MatrixGuests } from "./matrix-account.js";
import { MatrixShares } from "./matrix-shares.js";
import { listMatrixPastCalls } from "./matrix-call-history.js";

export class MatrixJsAdapter implements MessagingAdapter {
  /**
   * The optional halves this adapter can do, which is all of them.
   *
   * `this` rather than an object of its own: the class already has every one of those methods, so it
   * satisfies each of those shapes as it stands. Saying it here is what tells the library it does.
   */
  readonly conversationSettings: ConversationSettingsAdapter = this;
  readonly editing: EditingAdapter = this;
  readonly ignoring: IgnoringAdapter = this;
  /** Signing in elsewhere happens before there is a session, so it is its own small thing. */
  readonly history: HistoryAdapter = this;
  readonly sso = new MatrixSso();
  readonly guests = new MatrixGuests();
  readonly account = new MatrixAccount(
    () => this.runtime.getClient(),
    () => this.runtime.forgetWhatThisSessionLeft(),
    () => this.runtime.forgetTheRefreshToken()
  );
  readonly moderation: ModerationAdapter = this;
  readonly pins: PinsAdapter = this;
  readonly presence: PresenceAdapter = this;
  readonly receipts: ReceiptsAdapter = this;
  readonly search: SearchAdapter = this;
  readonly threads: ThreadsAdapter = this;

  /** Files on their way up, so one can be stopped while it is going. */
  private readonly files = new MatrixMedia();

  private readonly runtime: MatrixRuntime;

  constructor(options: MatrixJsAdapterOptions = {}) {
    this.runtime = new MatrixRuntime(options);
    // Built here and not beside the other capabilities: it takes the runtime, which exists as of this line.
    this.crypto = new MatrixCrypto(this.runtime);
    const shares = new MatrixShares(this.runtime);
    this.polls = shares;
    this.location = shares;
  }

  async register(credentials: RegisterCredentials): Promise<Session> {
    return this.run(() => registerWithPassword(credentials));
  }

  async login(credentials: LoginCredentials): Promise<Session> {
    return this.run(() => loginWithPassword(credentials));
  }

  async start(session: Session, handlers: AdapterHandlers): Promise<void> {
    await this.run(() => this.runtime.start(session, handlers));
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
  }

  async logout(): Promise<void> {
    await this.run(() => this.runtime.logout());
  }

  async listConversations(upTo?: number): Promise<readonly Conversation[]> {
    // Asking for more than the window holds widens it and waits for what is missing to arrive.
    if (upTo !== undefined) await this.runtime.widenTheWindow(upTo);
    return this.run(async () => listMatrixConversations(this.runtime.getClient()));
  }

  async joinConversation(conversationId: ConversationId, via: readonly string[] = []): Promise<Conversation> {
    // Joining one the window never sent has to reach for it, or the wait for it to be usable never ends.
    return this.reaching(conversationId, () =>
      joinConversation(this.runtime.getClient(), conversationId, via)
    );
  }

  async leaveConversation(conversationId: ConversationId): Promise<void> {
    await this.reaching(conversationId, () =>
      leaveMatrixConversation(this.runtime.getClient(), conversationId)
    );
  }

  async inviteToConversation(conversationId: ConversationId, userId: string): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      inviteToMatrixConversation(this.runtime.getClient(), conversationId, userId)
    );
  }

  async renameConversation(conversationId: ConversationId, title: string): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      renameMatrixConversation(this.runtime.getClient(), conversationId, title)
    );
  }

  async setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void> {
    await this.reaching(conversationId, () =>
      this.runtime.getClient().sendTyping(conversationId, isTyping, timeoutMs)
    );
  }

  async listParticipants(conversationId: ConversationId): Promise<readonly Participant[]> {
    return this.reaching(conversationId, () =>
      listMatrixParticipants(this.runtime.getClient(), conversationId)
    );
  }

  async readAroundMessage(
    conversationId: ConversationId,
    messageId: MessageId,
    limit: number
  ): Promise<MessageSurroundings> {
    return this.reaching(conversationId, () =>
      readAroundMatrixMessage(this.runtime.getClient(), conversationId, messageId, limit)
    );
  }

  async forgetConversation(conversationId: ConversationId): Promise<void> {
    return this.run(() => forgetMatrixConversation(this.runtime.getClient(), conversationId));
  }

  async setConversationTag(conversationId: ConversationId, tag: string): Promise<void> {
    return this.reaching(conversationId, () =>
      setMatrixConversationTag(this.runtime.getClient(), conversationId, tag)
    );
  }

  async removeConversationTag(conversationId: ConversationId, tag: string): Promise<void> {
    return this.reaching(conversationId, () =>
      removeMatrixConversationTag(this.runtime.getClient(), conversationId, tag)
    );
  }

  async listConversationTags(conversationId: ConversationId): Promise<readonly string[]> {
    return this.reaching(conversationId, () =>
      listMatrixConversationTags(this.runtime.getClient(), conversationId)
    );
  }

  async listRoomVersions(): Promise<RoomVersions> {
    return this.run(() => listMatrixRoomVersions(this.runtime.getClient()));
  }

  async listSpaceChildren(spaceId: ConversationId): Promise<readonly SpaceChild[]> {
    return this.run(() => listMatrixSpaceChildren(this.runtime.getClient(), spaceId));
  }

  async setPresence(update: PresenceUpdate): Promise<void> {
    await this.run(() =>
      this.runtime.getClient().setPresence({
        presence: update.presence,
        ...(update.statusMessage ? { status_msg: update.statusMessage } : {})
      })
    );
  }

  async getPresence(userId: UserId): Promise<UserPresence | undefined> {
    return this.run(() => getMatrixPresence(this.runtime.getClient(), userId, Date.now()));
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.run(async () => {
      const conversation = await createConversation(this.runtime.getClient(), input);
      // A conversation just made is not in the window until the homeserver says so, and whoever made it is
      // about to talk in it.
      await this.runtime.reachFor(conversation.id);
      return conversation;
    });
  }

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.reaching(conversationId, () => listMatrixMessages(this.runtime.getClient(), conversationId));
  }

  async loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage> {
    return this.reaching(conversationId, () =>
      loadMoreMessages(this.runtime.getClient(), conversationId, limit)
    );
  }

  async sendMessage(
    conversationId: ConversationId,
    body: string,
    options: SendContent = {}
  ): Promise<Message> {
    return this.reaching(conversationId, () =>
      sendMessage(this.runtime.getClient(), conversationId, body, options)
    );
  }

  upgradeConversation(conversationId: ConversationId): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      upgradeMatrixConversation(this.runtime.getClient(), conversationId)
    );
  }

  setConversationAlias(conversationId: ConversationId, alias: string): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixAlias(this.runtime.getClient(), conversationId, alias)
    );
  }

  publishConversation(conversationId: ConversationId, listed: boolean): Promise<void> {
    return this.reaching(conversationId, () =>
      publishMatrixConversation(this.runtime.getClient(), conversationId, listed)
    );
  }

  discoverConversations(query: string | undefined): Promise<readonly PublicConversation[]> {
    return this.run(() => discoverMatrixConversations(this.runtime.getClient(), query));
  }

  reportMessage(conversationId: ConversationId, messageId: string, reason: string): Promise<void> {
    // The score says how bad it is, and -100 is the worst the protocol allows.
    return this.reaching(conversationId, async () => {
      await this.runtime.getClient().reportEvent(conversationId, messageId, -100, reason);
    });
  }

  setJoinRule(conversationId: ConversationId, rule: JoinRule): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixJoinRule(this.runtime.getClient(), conversationId, rule)
    );
  }

  setHistoryVisibility(conversationId: ConversationId, visibility: HistoryVisibility): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixHistoryVisibility(this.runtime.getClient(), conversationId, visibility)
    );
  }

  knockConversation(conversationId: ConversationId, options: KnockOptions): Promise<void> {
    return this.run(() => knockMatrixConversation(this.runtime.getClient(), conversationId, options));
  }

  watchForKeyword(word: string): Promise<void> {
    return this.run(() => watchForMatrixKeyword(this.runtime.getClient(), word));
  }

  stopWatchingForKeyword(word: string): Promise<void> {
    return this.run(() => stopWatchingForMatrixKeyword(this.runtime.getClient(), word));
  }

  listKeywords(): Promise<readonly string[]> {
    return this.run(() => listMatrixKeywords(this.runtime.getClient()));
  }

  registerPush(registration: PushRegistration): Promise<void> {
    return this.run(() => registerMatrixPush(this.runtime.getClient(), registration));
  }

  listPushRegistrations(): Promise<readonly PushRegistration[]> {
    return this.run(() => listMatrixPushRegistrations(this.runtime.getClient()));
  }

  unregisterPush(deviceToken: string): Promise<void> {
    return this.run(() => unregisterMatrixPush(this.runtime.getClient(), deviceToken));
  }

  setConversationTopic(conversationId: ConversationId, topic: string): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixTopic(this.runtime.getClient(), conversationId, topic)
    );
  }

  setConversationAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixConversationAvatar(this.runtime.getClient(), conversationId, image)
    );
  }

  setConversationNotifications(
    conversationId: ConversationId,
    level: NotificationLevel
  ): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixNotifications(this.runtime.getClient(), conversationId, level)
    );
  }

  pinMessage(conversationId: ConversationId, messageId: string): Promise<void> {
    return this.reaching(conversationId, () =>
      pinMatrixMessage(this.runtime.getClient(), conversationId, messageId)
    );
  }

  unpinMessage(conversationId: ConversationId, messageId: string): Promise<void> {
    return this.reaching(conversationId, () =>
      unpinMatrixMessage(this.runtime.getClient(), conversationId, messageId)
    );
  }

  listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.reaching(conversationId, () =>
      listMatrixPinnedMessages(this.runtime.getClient(), conversationId)
    );
  }

  async listSpaces(): Promise<readonly Space[]> {
    return this.run(async () => listMatrixSpaces(this.runtime.getClient()));
  }

  createSpace(input: CreateSpaceInput): Promise<Space> {
    return this.run(() => createMatrixSpace(this.runtime.getClient(), input));
  }

  addToSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    return this.run(() => addToMatrixSpace(this.runtime.getClient(), spaceId, conversationId));
  }

  removeFromSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    return this.run(() => removeFromMatrixSpace(this.runtime.getClient(), spaceId, conversationId));
  }

  async listSpaceConversations(spaceId: ConversationId): Promise<readonly Conversation[]> {
    return this.run(async () => listMatrixSpaceConversations(this.runtime.getClient(), spaceId));
  }

  searchMessages(query: string, options: RemoteSearchOptions): Promise<RemoteSearchPage> {
    return this.run(() => searchMatrixMessages(this.runtime.getClient(), query, options));
  }

  async listThread(conversationId: ConversationId, rootId: string): Promise<readonly Message[]> {
    return this.reaching(conversationId, () =>
      listMatrixThread(this.runtime.getClient(), conversationId, rootId)
    );
  }

  getPermissions(conversationId: ConversationId): Promise<ConversationPermissions> {
    return this.reaching(conversationId, () =>
      readMatrixPermissions(this.runtime.getClient(), conversationId)
    );
  }

  setRole(conversationId: ConversationId, userId: string, role: ConversationRole): Promise<void> {
    return this.reaching(conversationId, () =>
      setMatrixRole(this.runtime.getClient(), conversationId, userId, role)
    );
  }

  async sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message> {
    return this.reaching(conversationId, () => {
      this.files.remember(this.runtime.getClient());
      return this.files.send(this.runtime.getClient(), conversationId, file, transactionId, onProgress);
    });
  }

  removeFromConversation(
    conversationId: ConversationId,
    userId: string,
    reason?: string
  ): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      changeMatrixMembership(this.runtime.getClient(), conversationId, userId, "kick", reason)
    );
  }

  banFromConversation(
    conversationId: ConversationId,
    userId: string,
    reason?: string
  ): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      changeMatrixMembership(this.runtime.getClient(), conversationId, userId, "ban", reason)
    );
  }

  unbanFromConversation(conversationId: ConversationId, userId: string): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      changeMatrixMembership(this.runtime.getClient(), conversationId, userId, "unban")
    );
  }

  setConversationFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixFavourite(this.runtime.getClient(), conversationId, favourite)
    );
  }

  listIgnoredUsers(): Promise<readonly string[]> {
    return this.run(async () => this.runtime.getClient().getIgnoredUsers());
  }

  setIgnoredUsers(userIds: readonly string[]): Promise<void> {
    return this.run(async () => {
      await this.runtime.getClient().setIgnoredUsers([...userIds]);
    });
  }

  setDisplayName(displayName: string): Promise<void> {
    return this.run(async () => {
      await this.runtime.getClient().setDisplayName(displayName);
    });
  }

  setAvatar(image: AvatarImage): Promise<void> {
    return this.run(() => setMatrixAvatar(this.runtime.getClient(), image));
  }

  listDevices(): Promise<readonly Device[]> {
    return this.run(() => listMatrixDevices(this.runtime.getClient()));
  }

  renameDevice(deviceId: string, displayName: string): Promise<void> {
    return this.run(async () => {
      await this.runtime.getClient().setDeviceDetails(deviceId, { display_name: displayName });
    });
  }

  signOutDevices(deviceIds: readonly string[], options: SignOutOptions): Promise<void> {
    return this.run(() => signOutMatrixDevices(this.runtime.getClient(), deviceIds, options));
  }

  getProfile(userId: string, conversationId?: ConversationId): Promise<User> {
    return this.run(() => getMatrixProfile(this.runtime.getClient(), userId, conversationId));
  }

  getAvatar(
    userId: string,
    conversationId?: ConversationId,
    size?: number
  ): Promise<AvatarImage | undefined> {
    return this.run(() => getMatrixAvatar(this.runtime.getClient(), userId, conversationId, size));
  }

  searchUsers(query: string, limit: number): Promise<readonly User[]> {
    return this.run(() => searchMatrixUsers(this.runtime.getClient(), query, limit));
  }

  /**
   * Conferences. Always offered by this adapter: whether the homeserver can actually hold one is not known
   * until it is asked where they are carried, and that refusal says which homeserver and why.
   */
  /** Everything Matrix does beyond the core, which is all of it. */
  readonly polls: PollsAdapter;
  readonly location: LocationAdapter;
  readonly spaces: SpacesAdapter = this;
  readonly media: MediaAdapter = this;
  readonly push: PushAdapter = this;
  readonly devices: DevicesAdapter = this;
  readonly reactions: ReactionsAdapter = this;
  readonly crypto: CryptoAdapter;

  readonly calling: CallingAdapter = {
    /** Starting a call is entering it first, and having the room ring everybody else in it. */
    placeCall: (conversationId, options) =>
      this.reaching(conversationId, async () =>
        this.runtime.conference.join(this.runtime.getClient(), conversationId, options, { ring: true })
      ),
    joinCall: (conversationId, options) =>
      this.reaching(conversationId, async () =>
        this.runtime.conference.join(this.runtime.getClient(), conversationId, options, { ring: false })
      ),
    answerCall: (callId, options) =>
      this.run(() => this.runtime.conference.answer(this.runtime.getClient(), callId, options)),
    hangUpCall: async callId => {
      await this.run(() => this.runtime.conference.leave(callId));
    },
    /** Not picking up is walking away from what rang: it goes on, and this side stops being told. */
    rejectCall: async callId => {
      await this.run(() => this.runtime.conference.leave(callId));
    },
    muteCallMicrophone: async (callId, muted) => {
      await this.run(() => this.runtime.conference.setMicrophone(callId, !muted));
    },
    muteCallCamera: async (callId, muted) => {
      await this.run(() => this.runtime.conference.setCamera(callId, !muted));
    },
    shareScreenInCall: async (callId, sharing) => {
      await this.run(() => this.runtime.conference.setScreenShare(callId, sharing));
    },
    callQuality: callId => this.run(() => this.runtime.conference.quality(callId)),
    useMicrophone: async deviceId => {
      await this.run(() => this.runtime.conference.useMicrophone(deviceId));
    },
    useCamera: async deviceId => {
      await this.run(() => this.runtime.conference.useCamera(deviceId));
    },
    listCalls: async () => this.runtime.conference.list(),
    listPastCalls: (conversationId, limit) =>
      this.reaching(conversationId, () =>
        listMatrixPastCalls(this.runtime.getClient(), conversationId, limit)
      )
  };

  async stopSendingFile(transactionId: string): Promise<boolean> {
    return this.files.stopSending(transactionId);
  }

  async mediaLimits(): Promise<MediaLimits> {
    return this.run(() => askWhatTheHomeserverTakes(this.runtime.getClient()));
  }

  previewLink(url: string): Promise<LinkPreview> {
    return this.run(() => previewMatrixLink(this.runtime.getClient(), url));
  }

  downloadAttachment(media: MediaRef): Promise<Uint8Array<ArrayBuffer>> {
    return this.run(() => downloadMatrixAttachment(this.runtime.getClient(), media));
  }

  async editMessage(conversationId: ConversationId, messageId: string, body: string): Promise<Message> {
    return this.reaching(conversationId, async () => {
      const client = this.runtime.getClient();
      const message = findMessage(await this.listMessages(conversationId), messageId);
      return editMatrixMessage(client, conversationId, message, body);
    });
  }

  async deleteMessage(conversationId: ConversationId, messageId: string): Promise<Message> {
    return this.reaching(conversationId, async () => {
      const client = this.runtime.getClient();
      const message = findMessage(await this.listMessages(conversationId), messageId);
      return deleteMatrixMessage(client, conversationId, message);
    });
  }

  async getReadReceipts(conversationId: ConversationId, messageId: string): Promise<readonly ReadReceipt[]> {
    return this.reaching(conversationId, async () => {
      const room = this.runtime.getClient().getRoom(conversationId);
      const event = room?.findEventById(messageId);
      if (!room || !event) return [];
      return room
        .getReceiptsForEvent(event)
        .filter(receipt => receipt.type === ReceiptType.Read)
        .map(receipt => ({
          conversationId,
          messageId,
          userId: receipt.userId,
          readAt: typeof receipt.data?.ts === "number" ? receipt.data.ts : Date.now()
        }));
    });
  }

  async markMessageRead(
    conversationId: ConversationId,
    messageId: string,
    options: MarkReadOptions = {}
  ): Promise<void> {
    await this.reaching(conversationId, () =>
      markMatrixRead(this.runtime.getClient(), conversationId, messageId, options)
    );
  }

  setConversationUnread(conversationId: ConversationId, unread: boolean): Promise<Conversation> {
    return this.reaching(conversationId, () =>
      setMatrixUnread(this.runtime.getClient(), conversationId, unread)
    );
  }

  listPendingNotifications(limit: number): Promise<readonly Notification[]> {
    return this.run(() => listMatrixPending(this.runtime.getClient(), limit));
  }

  listThreads(conversationId: ConversationId): Promise<readonly ThreadSummary[]> {
    return this.reaching(conversationId, () => listMatrixThreads(this.runtime.getClient(), conversationId));
  }

  listMutedUsers(): Promise<readonly string[]> {
    return this.run(() => listMatrixMutedUsers(this.runtime.getClient()));
  }

  setUserMuted(userId: string, muted: boolean): Promise<void> {
    return this.run(() => setMatrixUserMuted(this.runtime.getClient(), userId, muted));
  }

  getNotificationLevel(): Promise<NotificationLevel> {
    return this.run(() => getMatrixNotificationLevel(this.runtime.getClient()));
  }

  setNotificationLevel(level: NotificationLevel): Promise<void> {
    return this.run(() => setMatrixNotificationLevel(this.runtime.getClient(), level));
  }

  async addReaction(conversationId: ConversationId, messageId: string, key: string): Promise<Reaction> {
    return this.reaching(conversationId, () =>
      addMatrixReaction(this.runtime.getClient(), conversationId, messageId, key)
    );
  }

  async removeReaction(conversationId: ConversationId, reactionId: string): Promise<void> {
    await this.reaching(conversationId, () =>
      removeMatrixReaction(this.runtime.getClient(), conversationId, reactionId)
    );
  }

  /** Single exit point for homeserver errors, so Matrix details never reach the public API. */
  private run<Result>(operation: () => Promise<Result>, lookingFor?: WhatWasBeingLookedFor): Promise<Result> {
    return withTranslatedErrors(operation, lookingFor);
  }

  /**
   * The same, for anything done to a conversation that is already joined. When only a window over the
   * conversations is synced, one that fell outside it is not held locally, and everything that waits for it
   * would wait forever. Reaching for it first is what makes the window invisible to whoever uses this.
   */
  private reaching<Result>(
    conversationId: ConversationId,
    operation: () => Promise<Result>
  ): Promise<Result> {
    return this.run(async () => {
      await this.runtime.reachFor(conversationId);
      return operation();
    }, "conversation");
  }
}
