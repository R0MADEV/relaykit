/**
 * The parts of a backend that not every backend has.
 *
 * Apart from `MessagingAdapter` because they are genuinely optional: one that cannot hold a call, or run
 * a poll, or do cryptography leaves the whole of it out, and saying so by not being there beats a dozen
 * methods that exist in order to refuse. What stays in `MessagingAdapter` is what messaging *is*.
 */
import type {
  AccountAddress,
  AddressProof,
  MessageSurroundings,
  RemoteSearchPage,
  RemoteSearchOptions,
  SpaceChild,
  RoomVersions,
  Session,
  WayIn,
  Notification,
  JoinRule,
  ThreadSummary,
  ConversationPermissions,
  MarkReadOptions,
  ReadReceipt,
  KnockOptions,
  AvatarImage,
  HistoryVisibility,
  PublicConversation,
  Participant,
  ConversationRole,
  PresenceUpdate,
  NotificationLevel,
  UserId,
  UserPresence,
  User,
  VerificationSession,
  VerificationRequestOptions,
  RecoverySetupOptions,
  RecoverySetup,
  KeyBackupStatus,
  KeyBackupRestoreSummary,
  DeviceVerification,
  CryptoStatus,
  CreateSpaceInput,
  Space,
  Device,
  MediaRef,
  SignOutOptions,
  FileInput,
  Call,
  CallQuality,
  LinkPreview,
  MediaLimits,
  PastCall,
  PlaceCallOptions,
  LiveLocation,
  ShareLocationInput,
  Poll,
  StartPollInput,
  Conversation,
  ConversationId,
  Message,
  MessageId,
  Reaction,
  PushRegistration,
  GeoLocation
} from "./models.js";

/**
 * Holding a conference: who is on one and what each of them is sending. Who may be on it and who is goes
 * over the protocol; the picture and the sound do not.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional. A protocol without conferences, or a
 * homeserver that does not say where they are carried, has none of this — and saying so by not being there
 * is better than a method that exists in order to refuse.
 */
export interface CallingAdapter {
  placeCall(conversationId: ConversationId, options: PlaceCallOptions): Promise<Call>;
  /**
   * Entering the call of a conversation, which is already going on and rings nobody. Joining what is
   * already joined returns the same call: a screen opened twice must not put somebody in twice.
   */
  joinCall(conversationId: ConversationId, options: PlaceCallOptions): Promise<Call>;
  answerCall(callId: string, options: PlaceCallOptions): Promise<Call>;
  hangUpCall(callId: string): Promise<void>;
  /** Refusing is not hanging up: the other side is told a different thing. */
  rejectCall(callId: string): Promise<void>;
  muteCallMicrophone(callId: string, muted: boolean): Promise<void>;
  muteCallCamera(callId: string, muted: boolean): Promise<void>;
  shareScreenInCall(callId: string, sharing: boolean): Promise<void>;
  callQuality(callId: string): Promise<CallQuality>;
  /** Which microphone and camera to use from now on, which belongs to the account and not to one call. */
  useMicrophone(deviceId: string): Promise<void>;
  useCamera(deviceId: string): Promise<void>;
  listCalls(): Promise<readonly Call[]>;
  /** The calls of a conversation that are over, most recent first. */
  listPastCalls(conversationId: ConversationId, limit: number): Promise<readonly PastCall[]>;
}

/**
 * Polls: the question, its answers and the votes. Closing one is final.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface PollsAdapter {
  /** A poll: the question, its answers and the votes. Closing it is final. */
  startPoll(conversationId: ConversationId, input: StartPollInput): Promise<Poll>;
  voteInPoll(conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void>;
  closePoll(conversationId: ConversationId, pollId: MessageId): Promise<void>;
  listPolls(conversationId: ConversationId): Promise<readonly Poll[]>;
}

/**
 * Telling where somebody is while they say so, which always ends on its own.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface LocationAdapter {
  /** Telling where somebody is while they move, for a while that ends on its own. */
  startLiveLocation(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation>;
  updateLiveLocation(sharingId: string, position: GeoLocation): Promise<void>;
  stopLiveLocation(sharingId: string): Promise<void>;
  listLiveLocations(conversationId: ConversationId): Promise<readonly LiveLocation[]>;
}

