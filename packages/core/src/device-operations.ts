import type { MessagingAdapter } from "./adapter.js";
import type { DeviceVerification } from "./models.js";

export interface DeviceOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class DeviceOperations {
  constructor(private readonly context: DeviceOperationsContext) {}

  async verification(userId: string, deviceId: string): Promise<DeviceVerification | undefined> {
    this.context.assertStarted();
    return this.context.adapter.getDeviceVerification(userId, deviceId);
  }

  async verify(userId: string, deviceId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.setDeviceVerified(userId, deviceId, true);
  }
}
