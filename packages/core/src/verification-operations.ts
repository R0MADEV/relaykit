import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { VerificationSession } from "./models.js";

export interface VerificationOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class VerificationOperations {
  constructor(private readonly context: VerificationOperationsContext) {}

  async request(userId: string, deviceId?: string): Promise<VerificationSession> {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new SdkError("INVALID_INPUT", "A user id is required to request verification");
    }
    return this.context.adapter.requestVerification(userId, deviceId);
  }

  accept(sessionId: string): Promise<VerificationSession> {
    return this.run(sessionId, id => this.context.adapter.acceptVerification(id));
  }

  cancel(sessionId: string): Promise<VerificationSession> {
    return this.run(sessionId, id => this.context.adapter.cancelVerification(id));
  }

  confirm(sessionId: string): Promise<VerificationSession> {
    return this.run(sessionId, id => this.context.adapter.confirmVerification(id));
  }

  reject(sessionId: string): Promise<VerificationSession> {
    return this.run(sessionId, id => this.context.adapter.rejectVerification(id));
  }

  private async run(sessionId: string, action: (id: string) => Promise<VerificationSession>): Promise<VerificationSession> {
    this.context.assertStarted();
    if (!sessionId.trim()) {
      throw new SdkError("INVALID_INPUT", "A verification session id is required");
    }
    return action(sessionId);
  }
}
