import { RelayKitError, type RelayKitErrorCode } from "./errors.js";

/**
 * What the library is doing and why something failed, for whoever has to answer that at three in the morning.
 *
 * Deliberately not part of `client.on(...)`. Those are the events an interface is drawn from, and anything an
 * interface is drawn from is API that cannot move. These can move, and have to: they exist to be read in a
 * log, and the day one of them stops being worth writing down it should be possible to stop writing it.
 *
 * Nothing private goes through here. No message bodies, no conversation titles, no display names, no
 * addresses — this ends up in somebody else's logging service, and what it carries has to be safe there
 * without anybody having to configure a filter.
 */
export interface DiagnosticEvent {
  readonly name: DiagnosticEventName;
  /** When it happened, so a log that arrives out of order can still be read in order. */
  readonly at: number;
  /** How long the thing took, for the ones that take time. */
  readonly tookMs?: number;
  /** Which failure it was, when it was one. The code and never the message: the message can carry anything. */
  readonly code?: RelayKitErrorCode;
  /** How many times this has been tried, for the ones that are tried again. */
  readonly attempt?: number;
  /**
   * A conversation, a message or a device, named as this library names it.
   *
   * An identifier and nothing else: on Matrix a room id says nothing about what is in it, which is the only
   * reason it is safe to write down. A user id is not here, because that is a person.
   */
  readonly what?: string;
}

export type DiagnosticEventName =
  /** The first sync of a session: how long before anything could be shown at all. */
  | "sync.started"
  | "sync.completed"
  | "sync.failed"
  /** The connection to the server, which is not the same as the session being good. */
  | "connection.lost"
  | "connection.restored"
  /** A message on its way out. `queued` is always said, even when it goes straight away. */
  | "message.queued"
  | "message.sent"
  | "message.retry"
  | "message.failed"
  /** Something arrived that this device has no key for, or a recovery did not work. */
  | "crypto.undecryptable"
  | "crypto.recovery.failed"
  /** Writing locally failed, which is usually a browser refusing rather than anything remote. */
  | "storage.failed"
  /** A call that could not be joined, which is the one call failure nobody can see for themselves. */
  | "call.join.failed";

export interface DiagnosticsOptions {
  /**
   * Called for everything worth writing down. Called a lot: a busy session says something per message, so
   * whatever is behind this should be cheap, or should sample.
   *
   * Anything thrown in here is swallowed. Telling somebody what happened must never be why something stopped
   * happening.
   */
  readonly onEvent: (event: DiagnosticEvent) => void;
}

/**
 * The one place events are made and handed over.
 *
 * Built even when nobody is listening, and then does nothing at all: the callers are on hot paths and should
 * not each have to remember to check first.
 */
export class Diagnostics {
  constructor(private readonly options: DiagnosticsOptions | undefined) {}

  /** Whether anybody is listening, for the rare caller that would have to do work to say anything. */
  get wanted(): boolean {
    return this.options !== undefined;
  }

  say(name: DiagnosticEventName, about: Omit<DiagnosticEvent, "name" | "at"> = {}): void {
    if (!this.options) return;
    try {
      this.options.onEvent({ name, at: Date.now(), ...about });
    } catch {
      // Whoever is logging is not this library's problem, and is certainly not worth a failed send.
    }
  }

  /** Times something and says how long it took, whichever way it ends. */
  async timing<Result>(
    started: DiagnosticEventName,
    finished: DiagnosticEventName,
    failed: DiagnosticEventName,
    work: () => Promise<Result>
  ): Promise<Result> {
    const from = Date.now();
    this.say(started);
    try {
      const done = await work();
      this.say(finished, { tookMs: Date.now() - from });
      return done;
    } catch (error) {
      this.say(failed, { tookMs: Date.now() - from, ...codeOf(error) });
      throw error;
    }
  }
}

/**
 * The code of a failure, when it is one of ours. Never the message: the message can carry anything.
 *
 * Anything that is not one of ours has no code worth writing, and by now there should not be any: everything
 * this library throws goes through the one error type. If one shows up here as nothing, that is itself worth
 * seeing in the log.
 */
export function codeOf(error: unknown): { code?: RelayKitErrorCode } {
  return error instanceof RelayKitError ? { code: error.code } : {};
}
