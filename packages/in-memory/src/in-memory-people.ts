import type {
  AvatarImage,
  DevicesAdapter,
  PushAdapter,
  ConversationId,
  Device,
  PushRegistration,
  User,
  UserId
} from "@relaykit/core";

/** What is known about somebody: how they go by, and the picture they go by it with. */
export interface HeldProfile {
  readonly displayName?: string;
  readonly avatar?: AvatarImage;
}

/** What the people of the double need from the adapter around them, and nothing else of it. */
export interface InMemoryPeopleContext {
  readonly requireUserId: () => UserId;
  readonly deviceId: () => string | undefined;
  /** Everybody this account shares a conversation with, which is half of what a directory knows. */
  readonly everybodySeen: () => readonly UserId[];
}

/**
 * Who this account is, the devices it signed in on, and what it knows about everybody else.
 *
 * A name can be one thing everywhere and another inside a conversation, so both are kept and the
 * conversation's wins when there is one. None of this touches the timeline.
 */
export class InMemoryPeople implements DevicesAdapter, PushAdapter {
  private readonly profiles = new Map<UserId, HeldProfile>();
  private readonly names = new Map<string, string>();
  private readonly devices = new Map<string, Device>();
  private readonly pushRegistrations = new Map<string, PushRegistration>();
  private readonly keywords = new Set<string>();

  constructor(private readonly context: InMemoryPeopleContext) {}

  /** Test helper: what somebody goes by everywhere, and the picture they go by it with. */
  setProfile(userId: UserId, profile: HeldProfile): void {
    this.profiles.set(userId, profile);
  }

  /** Test helper: the name somebody uses inside one conversation, which can differ from their own. */
  setConversationName(conversationId: ConversationId, userId: UserId, displayName: string): void {
    this.names.set(`${conversationId}/${userId}`, displayName);
  }

  /** Test helper: another device of this account, which is not another person. */
  addDevice(deviceId: string, displayName?: string, lastSeenAt?: number): void {
    const named = displayName ? { displayName } : {};
    const seen = lastSeenAt === undefined ? {} : { lastSeenAt };
    this.devices.set(deviceId, { id: deviceId, isCurrent: false, ...named, ...seen });
  }

  async setDisplayName(displayName: string): Promise<void> {
    const userId = this.context.requireUserId();
    this.profiles.set(userId, { ...this.profiles.get(userId), displayName });
  }

  async setAvatar(image: AvatarImage): Promise<void> {
    const userId = this.context.requireUserId();
    this.profiles.set(userId, { ...this.profiles.get(userId), avatar: image });
  }

  async getProfile(userId: UserId, conversationId?: ConversationId): Promise<User> {
    const profile = this.profiles.get(userId);
    const inConversation = conversationId ? this.names.get(`${conversationId}/${userId}`) : undefined;
    const displayName = inConversation ?? profile?.displayName;
    return {
      id: userId,
      ...(displayName ? { displayName } : {}),
      ...(profile?.avatar ? { avatarId: `memory-avatar-${userId}` } : {})
    };
  }

  async getAvatar(userId: UserId): Promise<AvatarImage | undefined> {
    return this.profiles.get(userId)?.avatar;
  }

  /**
   * A homeserver's directory knows the people it has seen, which for this account means everybody it shares a
   * conversation with, plus anybody it has been told about. The double knows the same two things.
   */
  async searchUsers(query: string, limit: number): Promise<readonly User[]> {
    const wanted = query.toLowerCase();
    const everybody = new Set([...this.profiles.keys(), ...this.context.everybodySeen()]);
    const found = [];
    for (const userId of everybody) {
      if (found.length >= limit) break;
      const profile = await this.getProfile(userId);
      const goesBy = profile.displayName?.toLowerCase() ?? "";
      const isWhoTheyMean = userId.toLowerCase().includes(wanted) || goesBy.includes(wanted);
      if (isWhoTheyMean) found.push(profile);
    }
    return found;
  }

  async listDevices(): Promise<readonly Device[]> {
    const current = this.context.deviceId();
    const own: Device[] = current ? [{ id: current, isCurrent: true }] : [];
    return [...own, ...this.devices.values()];
  }

  async renameDevice(deviceId: string, displayName: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) this.devices.set(deviceId, { ...device, displayName });
  }

  async signOutDevices(deviceIds: readonly string[]): Promise<void> {
    for (const deviceId of deviceIds) this.devices.delete(deviceId);
  }

  async watchForKeyword(word: string): Promise<void> {
    this.keywords.add(word);
  }

  async stopWatchingForKeyword(word: string): Promise<void> {
    this.keywords.delete(word);
  }

  async listKeywords(): Promise<readonly string[]> {
    return [...this.keywords];
  }

  async registerPush(registration: PushRegistration): Promise<void> {
    // The device token is what the gateway uses to find the device, so registering again replaces the old entry.
    this.pushRegistrations.set(registration.deviceToken, registration);
  }

  async listPushRegistrations(): Promise<readonly PushRegistration[]> {
    return [...this.pushRegistrations.values()];
  }

  async unregisterPush(deviceToken: string): Promise<void> {
    this.pushRegistrations.delete(deviceToken);
  }
}