/**
 * Grouping conversations, for organising them by team or by project.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface SpacesAdapter {
  /** What is inside a space, down as many levels as it goes. */
  listSpaceChildren(spaceId: ConversationId): Promise<readonly SpaceChild[]>;
  listSpaces(): Promise<readonly Space[]>;
  createSpace(input: CreateSpaceInput): Promise<Space>;
  addToSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void>;
  removeFromSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void>;
  listSpaceConversations(spaceId: ConversationId): Promise<readonly Conversation[]>;
}

/**
 * Carrying files: sending them, fetching them back, and what the homeserver will take.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface MediaAdapter {
  sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message>;
  downloadAttachment(media: MediaRef): Promise<Uint8Array>;
  /** The homeserver asks, not this device: that way whoever publishes the link does not know who is looking. */
  previewLink(url: string): Promise<LinkPreview>;
  /** What the homeserver will take, so nothing is sent that it is going to refuse. */
  mediaLimits(): Promise<MediaLimits>;
  /** Stops a file on its way up. Says whether there was one to stop. */
  stopSendingFile(transactionId: string): Promise<boolean>;
}

/**
 * Being told while the application is not running, and the words worth being told about.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface PushAdapter {
  /** What the homeserver is holding for this account, which is what a cold start has to show. */
  listPendingNotifications(limit: number): Promise<readonly Notification[]>;
  /** How much anything at all is allowed to interrupt, for the whole account. */
  getNotificationLevel(): Promise<NotificationLevel>;
  setNotificationLevel(level: NotificationLevel): Promise<void>;
  registerPush(registration: PushRegistration): Promise<void>;
  listPushRegistrations(): Promise<readonly PushRegistration[]>;
  unregisterPush(deviceToken: string): Promise<void>;
  watchForKeyword(word: string): Promise<void>;
  stopWatchingForKeyword(word: string): Promise<void>;
  listKeywords(): Promise<readonly string[]>;
}

/**
 * The other devices this account is signed in on.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface DevicesAdapter {
  listDevices(): Promise<readonly Device[]>;
  renameDevice(deviceId: string, displayName: string): Promise<void>;
  signOutDevices(deviceIds: readonly string[], options: SignOutOptions): Promise<void>;
}

/**
 * A small answer to a message that is not a message of its own.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface ReactionsAdapter {
  addReaction(conversationId: ConversationId, messageId: MessageId, key: string): Promise<Reaction>;
  removeReaction(conversationId: ConversationId, reactionId: string): Promise<void>;
}

/**
 * Keys, backups and proving a device is who it says it is.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an adapter that cannot do this leaves it
 * out, and saying so by not being there beats a method that exists in order to refuse.
 */
export interface CryptoAdapter {
  rotateConversationKeys(conversationId: ConversationId): Promise<void>;
  getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification | undefined>;
  setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void>;
  getCryptoStatus(): Promise<CryptoStatus>;
  getKeyBackupStatus(): Promise<KeyBackupStatus>;
  setupRecovery(options: RecoverySetupOptions): Promise<RecoverySetup>;
  recover(recoveryKey: string): Promise<KeyBackupRestoreSummary>;
  requestVerification(
    userId: string,
    deviceId?: string,
    options?: VerificationRequestOptions
  ): Promise<VerificationSession>;
  acceptVerification(sessionId: string): Promise<VerificationSession>;
  getVerificationQrCode(sessionId: string): Promise<Uint8Array | undefined>;
  scanVerificationQrCode(sessionId: string, code: Uint8Array): Promise<VerificationSession>;
  cancelVerification(sessionId: string): Promise<VerificationSession>;
  confirmVerification(sessionId: string): Promise<VerificationSession>;
  rejectVerification(sessionId: string): Promise<VerificationSession>;
}

