import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import { verificationMethods } from "./models.js";
import type { Conversation, Session, VerificationRequestOptions, VerificationSession } from "./models.js";

export interface VerificationOperationsContext {
  /** The conversation the two of them share, opened if there is not one yet. */
  readonly openDirect: (userId: string) => Promise<Conversation>;
  readonly getSession: () => Session | undefined;
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class VerificationOperations {
  constructor(private readonly context: VerificationOperationsContext) {}

  async request(
    userId: string,
    deviceId?: string,
    options: VerificationRequestOptions = {}
  ): Promise<VerificationSession> {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new SdkError("INVALID_INPUT", "A user id is required to request verification");
    }
    if (options.method !== undefined && !verificationMethods.includes(options.method)) {
      throw new SdkError("INVALID_INPUT", `Unknown verification method: ${options.method}`);
    }
    // Verifying another person happens inside a conversation the two of them share, so there has to be one.
    const needsConversation = deviceId === undefined
      && userId !== this.context.getSession()?.userId
      && options.conversationId === undefined;
    const conversationId = needsConversation ? (await this.context.openDirect(userId)).id : options.conversationId;
    return this.context.adapter.requestVerification(userId, deviceId, {
      ...options,
      ...(conversationId ? { conversationId } : {})
    });
  }

  /**
   * What to draw so the other device can scan it. Undefined when this verification cannot be done that way,
   * which happens when neither side has anything the other already trusts.
   */
  qrCode(sessionId: string): Promise<Uint8Array | undefined> {
    return this.run(sessionId, id => this.context.adapter.getVerificationQrCode(id));
  }

  /** Reads a code scanned from the other device, which proves it is the device it says it is. */
  scan(sessionId: string, code: Uint8Array): Promise<VerificationSession> {
    if (code.byteLength === 0) {
      throw new SdkError("INVALID_INPUT", "An empty code cannot verify anything");
    }
    return this.run(sessionId, id => this.context.adapter.scanVerificationQrCode(id, code));
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

  private async run<T>(sessionId: string, action: (id: string) => Promise<T>): Promise<T> {
    this.context.assertStarted();
    if (!sessionId.trim()) {
      throw new SdkError("INVALID_INPUT", "A verification session id is required");
    }
    return action(sessionId);
  }
}
