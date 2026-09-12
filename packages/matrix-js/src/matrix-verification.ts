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
import type {
  AdapterHandlers,
  VerificationMethod,
  VerificationRequestOptions,
  VerificationSas,
  VerificationSession
} from "@relaykit/core";

const sasMethod = "m.sas.v1";

interface TrackedVerification {
  readonly request: VerificationRequest;
  /** What the caller asked for. An incoming request is answered however the other side wants. */
  readonly method: VerificationMethod;
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

  async request(
    userId: string,
    deviceId: string | undefined,
    options: VerificationRequestOptions = {}
  ): Promise<VerificationSession> {
    const client = this.requireClient();
    const crypto = client.getCrypto();
    if (!crypto) throw new Error("Matrix crypto is not initialized");
    const isOwnUser = userId === client.getSafeUserId();
    if (!deviceId && !isOwnUser && !options.conversationId) {
      throw new SdkError("INVALID_INPUT", "Verifying another person needs a conversation the two of you share");
    }
    // Verifying another person happens inside a conversation, which is how their other devices hear about it.
    const request = deviceId
      ? await crypto.requestDeviceVerification(userId, deviceId)
      : isOwnUser
        ? await crypto.requestOwnUserVerification()
        : await crypto.requestVerificationDM(userId, options.conversationId ?? "");
    const id = this.track(request, options.method ?? "emoji");
    return this.toSession(id);
  }

  /**
   * What to draw so the other device can scan it. There is nothing to draw unless one side already trusts
   * something of the other, which is what makes the code mean anything.
   */
  async qrCode(sessionId: string): Promise<Uint8Array | undefined> {
    const code = await this.require(sessionId).request.generateQRCode();
    // Copying the view, not the buffer behind it: the buffer can be larger than the code itself.
    return code ? Uint8Array.from(code) : undefined;
  }

  /** Reading the code the other device showed proves it is the device it claims to be. */
  async scan(sessionId: string, code: Uint8Array): Promise<VerificationSession> {
    const tracked = this.require(sessionId);
    // The sdk checks for its own verifier right after handing the code to the rust side, and that check can run
    // before the change that creates it. The scan itself went through, so what is left is to wait for it.
    const scanned = await tracked.request.scanQRCode(new Uint8ClampedArray(code)).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      // The sdk checks for its own verifier right after handing the code to the rust side, and that check can
      // run before the change that creates it. The scan itself went through, so what is left is to wait.
      if (!reason.includes("no verifier")) {
        throw new SdkError("INVALID_INPUT", `That code does not belong to this verification: ${reason}`);
      }
      return undefined;
    });
    const verifier = scanned ?? await this.waitForVerifier(tracked);
    tracked.verifier = verifier;
    // Not waiting for the far side to say it was really scanned: that answer arrives as a change, and waiting
    // here would leave the caller stuck until somebody on the other device pressed something.
    void verifier.verify().catch(error => this.reportError(error));
    return this.toSession(sessionId);
  }

  /**
   * The request says when something about it changed, so there is no reason to keep asking. Looking once
   * first matters: by the time this is called the verifier is often already there, and waiting for a change
   * that has already happened would wait for ever.
   */
  private waitForVerifier(tracked: TrackedVerification): Promise<Verifier> {
    const alreadyThere = tracked.request.verifier ?? tracked.verifier;
    if (alreadyThere) return Promise.resolve(alreadyThere);
    return new Promise((resolve, reject) => {
      const giveUp = setTimeout(() => {
        tracked.request.off(VerificationRequestEvent.Change, look);
        reject(new SdkError("INVALID_INPUT", "That code did not start a verification"));
      }, 4000);
      const look = () => {
        const verifier = tracked.request.verifier ?? tracked.verifier;
        if (!verifier) return;
        clearTimeout(giveUp);
        tracked.request.off(VerificationRequestEvent.Change, look);
        resolve(verifier);
      };
      tracked.request.on(VerificationRequestEvent.Change, look);
    });
  }

  async accept(sessionId: string): Promise<VerificationSession> {
    await this.require(sessionId).request.accept();
    return this.toSession(sessionId);
  }

  async cancel(sessionId: string): Promise<VerificationSession> {
    await this.require(sessionId).request.cancel();
    return this.toSession(sessionId);
  }

  /** Says yes: the emoji match, or the other device really did scan the code this one showed. */
  async confirm(sessionId: string): Promise<VerificationSession> {
    const tracked = this.require(sessionId);
    // The live one, because the change that creates it can arrive after the one that moved the phase.
    const verifier = tracked.verifier ?? tracked.request.verifier;
    const reciprocate = verifier?.getReciprocateQrCodeCallbacks?.();
    if (reciprocate) {
      reciprocate.confirm();
      return this.toSession(sessionId);
    }
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

  private track(request: VerificationRequest, method: VerificationMethod = "emoji"): string {
    const id = request.transactionId ?? `verification-${crypto.randomUUID()}`;
    const tracked: TrackedVerification = { request, method };
    this.sessions.set(id, tracked);
    request.on(VerificationRequestEvent.Change, () => {
      void this.handleChange(id, tracked).catch(error => this.reportError(error));
    });
    return id;
  }

  private async handleChange(id: string, tracked: TrackedVerification): Promise<void> {
    const { request } = tracked;
    // Starting to compare emoji settles the method, and after that there is no code left to show. Somebody who
    // asked to verify with a code decides when to start, by showing or scanning one.
    const wantsEmoji = tracked.method !== "code";
    const shouldStartSas =
      wantsEmoji && request.phase === VerificationPhase.Ready && request.initiatedByMe && !tracked.verifier;
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