/**
 * Deciding who may be in a conversation and what they may do in it.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface ModerationAdapter {
  removeFromConversation(
    conversationId: ConversationId,
    userId: UserId,
    reason?: string
  ): Promise<Conversation>;
  banFromConversation(conversationId: ConversationId, userId: UserId, reason?: string): Promise<Conversation>;
  unbanFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation>;
  getPermissions(conversationId: ConversationId): Promise<ConversationPermissions>;
  setRole(conversationId: ConversationId, userId: UserId, role: ConversationRole): Promise<void>;
  /** Everybody the conversation knows about and what each of them is in it, for moderating it. */
  listParticipants(conversationId: ConversationId): Promise<readonly Participant[]>;
  knockConversation(conversationId: ConversationId, options: KnockOptions): Promise<void>;
}

/**
 * What a conversation is called, what it looks like, who may come in and how far back they can read.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface ConversationSettingsAdapter {
  forgetConversation(conversationId: ConversationId): Promise<void>;
  /** Filing a conversation under a name of this person's own. Nobody else sees it. */
  setConversationTag(conversationId: ConversationId, tag: string): Promise<void>;
  removeConversationTag(conversationId: ConversationId, tag: string): Promise<void>;
  listConversationTags(conversationId: ConversationId): Promise<readonly string[]>;
  /** Which room versions this homeserver admits, which is what an upgrade has to choose from. */
  listRoomVersions(): Promise<RoomVersions>;
  renameConversation(conversationId: ConversationId, title: string): Promise<Conversation>;
  setConversationFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation>;
  upgradeConversation(conversationId: ConversationId): Promise<Conversation>;
  setConversationAlias(conversationId: ConversationId, alias: string): Promise<Conversation>;
  publishConversation(conversationId: ConversationId, listed: boolean): Promise<void>;
  setJoinRule(conversationId: ConversationId, rule: JoinRule): Promise<Conversation>;
  setHistoryVisibility(conversationId: ConversationId, visibility: HistoryVisibility): Promise<Conversation>;
  setConversationTopic(conversationId: ConversationId, topic: string): Promise<Conversation>;
  setConversationAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation>;
  setConversationNotifications(
    conversationId: ConversationId,
    level: NotificationLevel
  ): Promise<Conversation>;
  /** Puts a conversation back to unread, or takes that mark off again. */
  setConversationUnread(conversationId: ConversationId, unread: boolean): Promise<Conversation>;
}

/**
 * Answers that hang from a message instead of filling the conversation.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface ThreadsAdapter {
  listThread(conversationId: ConversationId, rootId: MessageId): Promise<readonly Message[]>;
  /** The threads of a conversation, so a list of them costs one request instead of one per thread. */
  listThreads(conversationId: ConversationId): Promise<readonly ThreadSummary[]>;
}

/**
 * Messages kept to hand in a conversation.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface PinsAdapter {
  pinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  unpinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]>;
}

/**
 * Who has read how far.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface ReceiptsAdapter {
  markMessageRead(
    conversationId: ConversationId,
    messageId: MessageId,
    options?: MarkReadOptions
  ): Promise<void>;
  getReadReceipts(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]>;
}

/**
 * Looking for something that was said, somebody, or somewhere to join.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
/**
 * Reading history from somewhere that is not the end of it.
 *
 * Apart from listing messages, which walks backwards from the last thing said: this is for opening a
 * conversation where something was said, which needs the homeserver to look it up rather than hand over
 * what it already sent.
 */
export interface HistoryAdapter {
  /** One message with what was said on either side of it, `limit` each way. */
  readAroundMessage(
    conversationId: ConversationId,
    messageId: MessageId,
    limit: number
  ): Promise<MessageSurroundings>;
}

export interface SearchAdapter {
  /** A page at a time: given a cursor from a previous page, the same query is continued. */
  searchMessages(query: string, options: RemoteSearchOptions): Promise<RemoteSearchPage>;
  discoverConversations(query: string | undefined): Promise<readonly PublicConversation[]>;
  /** Finds people by the name they go by, for whoever does not know their identifier. */
  searchUsers(query: string, limit: number): Promise<readonly User[]>;
}

