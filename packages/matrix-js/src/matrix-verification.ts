import type { MatrixClient } from "matrix-js-sdk";
import {
  CryptoEvent,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type GeneratedSas,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier
} from "matrix-js-sdk/lib/crypto-api/index.js";
import { SdkError } from "@relaykit/core";
import type { AdapterHandlers, VerificationSas, VerificationSession } from "@relaykit/core";

const sasMethod = "m.sas.v1";

interface TrackedVerification {
  readonly request: VerificationRequest;
  verifier?: Verifier;
  sas?: ShowSasCallbacks;
  lastEmitted?: string;
}

/**
 * Drives SAS verifications on top of matrix-js-sdk. Once both sides agree to verify, the SDK exchanges keys
 * and produces the emoji the user has to compare; confirm/reject map to the SAS callbacks.
 */
export class MatrixVerificationTracker {
  private readonly sessions = new Map<string, TrackedVerification>();
  private client: MatrixClient | undefined;
  private handlers: AdapterHandlers = {};

  start(client: MatrixClient, handlers: AdapterHandlers): void {
    this.client = client;
    this.handlers = handlers;
    client.on(CryptoEvent.VerificationRequestReceived, this.handleIncoming);
  }

  stop(): void {
    this.client?.removeListener(CryptoEvent.VerificationRequestReceived, this.handleIncoming);
    this.sessions.clear();
    this.client = undefined;
    this.handlers = {};
  }

  async request(userId: string, deviceId: string | undefined): Promise<VerificationSession> {
    const client = this.requireClient();
    const crypto = client.getCrypto();
    if (!crypto) throw new Error("Matrix crypto is not initialized");
    const isOwnUser = userId === client.getSafeUserId();
    if (!deviceId && !isOwnUser) {
      throw new SdkError("INVALID_INPUT", "Verifying another user requires a device id");
    }
    const request = deviceId
      ? await crypto.requestDeviceVerification(userId, deviceId)
      : await crypto.requestOwnUserVerification();
    const id = this.track(request);
    return this.toSession(id);
  }

  async accept(sessionId: string): Promise<VerificationSession> {
    await this.require(sessionId).request.accept();
    return this.toSession(sessionId);
  }

  async cancel(sessionId: string): Promise<VerificationSession> {
    await this.require(sessionId).request.cancel();
    return this.toSession(sessionId);
  }

  async confirm(sessionId: string): Promise<VerificationSession> {
    await this.requireSas(sessionId).confirm();
    return this.toSession(sessionId);
  }

  async reject(sessionId: string): Promise<VerificationSession> {
    this.requireSas(sessionId).mismatch();
    return this.toSession(sessionId);
  }

  private readonly handleIncoming = (request: VerificationRequest): void => {
    const id = this.track(request);
    this.handlers.onVerificationRequested?.(this.toSession(id));
  };

  private track(request: VerificationRequest): string {
    const id = request.transactionId ?? `verification-${crypto.randomUUID()}`;
    const tracked: TrackedVerification = { request };
    this.sessions.set(id, tracked);
    request.on(VerificationRequestEvent.Change, () => {
      void this.handleChange(id, tracked).catch(error => this.reportError(error));
    });
    return id;
  }

  private async handleChange(id: string, tracked: TrackedVerification): Promise<void> {
    const { request } = tracked;
    const shouldStartSas = request.phase === VerificationPhase.Ready && request.initiatedByMe && !tracked.verifier;
    if (shouldStartSas) {
      tracked.verifier = await request.startVerification(sasMethod);
      this.attachVerifier(id, tracked, tracked.verifier);
    }
    const incomingVerifier = request.phase === VerificationPhase.Started && !tracked.verifier ? request.verifier : undefined;
    if (incomingVerifier) {
      tracked.verifier = incomingVerifier;
      this.attachVerifier(id, tracked, incomingVerifier);
    }
    this.emitChange(id);
    const isFinished = request.phase === VerificationPhase.Done || request.phase === VerificationPhase.Cancelled;
    if (isFinished) this.sessions.delete(id);
  }

  private attachVerifier(id: string, tracked: TrackedVerification, verifier: Verifier): void {
    verifier.on(VerifierEvent.ShowSas, sas => {
      tracked.sas = sas;
      this.emitChange(id);
    });
    // Rejections surface as a cancelled phase through the request itself.
    void verifier.verify().catch(() => undefined);
  }

  private emitChange(id: string): void {
    const tracked = this.sessions.get(id);
    if (!tracked) return;
    // The SDK fires several change events per phase; only forward real changes.
    const session = this.toSession(id, tracked);
    const serialized = JSON.stringify(session);
    if (serialized === tracked.lastEmitted) return;
    tracked.lastEmitted = serialized;
    this.handlers.onVerificationChanged?.(session);
  }

  private toSession(id: string, tracked = this.require(id)): VerificationSession {
    const { request, sas } = tracked;
    const phase = mapPhase(request.phase, sas !== undefined);
    return {
      id,
      otherUserId: request.otherUserId,
      ...(request.otherDeviceId ? { otherDeviceId: request.otherDeviceId } : {}),
      initiatedByMe: request.initiatedByMe,
      phase,
      ...(phase === "sas" && sas ? { sas: mapSas(sas.sas) } : {}),
      ...(request.cancellationCode ? { cancellationReason: request.cancellationCode } : {})
    };
  }

  private require(sessionId: string): TrackedVerification {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) throw new SdkError("VERIFICATION_NOT_FOUND", "The verification session does not exist");
    return tracked;
  }

  private requireSas(sessionId: string): ShowSasCallbacks {
    const { sas } = this.require(sessionId);
    if (!sas) throw new SdkError("INVALID_INPUT", "The verification has not reached the SAS phase yet");
    return sas;
  }

  private requireClient(): MatrixClient {
    if (!this.client) throw new Error("The Matrix adapter is not started");
    return this.client;
  }

  private reportError(error: unknown): void {
    this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

function mapPhase(phase: VerificationPhase, hasSas: boolean): VerificationSession["phase"] {
  switch (phase) {
    case VerificationPhase.Ready: return "ready";
    case VerificationPhase.Started: return hasSas ? "sas" : "started";
    case VerificationPhase.Done: return "done";
    case VerificationPhase.Cancelled: return "cancelled";
    default: return "requested";
  }
}

function mapSas(sas: GeneratedSas): VerificationSas {
  const emoji = (sas.emoji ?? []).map(([symbol, name]) => ({ symbol, name }));
  return { emoji, ...(sas.decimal ? { decimal: sas.decimal } : {}) };
}
