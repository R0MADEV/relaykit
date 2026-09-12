import { SdkError } from "@relaykit/core";
import type {
  AdapterHandlers,
  UserId,
  VerificationRequestOptions,
  VerificationSas,
  VerificationSession
} from "@relaykit/core";

const sampleSas: VerificationSas = {
  emoji: [
    { symbol: "🐶", name: "Dog" },
    { symbol: "🐱", name: "Cat" },
    { symbol: "🦁", name: "Lion" },
    { symbol: "🐎", name: "Horse" },
    { symbol: "🦄", name: "Unicorn" },
    { symbol: "🐷", name: "Pig" },
    { symbol: "🐘", name: "Elephant" }
  ],
  decimal: [1234, 5678, 9012]
};

/** Simulates the other party of a SAS verification so the flow can be exercised without a homeserver. */
export class InMemoryVerification {
  private readonly sessions = new Map<string, VerificationSession>();
  private nextSessionId = 1;
  private qrCodesWork = true;

  constructor(private readonly getHandlers: () => AdapterHandlers) {}

  request(
    otherUserId: UserId,
    otherDeviceId: string | undefined,
    options: VerificationRequestOptions = {}
  ): VerificationSession {
    const session = this.create(otherUserId, otherDeviceId, true);
    this.getHandlers().onVerificationChanged?.(session);
    // The simulated other device accepts straight away. Asking to verify with a code leaves it there: starting
    // to compare emoji would settle on emoji and there would be no code left to show.
    if (options.method !== "code") {
      queueMicrotask(() => this.update({ ...session, phase: "sas", sas: sampleSas }));
    }
    return session;
  }

  receive(otherUserId: UserId, otherDeviceId: string | undefined): VerificationSession {
    const session = this.create(otherUserId, otherDeviceId, false);
    this.getHandlers().onVerificationRequested?.(session);
    return session;
  }

  /** The code the other device would scan. It is made of this session, so a different one does not match. */
  qrCode(sessionId: string): Uint8Array | undefined {
    const session = this.require(sessionId);
    if (!this.qrCodesWork) return undefined;
    return new TextEncoder().encode(`memory-qr-${session.id}`);
  }

  scan(sessionId: string, code: Uint8Array): VerificationSession {
    const session = this.require(sessionId);
    const expected = new TextDecoder().decode(this.qrCode(sessionId) ?? new Uint8Array());
    if (new TextDecoder().decode(code) !== expected) {
      throw new SdkError("INVALID_INPUT", "That code does not belong to this verification");
    }
    const { sas: _sas, ...withoutSas } = session;
    return this.update({ ...withoutSas, phase: "done" });
  }

  /** Test helper: some verifications cannot be done with a code, and an application has to cope with that. */
  disableQrCodes(): void {
    this.qrCodesWork = false;
  }

  accept(sessionId: string): VerificationSession {
    return this.update({ ...this.require(sessionId), phase: "sas", sas: sampleSas });
  }

  cancel(sessionId: string, reason = "user"): VerificationSession {
    const { sas: _sas, ...session } = this.require(sessionId);
    return this.update({ ...session, phase: "cancelled", cancellationReason: reason });
  }

  confirm(sessionId: string): VerificationSession {
    const { sas: _sas, ...session } = this.require(sessionId);
    return this.update({ ...session, phase: "done" });
  }

  reject(sessionId: string): VerificationSession {
    return this.cancel(sessionId, "mismatch");
  }

  private create(otherUserId: UserId, otherDeviceId: string | undefined, initiatedByMe: boolean): VerificationSession {
    const session: VerificationSession = {
      id: `memory-verification-${this.nextSessionId++}`,
      otherUserId,
      ...(otherDeviceId ? { otherDeviceId } : {}),
      initiatedByMe,
      phase: "requested"
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private require(sessionId: string): VerificationSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SdkError("VERIFICATION_NOT_FOUND", "The verification session does not exist");
    return session;
  }

  private update(session: VerificationSession): VerificationSession {
    this.sessions.set(session.id, session);
    this.getHandlers().onVerificationChanged?.(session);
    return session;
  }
}
