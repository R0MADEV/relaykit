import { SdkError } from "@relaykit/core";
import type { AdapterHandlers, UserId, VerificationSas, VerificationSession } from "@relaykit/core";

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

  constructor(private readonly getHandlers: () => AdapterHandlers) {}

  request(otherUserId: UserId, otherDeviceId: string | undefined): VerificationSession {
    const session = this.create(otherUserId, otherDeviceId, true);
    this.getHandlers().onVerificationChanged?.(session);
    // The simulated other device accepts straight away, which brings both sides to the SAS phase.
    queueMicrotask(() => this.update({ ...session, phase: "sas", sas: sampleSas }));
    return session;
  }

  receive(otherUserId: UserId, otherDeviceId: string | undefined): VerificationSession {
    const session = this.create(otherUserId, otherDeviceId, false);
    this.getHandlers().onVerificationRequested?.(session);
    return session;
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
