import type {
  AdapterHandlers,
  ConversationId,
  CryptoStatus,
  DeviceVerification,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  MessageId,
  RecoverySetup,
  PresenceUpdate,
  Reaction,
  UserId
} from "@relaykit/core";

export class InMemoryFeatures {
  private readonly reactions: Reaction[] = [];
  private nextReactionId = 1;
  private recoveryKey: string | undefined;

  constructor(
    private readonly getUserId: () => UserId | undefined,
    private readonly getHandlers: () => AdapterHandlers
  ) {}

  private requireUserId(): UserId {
    const userId = this.getUserId();
    if (!userId) throw new Error("The in-memory adapter is not started");
    return userId;
  }

  async addReaction(messageId: string, key: string): Promise<Reaction> {
    const senderId = this.requireUserId();
    const reaction: Reaction = { id: `memory-reaction-${this.nextReactionId++}`, messageId, senderId, key, createdAt: Date.now() };
    this.reactions.push(reaction);
    this.getHandlers().onReactionAdded?.(reaction);
    return reaction;
  }

  async removeReaction(reactionId: string): Promise<void> {
    const index = this.reactions.findIndex(reaction => reaction.id === reactionId);
    if (index < 0) return;
    const [reaction] = this.reactions.splice(index, 1);
    if (reaction) this.getHandlers().onReactionRemoved?.(reaction);
  }

  async getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification> {
    return { userId, deviceId, verified: false, signedByOwner: false, crossSigningVerified: false, locallyVerified: false };
  }

  async setDeviceVerified(): Promise<void> {}
  async getCryptoStatus(): Promise<CryptoStatus> { return { crossSigningReady: false, secretStorageReady: false }; }
  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    return { activeVersion: this.recoveryKey ? "memory-backup-1" : null };
  }

  async setupRecovery(): Promise<RecoverySetup> {
    this.recoveryKey = `memory-recovery-${crypto.randomUUID()}`;
    return { recoveryKey: this.recoveryKey };
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    const isKnownKey = this.recoveryKey !== undefined && recoveryKey === this.recoveryKey;
    if (!isKnownKey) throw new Error("Unknown recovery key");
    return { total: 0, imported: 0 };
  }
  async setTyping(conversationId: ConversationId, isTyping: boolean): Promise<void> {
    const userIds = isTyping ? [this.requireUserId()] : [];
    this.getHandlers().onTypingChanged?.({ conversationId, userIds });
  }

  async setPresence(update: PresenceUpdate): Promise<void> {
    this.getHandlers().onPresenceChanged?.({ ...update, userId: this.requireUserId() });
  }

  async markMessageRead(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    this.getHandlers().onReceiptReceived?.({ conversationId, messageId, userId: this.requireUserId(), readAt: Date.now() });
  }
}
