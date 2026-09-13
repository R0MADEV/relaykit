import { SdkError } from "./errors.js";
import { notificationLevels } from "./models.js";
import type { MessagingAdapter, CryptoAdapter, DevicesAdapter, PushAdapter } from "./adapter.js";
import type {
  Device,
  DeviceVerification,
  PushRegistration,
  SignOutOptions,
  Notification,
  PendingNotificationsOptions,
  NotificationLevel,
  UserId
} from "./models.js";

export interface DeviceOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

/** More than any screen shows at once, and one request instead of paging for a list nobody scrolls. */
const notificationsPerAsk = 50;

export class DeviceOperations {
  constructor(private readonly context: DeviceOperationsContext) {}

  async verification(userId: string, deviceId: string): Promise<DeviceVerification | undefined> {
    this.context.assertStarted();
    return this.crypto.getDeviceVerification(userId, deviceId);
  }

  async verify(userId: string, deviceId: string): Promise<void> {
    this.context.assertStarted();
    await this.crypto.setDeviceVerified(userId, deviceId, true);
  }

  /** Every session open on this account, so a person can see where they are signed in. */
  async list(): Promise<readonly Device[]> {
    this.context.assertStarted();
    return this.devices.listDevices();
  }

  /** Stops trusting a device, which is what somebody does when a device is lost or was never theirs. */
  async revoke(userId: string, deviceId: string): Promise<void> {
    this.context.assertStarted();
    if (!userId.trim() || !deviceId.trim()) {
      throw new SdkError("INVALID_INPUT", "A person and a device are required");
    }
    await this.crypto.setDeviceVerified(userId.trim(), deviceId.trim(), false);
  }

  /** A word worth interrupting for, the way being named is. */
  async watchFor(word: string): Promise<void> {
    this.context.assertStarted();
    if (!word.trim()) {
      throw new SdkError("INVALID_INPUT", "A word is required, or everything would interrupt");
    }
    await this.push.watchForKeyword(word.trim());
  }

  async stopWatchingFor(word: string): Promise<void> {
    this.context.assertStarted();
    await this.push.stopWatchingForKeyword(word.trim());
  }

  async keywords(): Promise<readonly string[]> {
    this.context.assertStarted();
    return this.push.listKeywords();
  }

  /**
   * What the homeserver has been holding for this account. An application that was closed has no events to
   * work it out from, so it asks instead of guessing from what it happens to have.
   */
  async pending(options: PendingNotificationsOptions = {}): Promise<readonly Notification[]> {
    this.context.assertStarted();
    const limit = options.limit ?? notificationsPerAsk;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new SdkError("INVALID_INPUT", "How many notifications must be a positive whole number");
    }
    return this.context.adapter.listPendingNotifications(limit);
  }

  /** People whose messages arrive as usual but do not interrupt. Silencing somebody is not ignoring them. */
  async muted(): Promise<readonly UserId[]> {
    this.context.assertStarted();
    return this.context.adapter.listMutedUsers();
  }

  async mute(userId: UserId): Promise<void> {
    await this.context.adapter.setUserMuted(this.requireUser(userId), true);
  }

  async unmute(userId: UserId): Promise<void> {
    await this.context.adapter.setUserMuted(this.requireUser(userId), false);
  }

  /** How much anything at all is allowed to interrupt, for the whole account rather than one conversation. */
  async level(): Promise<NotificationLevel> {
    this.context.assertStarted();
    return this.context.adapter.getNotificationLevel();
  }

  async setLevel(level: NotificationLevel): Promise<void> {
    this.context.assertStarted();
    if (!notificationLevels.includes(level)) {
      throw new SdkError("INVALID_INPUT", `There is no such notification level: ${level}`);
    }
    await this.context.adapter.setNotificationLevel(level);
  }

  private requireUser(userId: UserId): UserId {
    this.context.assertStarted();
    const wanted = userId.trim();
    if (!wanted) {
      throw new SdkError("INVALID_INPUT", "A user id is required");
    }
    return wanted;
  }

  /** Asks the homeserver to wake this device through a push gateway while the application is closed. */
  async registerPush(registration: PushRegistration): Promise<void> {
    this.context.assertStarted();
    if (!registration.gatewayUrl.trim()) {
      throw new SdkError("INVALID_INPUT", "A push gateway address is required");
    }
    if (!registration.deviceToken.trim()) {
      throw new SdkError("INVALID_INPUT", "A device token is required");
    }
    if (!registration.appId.trim() || !registration.appName.trim()) {
      throw new SdkError("INVALID_INPUT", "An application id and name are required");
    }
    await this.push.registerPush({
      ...registration,
      gatewayUrl: registration.gatewayUrl.trim(),
      deviceToken: registration.deviceToken.trim()
    });
  }

  async pushRegistrations(): Promise<readonly PushRegistration[]> {
    this.context.assertStarted();
    return this.push.listPushRegistrations();
  }

  async unregisterPush(deviceToken: string): Promise<void> {
    this.context.assertStarted();
    await this.push.unregisterPush(deviceToken.trim());
  }

  async rename(deviceId: string, displayName: string): Promise<void> {
    this.context.assertStarted();
    if (!deviceId.trim() || !displayName.trim()) {
      throw new SdkError("INVALID_INPUT", "A device and a name are required");
    }
    await this.devices.renameDevice(deviceId.trim(), displayName.trim());
  }

  async signOut(deviceIds: readonly string[], options: SignOutOptions = {}): Promise<void> {
    this.context.assertStarted();
    const wanted = deviceIds.map(deviceId => deviceId.trim()).filter(deviceId => deviceId.length > 0);
    if (wanted.length === 0) {
      throw new SdkError("INVALID_INPUT", "At least one device is required");
    }
    await this.devices.signOutDevices(wanted, options);
  }

  /** The one place that answers whether this adapter does this at all. */
  private get crypto(): CryptoAdapter {
    const crypto = this.context.adapter.crypto;
    if (!crypto) throw new SdkError("NOT_SUPPORTED", "Cryptography is not something this adapter does");
    return crypto;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get devices(): DevicesAdapter {
    const devices = this.context.adapter.devices;
    if (!devices) throw new SdkError("NOT_SUPPORTED", "Other devices are not something this homeserver knows about");
    return devices;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get push(): PushAdapter {
    const push = this.context.adapter.push;
    if (!push) throw new SdkError("NOT_SUPPORTED", "Being pushed to is not something this homeserver does");
    return push;
  }
}
