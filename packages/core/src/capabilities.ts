/**
 * The parts of a backend that not every backend has.
 *
 * Apart from `MessagingAdapter` because they are genuinely optional: one that cannot hold a call, or run
 * a poll, or do cryptography leaves the whole of it out, and saying so by not being there beats a dozen
 * methods that exist in order to refuse. What stays in `MessagingAdapter` is what messaging *is*.
 */
import type {
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
