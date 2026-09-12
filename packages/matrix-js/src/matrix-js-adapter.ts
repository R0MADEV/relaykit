import type {
  AvatarImage,
  ConversationPermissions,
  ConversationRole,
  CreateSpaceInput,
  NotificationLevel,
  PublicConversation,
  VerificationRequestOptions,
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
  DeviceVerification,
  CryptoStatus,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  MessagePage,
  PresenceUpdate,
  RecoverySetup,
  RecoverySetupOptions,
  VerificationSession,
  MarkReadOptions,
  Notification,
  ThreadSummary,
  LinkPreview,
  Poll,
  StartPollInput,
  LiveLocation,
  ShareLocationInput,
  GeoLocation
} from "@relaykit/core";
import { ReceiptType } from "matrix-js-sdk";
import { SdkError } from "@relaykit/core";
import { loginWithPassword, registerWithPassword } from "./matrix-auth.js";
import type { MatrixJsAdapterOptions } from "./types.js";
import { deleteMatrixMessage, editMatrixMessage, findMessage } from "./matrix-message-mutations.js";
import { addMatrixReaction, removeMatrixReaction } from "./matrix-reactions.js";
import { listMatrixMessages } from "./matrix-timeline.js";
import {
  getCryptoStatus,
  getDeviceVerification,
  getKeyBackupStatus,
  recoverWithKey,
  setDeviceVerified,
  setupRecovery
} from "./matrix-security.js";
import {
  createConversation,
  joinConversation,
  listMatrixConversations,
  listMatrixThread,
  loadMoreMessages,
  searchMatrixMessages,
  sendMessage
} from "./matrix-room-operations.js";
import { readMatrixPermissions, setMatrixRole } from "./matrix-permissions.js";
import {
  discoverMatrixConversations,
  knockMatrixConversation,
  listMatrixKeywords,
  listMatrixPinnedMessages,
  listMatrixPushRegistrations,
  markMatrixRead,
  listMatrixThreads,
  listMatrixMutedUsers,
  setMatrixUserMuted,
  getMatrixNotificationLevel,
  setMatrixNotificationLevel,
  listMatrixPending,
  setMatrixUnread,
  pinMatrixMessage,
  publishMatrixConversation,
  registerMatrixPush,
  setMatrixAlias,
  stopWatchingForMatrixKeyword,
  upgradeMatrixConversation,
  watchForMatrixKeyword,
  setMatrixHistoryVisibility,
  setMatrixJoinRule,
  setMatrixConversationAvatar,
  setMatrixNotifications,
  setMatrixTopic,
  unpinMatrixMessage,
  unregisterMatrixPush
} from "./matrix-details.js";
import {
  addToMatrixSpace,
  createMatrixSpace,
  listMatrixSpaceConversations,
  listMatrixSpaces,
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
import { downloadMatrixAttachment, previewMatrixLink, sendMatrixAttachment } from "./matrix-media.js";
import { closeMatrixPoll, listMatrixPolls, startMatrixPoll, voteInMatrixPoll } from "./matrix-polls.js";
import {
  listMatrixLiveLocations,
  startMatrixLiveLocation,
  stopMatrixLiveLocation,
  updateMatrixLiveLocation
} from "./matrix-location.js";
import {
  getMatrixAvatar,
  searchMatrixUsers,
  getMatrixProfile,
  listMatrixDevices,
  setMatrixAvatar,
  signOutMatrixDevices
} from "./matrix-profiles.js";
import { withTranslatedErrors } from "./matrix-errors.js";

export class MatrixJsAdapter implements MessagingAdapter {
  private readonly runtime: MatrixRuntime;

  constructor(options: MatrixJsAdapterOptions = {}) {
    this.runtime = new MatrixRuntime(options);
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
    return this.run(() => joinConversation(this.runtime.getClient(), conversationId, via));
  }

  async leaveConversation(conversationId: ConversationId): Promise<void> {
    await this.reaching(conversationId, () => leaveMatrixConversation(this.runtime.getClient(), conversationId));
  }

  async inviteToConversation(conversationId: ConversationId, userId: string): Promise<Conversation> {
    return this.reaching(conversationId, () => inviteToMatrixConversation(this.runtime.getClient(), conversationId, userId));
  }

  async renameConversation(conversationId: ConversationId, title: string): Promise<Conversation> {
    return this.reaching(conversationId, () => renameMatrixConversation(this.runtime.getClient(), conversationId, title));
  }

  async setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void> {
    await this.reaching(conversationId, () => this.runtime.getClient().sendTyping(conversationId, isTyping, timeoutMs));
  }

  async setPresence(update: PresenceUpdate): Promise<void> {
    await this.run(() => this.runtime.getClient().setPresence({
      presence: update.presence,
      ...(update.statusMessage ? { status_msg: update.statusMessage } : {})
    }));
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.run(() => createConversation(this.runtime.getClient(), input));
  }

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.reaching(conversationId, () => listMatrixMessages(this.runtime.getClient(), conversationId));
  }

  async loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage> {
    return this.reaching(conversationId, () => loadMoreMessages(this.runtime.getClient(), conversationId, limit));
  }

  async sendMessage(conversationId: ConversationId, body: string, options: SendContent = {}): Promise<Message> {
    return this.reaching(conversationId, () => sendMessage(this.runtime.getClient(), conversationId, body, options));
  }

  rotateConversationKeys(conversationId: ConversationId): Promise<void> {
    return this.reaching(conversationId, async () => {
      const crypto = this.runtime.getClient().getCrypto();
      if (!crypto) throw new SdkError("NOT_CONFIGURED", "This session has no encryption");
      await crypto.forceDiscardSession(conversationId);
    });
  }

  upgradeConversation(conversationId: ConversationId): Promise<Conversation> {
    return this.reaching(conversationId, () => upgradeMatrixConversation(this.runtime.getClient(), conversationId));
  }

  setConversationAlias(conversationId: ConversationId, alias: string): Promise<Conversation> {
    return this.reaching(conversationId, () => setMatrixAlias(this.runtime.getClient(), conversationId, alias));
  }

  publishConversation(conversationId: ConversationId, listed: boolean): Promise<void> {
    return this.reaching(conversationId, () => publishMatrixConversation(this.runtime.getClient(), conversationId, listed));
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
    return this.reaching(conversationId, () => setMatrixJoinRule(this.runtime.getClient(), conversationId, rule));
  }

  setHistoryVisibility(conversationId: ConversationId, visibility: HistoryVisibility): Promise<Conversation> {
    return this.reaching(conversationId, () => setMatrixHistoryVisibility(this.runtime.getClient(), conversationId, visibility));
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
    return this.reaching(conversationId, () => setMatrixTopic(this.runtime.getClient(), conversationId, topic));
  }

  setConversationAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation> {
    return this.reaching(conversationId, () => setMatrixConversationAvatar(this.runtime.getClient(), conversationId, image));
  }

  setConversationNotifications(conversationId: ConversationId, level: NotificationLevel): Promise<Conversation> {
    return this.reaching(conversationId, () => setMatrixNotifications(this.runtime.getClient(), conversationId, level));
  }

  pinMessage(conversationId: ConversationId, messageId: string): Promise<void> {
    return this.reaching(conversationId, () => pinMatrixMessage(this.runtime.getClient(), conversationId, messageId));
  }

  unpinMessage(conversationId: ConversationId, messageId: string): Promise<void> {
    return this.reaching(conversationId, () => unpinMatrixMessage(this.runtime.getClient(), conversationId, messageId));
  }

  listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.reaching(conversationId, () => listMatrixPinnedMessages(this.runtime.getClient(), conversationId));
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

  searchMessages(query: string): Promise<readonly Message[]> {
    return this.run(() => searchMatrixMessages(this.runtime.getClient(), query));
  }

  async listThread(conversationId: ConversationId, rootId: string): Promise<readonly Message[]> {
    return this.reaching(conversationId, () => listMatrixThread(this.runtime.getClient(), conversationId, rootId));
  }

  getPermissions(conversationId: ConversationId): Promise<ConversationPermissions> {
    return this.reaching(conversationId, () => readMatrixPermissions(this.runtime.getClient(), conversationId));
  }

  setRole(conversationId: ConversationId, userId: string, role: ConversationRole): Promise<void> {
    return this.reaching(conversationId, () => setMatrixRole(this.runtime.getClient(), conversationId, userId, role));
  }

  async sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message> {
    return this.reaching(conversationId, () =>
      sendMatrixAttachment(this.runtime.getClient(), conversationId, file, transactionId, onProgress)
    );
  }

  removeFromConversation(conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation> {
    return this.reaching(conversationId, () => changeMatrixMembership(this.runtime.getClient(), conversationId, userId, "kick", reason));
  }

  banFromConversation(conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation> {
    return this.reaching(conversationId, () => changeMatrixMembership(this.runtime.getClient(), conversationId, userId, "ban", reason));
  }

  unbanFromConversation(conversationId: ConversationId, userId: string): Promise<Conversation> {
    return this.reaching(conversationId, () => changeMatrixMembership(this.runtime.getClient(), conversationId, userId, "unban"));
  }

  setConversationFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation> {
    return this.reaching(conversationId, () => setMatrixFavourite(this.runtime.getClient(), conversationId, favourite));
  }

  listIgnoredUsers(): Promise<readonly string[]> {
    return this.run(async () => this.runtime.getClient().getIgnoredUsers());
  }

  setIgnoredUsers(userIds: readonly string[]): Promise<void> {
    return this.run(async () => { await this.runtime.getClient().setIgnoredUsers([...userIds]); });
  }

  setDisplayName(displayName: string): Promise<void> {
    return this.run(async () => { await this.runtime.getClient().setDisplayName(displayName); });
  }

  setAvatar(image: AvatarImage): Promise<void> {
    return this.run(() => setMatrixAvatar(this.runtime.getClient(), image));
  }

  listDevices(): Promise<readonly Device[]> {
    return this.run(() => listMatrixDevices(this.runtime.getClient()));
  }

  renameDevice(deviceId: string, displayName: string): Promise<void> {
    return this.run(async () => { await this.runtime.getClient().setDeviceDetails(deviceId, { display_name: displayName }); });
  }

  signOutDevices(deviceIds: readonly string[], options: SignOutOptions): Promise<void> {
    return this.run(() => signOutMatrixDevices(this.runtime.getClient(), deviceIds, options));
  }

  getProfile(userId: string, conversationId?: ConversationId): Promise<User> {
    return this.run(() => getMatrixProfile(this.runtime.getClient(), userId, conversationId));
  }

  getAvatar(userId: string, conversationId?: ConversationId, size?: number): Promise<AvatarImage | undefined> {
    return this.run(() => getMatrixAvatar(this.runtime.getClient(), userId, conversationId, size));
  }

  searchUsers(query: string, limit: number): Promise<readonly User[]> {
    return this.run(() => searchMatrixUsers(this.runtime.getClient(), query, limit));
  }

  startLiveLocation(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation> {
    return this.reaching(conversationId, () =>
      startMatrixLiveLocation(this.runtime.getClient(), conversationId, input));
  }

  updateLiveLocation(sharingId: string, position: GeoLocation): Promise<void> {
    return this.run(() => updateMatrixLiveLocation(this.runtime.getClient(), sharingId, position));
  }

  stopLiveLocation(sharingId: string): Promise<void> {
    return this.run(() => stopMatrixLiveLocation(this.runtime.getClient(), sharingId));
  }

  listLiveLocations(conversationId: ConversationId): Promise<readonly LiveLocation[]> {
    return this.reaching(conversationId, () =>
      listMatrixLiveLocations(this.runtime.getClient(), conversationId));
  }

  startPoll(conversationId: ConversationId, input: StartPollInput): Promise<Poll> {
    return this.reaching(conversationId, () => startMatrixPoll(this.runtime.getClient(), conversationId, input));
  }

  voteInPoll(conversationId: ConversationId, pollId: string, answerId: string): Promise<void> {
    return this.reaching(conversationId, () =>
      voteInMatrixPoll(this.runtime.getClient(), conversationId, pollId, answerId));
  }

  closePoll(conversationId: ConversationId, pollId: string): Promise<void> {
    return this.reaching(conversationId, () => closeMatrixPoll(this.runtime.getClient(), conversationId, pollId));
  }

  listPolls(conversationId: ConversationId): Promise<readonly Poll[]> {
    return this.reaching(conversationId, () => listMatrixPolls(this.runtime.getClient(), conversationId));
  }

  previewLink(url: string): Promise<LinkPreview> {
    return this.run(() => previewMatrixLink(this.runtime.getClient(), url));
  }

  downloadAttachment(media: MediaRef): Promise<Uint8Array> {
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
      return room.getReceiptsForEvent(event)
        .filter(receipt => receipt.type === ReceiptType.Read)
        .map(receipt => ({
          conversationId,
          messageId,
          userId: receipt.userId,
          readAt: typeof receipt.data?.ts === "number" ? receipt.data.ts : Date.now()
        }));
    });
  }

  async markMessageRead(conversationId: ConversationId, messageId: string, options: MarkReadOptions = {}): Promise<void> {
    await this.reaching(conversationId, () => markMatrixRead(this.runtime.getClient(), conversationId, messageId, options));
  }

  setConversationUnread(conversationId: ConversationId, unread: boolean): Promise<Conversation> {
    return this.reaching(conversationId, () => setMatrixUnread(this.runtime.getClient(), conversationId, unread));
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
    return this.reaching(conversationId, () => addMatrixReaction(this.runtime.getClient(), conversationId, messageId, key));
  }

  async removeReaction(conversationId: ConversationId, reactionId: string): Promise<void> {
    await this.reaching(conversationId, () => removeMatrixReaction(this.runtime.getClient(), conversationId, reactionId));
  }

  async getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification | undefined> {
    return getDeviceVerification(this.runtime.getClient(), userId, deviceId);
  }

  async setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void> {
    await this.run(() => setDeviceVerified(this.runtime.getClient(), userId, deviceId, verified));
  }

  async getCryptoStatus(): Promise<CryptoStatus> {
    return getCryptoStatus(this.runtime.getClient());
  }

  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    return getKeyBackupStatus(this.runtime.getClient());
  }

  async setupRecovery(options: RecoverySetupOptions): Promise<RecoverySetup> {
    return this.run(() => setupRecovery(this.runtime.getClient(), this.runtime.secretStorageKeys, options));
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    return this.run(() => recoverWithKey(this.runtime.getClient(), this.runtime.secretStorageKeys, recoveryKey));
  }

  requestVerification(
    userId: string,
    deviceId?: string,
    options?: VerificationRequestOptions
  ): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.request(userId, deviceId, options));
  }

  getVerificationQrCode(sessionId: string): Promise<Uint8Array | undefined> {
    return this.run(() => this.runtime.verification.qrCode(sessionId));
  }

  scanVerificationQrCode(sessionId: string, code: Uint8Array): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.scan(sessionId, code));
  }

  acceptVerification(sessionId: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.accept(sessionId));
  }

  cancelVerification(sessionId: string): Promise<VerificationSession> {
    return this.runtime.verification.cancel(sessionId);
  }

  confirmVerification(sessionId: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.confirm(sessionId));
  }

  rejectVerification(sessionId: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.reject(sessionId));
  }

  /** Single exit point for homeserver errors, so Matrix details never reach the public API. */
  private run<Result>(operation: () => Promise<Result>): Promise<Result> {
    return withTranslatedErrors(operation);
  }

  /**
   * The same, for anything done to a conversation that is already joined. When only a window over the
   * conversations is synced, one that fell outside it is not held locally, and everything that waits for it
   * would wait forever. Reaching for it first is what makes the window invisible to whoever uses this.
   */
  private reaching<Result>(conversationId: ConversationId, operation: () => Promise<Result>): Promise<Result> {
    return this.run(async () => {
      await this.runtime.reachFor(conversationId);
      return operation();
    });
  }
}