/**
 * Whether somebody is about, and whether they are writing.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface PresenceAdapter {
  setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void>;
  setPresence(update: PresenceUpdate): Promise<void>;
  /** What somebody is doing, asked for. Nothing when the homeserver has never heard anything about them. */
  getPresence(userId: UserId): Promise<UserPresence | undefined>;
}

/**
 * Changing or taking back something already said.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface EditingAdapter {
  reportMessage(conversationId: ConversationId, messageId: MessageId, reason: string): Promise<void>;
  editMessage(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message>;
  deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message>;
}

/**
 * Not hearing from somebody any more.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a backend that cannot do this leaves it
 * out, and saying so by not being there beats methods that exist in order to refuse.
 */
export interface IgnoringAdapter {
  listIgnoredUsers(): Promise<readonly UserId[]>;
  setIgnoredUsers(userIds: readonly UserId[]): Promise<void>;
  /** People whose messages arrive but do not interrupt. Silencing is not ignoring. */
  listMutedUsers(): Promise<readonly UserId[]>;
  setUserMuted(userId: UserId, muted: boolean): Promise<void>;
}

/**
 * Signing in somewhere else and coming back: an organisation's single sign-on, or Google.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: a homeserver that only takes a password has
 * none of this, and a backend that is not a homeserver may have none either.
 *
 * All three happen **before there is a session**, so the homeserver is named each time: there is nothing
 * signed in yet to ask.
 */
export interface SsoAdapter {
  /** The ways in this homeserver offers besides a password. Empty when it offers none. */
  listWaysIn(homeserver: string): Promise<readonly WayIn[]>;
  /**
   * Where to send the browser. `comeBackTo` is this application's own address: the homeserver bounces back
   * to it with a one-time token in the query, and that token is what `signInWithToken` takes.
   */
  wayInAddress(homeserver: string, comeBackTo: string, wayInId?: string): Promise<string>;
  signInWithToken(homeserver: string, token: string): Promise<Session>;
}

/**
 * The account itself: its password, its end, and whatever it wants to remember about itself.
 *
 * Apart from `MessagingAdapter` because it is genuinely optional: an account managed somewhere else — by a
 * company's directory, say — has none of this, and a backend that did not issue the password cannot change it.
 */
export interface AccountAdapter {
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** The addresses this account answers to besides the name it signed up with. */
  listAddresses(): Promise<readonly AccountAddress[]>;
  /** Sends something to the address. Nothing is added until the person proves they received it. */
  startAddingEmail(email: string): Promise<AddressProof>;
  /**
   * Finishes it, once proved. Refuses if it was not.
   *
   * The password is asked for again by the homeserver, not by this library: adding an address is how an
   * account is found and how a password is reset, so somebody who walked away from an open screen cannot.
   */
  finishAddingAddress(proof: AddressProof, password: string): Promise<void>;
  removeAddress(kind: "email" | "phone", address: string): Promise<void>;
  /** Sends a way back in to an address this account answers to. Before there is a session, like signing in. */
  startResettingPassword(homeserver: string, email: string): Promise<AddressProof>;
  finishResettingPassword(homeserver: string, proof: AddressProof, newPassword: string): Promise<void>;
  /** Ends the account. Not leaving: what is gone is gone, and the homeserver says so to everybody. */
  deactivateAccount(password: string): Promise<void>;
  /** Something this account remembers about itself, kept by the homeserver and read on any device. */
  rememberSetting(name: string, value: Readonly<Record<string, unknown>>): Promise<void>;
  rememberedSetting(name: string): Promise<Readonly<Record<string, unknown>> | undefined>;
}

/**
 * Coming in without an account, to somewhere that lets anybody in.
 *
 * Apart from `MessagingAdapter` because most homeservers do not allow it, and because it happens before there
 * is a session: the homeserver is named, as with signing in elsewhere.
 */
export interface GuestsAdapter {
  signInAsGuest(homeserver: string): Promise<Session>;
}
