import { RelayKitError } from "./errors.js";
import { codeOf, type Diagnostics } from "./diagnostics.js";
import {
  validateLoginCredentials,
  validateRegisterCredentials,
  validateSession
} from "./session-validation.js";
import type { MessagingAdapter, AdapterHandlers, GuestsAdapter, SsoAdapter } from "./adapter.js";
import type {
  WayIn,
  ConnectionStatus,
  LoginCredentials,
  RegisterCredentials,
  Session,
  SyncStatus
} from "./models.js";

export interface ClientLifecycleContext {
  readonly adapter: MessagingAdapter;
  readonly getSession: () => Session | undefined;
  readonly setSession: (session: Session | undefined) => void;
  readonly flushPending: () => Promise<void>;
  readonly purgeStorage: () => Promise<void>;
  /** Whatever is only true while the client is running and must not survive it. */
  readonly forgetRunningState: () => void;
  readonly handlers: AdapterHandlers;
  readonly emitConnection: (status: ConnectionStatus) => void;
  readonly emitSync: (status: SyncStatus) => void;
  readonly emitError: (error: unknown) => void;
  readonly diagnostics: Diagnostics;
}

export interface StartOptions {
  /** Defaults to true: starting waits until the homeserver has been caught up with. */
  readonly waitForSync?: boolean;
}

export class ClientLifecycle {
  private caughtUp = false;

  private started = false;
  /**
   * Why the client stopped on its own, when it did. Starting without waiting comes back before the homeserver
   * has answered, so a failure lands after the application has already painted a working screen. Without this
   * every call afterwards says "start the client", which is no help to somebody who did start it.
   */
  private stoppedBecause: string | undefined;
  private connection: ConnectionStatus = "disconnected";
  private sync: SyncStatus = "idle";

  constructor(private readonly context: ClientLifecycleContext) {}

  /**
   * The ways in this homeserver offers besides a password.
   *
   * Asked of a homeserver by name, not of a session: there is nothing signed in yet. Empty is a real answer
   * and means "only a password", not "something went wrong".
   */
  async waysIn(homeserver: string): Promise<readonly WayIn[]> {
    return this.sso.listWaysIn(whereThatIs(homeserver));
  }

  /**
   * Where to send the browser, and where it should come back to.
   *
   * `comeBackTo` is this application's own address. The homeserver bounces back to it with a one-time token
   * in the query, and that token is what `finishSigningIn` takes.
   */
  async wayInAddress(homeserver: string, comeBackTo: string, wayInId?: string): Promise<string> {
    if (!comeBackTo.trim()) {
      throw new RelayKitError("INVALID_INPUT", "Where to come back to is required");
    }
    return this.sso.wayInAddress(whereThatIs(homeserver), comeBackTo.trim(), wayInId);
  }

  /** The one-time token the homeserver came back with, turned into a session. */
  async finishSigningIn(homeserver: string, token: string): Promise<Session> {
    if (this.started) throw new RelayKitError("ALREADY_STARTED", "Stop the client before signing in again");
    if (!token.trim()) {
      throw new RelayKitError("INVALID_INPUT", "A sign in token is required");
    }
    const session = await this.sso.signInWithToken(whereThatIs(homeserver), token.trim());
    this.context.setSession(session);
    return session;
  }

  /**
   * Coming in without an account, to somewhere that lets anybody in.
   *
   * A guest can read a public conversation and little else: most homeservers do not allow it at all, and the
   * ones that do keep them on a short leash. Being refused here is the ordinary answer, not a failure.
   */
  async signInAsGuest(homeserver: string): Promise<Session> {
    if (this.started) throw new RelayKitError("ALREADY_STARTED", "Stop the client before signing in again");
    const session = await this.guests.signInAsGuest(whereThatIs(homeserver));
    this.context.setSession(session);
    return session;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get guests(): GuestsAdapter {
    const found = this.context.adapter.guests;
    if (!found) {
      throw new RelayKitError(
        "NOT_SUPPORTED",
        "Coming in without an account is not something this homeserver has"
      );
    }
    return found;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get sso(): SsoAdapter {
    const found = this.context.adapter.sso;
    if (!found) {
      throw new RelayKitError("NOT_SUPPORTED", "Signing in elsewhere is not something this homeserver has");
    }
    return found;
  }

  async register(credentials: RegisterCredentials): Promise<Session> {
    if (this.started) throw new RelayKitError("ALREADY_STARTED", "Stop the client before registering");
    validateRegisterCredentials(credentials);
    const session = await this.context.adapter.register(credentials);
    this.context.setSession(session);
    return session;
  }

  async login(credentials: LoginCredentials): Promise<Session> {
    if (this.started) throw new RelayKitError("ALREADY_STARTED", "Stop the client before logging in again");
    validateLoginCredentials(credentials);
    const session = await this.context.adapter.login(credentials);
    this.context.setSession(session);
    return session;
  }

  /**
   * Starting without waiting comes back as soon as the client is running, so an application can paint what it
   * already has instead of showing nothing until the homeserver answers. Catching up carries on behind, and
   * `sync.changed` says when it is done.
   */
  async start(options: StartOptions = {}): Promise<void> {
    if (this.started) throw new RelayKitError("ALREADY_STARTED", "The client is already started");
    const session = this.context.getSession();
    if (!session) throw new RelayKitError("INVALID_SESSION", "A session is required to start the client");
    validateSession(session);
    this.started = true;
    this.caughtUp = false;
    this.stoppedBecause = undefined;
    this.setConnection("connecting");
    const startedAt = Date.now();
    this.context.diagnostics.say("sync.started");
    try {
      const running = this.context.adapter.start(session, {
        ...this.context.handlers,
        onConnectionChanged: status => this.handleConnection(status),
        onSyncChanged: status => this.setSync(status)
      });
      if (options.waitForSync === false) {
        // Whatever was left in the queue still has to go out, only once there is something to send it through.
        // Somebody may have closed the application while it was still catching up, and then there is nothing
        // to report and nothing to send.
        void running
          .then(async () => {
            if (!this.started) return;
            this.context.diagnostics.say("sync.completed", { tookMs: Date.now() - startedAt });
            this.finishCatchingUp();
            await this.context.flushPending();
          })
          .catch(async error => {
            // Catching up failed, so there is no working client here: it is put back to a stopped state
            // instead of sitting there looking as if it were running.
            this.context.diagnostics.say("sync.failed", {
              tookMs: Date.now() - startedAt,
              ...codeOf(error)
            });
            this.context.emitError(error);
            if (this.started) await this.stopAfterFailure(error);
          });
        this.setSync("syncing");
        return;
      }
      await running;
      this.context.diagnostics.say("sync.completed", { tookMs: Date.now() - startedAt });
      this.finishCatchingUp();
      await this.context.flushPending();
    } catch (error) {
      this.context.diagnostics.say("sync.failed", { tookMs: Date.now() - startedAt, ...codeOf(error) });
      await this.stopAfterFailure(error);
      // Starting is where a session first meets a homeserver, so it is the likeliest place to find out the
      // session is dead or there is no network. Flattening those into one code throws away the only thing
      // that told an application what to do about it.
      if (error instanceof RelayKitError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new RelayKitError("ADAPTER_ERROR", "The messaging adapter could not start", { detail: reason });
    }
  }

  /** Whether what the adapter reports can be trusted as the whole picture yet. */
  isCaughtUp(): boolean {
    return this.caughtUp;
  }

  private finishCatchingUp(): void {
    this.caughtUp = true;
    this.setConnection("connected");
    this.setSync("synced");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.context.adapter.stop();
    this.started = false;
    this.caughtUp = false;
    this.context.forgetRunningState();
    this.setSync("idle");
    this.setConnection("disconnected");
  }

  /**
   * Signing out, which is two things that must not depend on each other.
   *
   * The homeserver is told first, because stopping first would leave the token alive. But whether it heard is
   * not what decides whether this device forgets: somebody who says sign me out on a train with no signal has
   * to be signed out on that device, and a messenger that keeps their conversations because a server was
   * unreachable has done the one thing they were trying to prevent. So the failure is still handed on, and
   * the forgetting happens either way.
   *
   * And the local copy is emptied *before* the session goes, not after. The copy is named after whoever it
   * belongs to, so saying there is nobody first leaves nothing pointing at the thing that has to be emptied.
   */
  async logout(): Promise<void> {
    let couldNotTellTheHomeserver: unknown;
    try {
      await this.context.adapter.logout();
    } catch (error) {
      couldNotTellTheHomeserver = error;
    } finally {
      this.started = false;
      this.context.forgetRunningState();
      this.setSync("idle");
      this.setConnection("disconnected");
      await this.context.purgeStorage();
      this.context.setSession(undefined);
    }
    if (couldNotTellTheHomeserver) throw couldNotTellTheHomeserver;
  }

  /**
   * The homeserver stopped accepting this session and nobody here asked for it: suspended by whoever
   * provisions the accounts, revoked from another device, or simply expired. There is no working client left,
   * so it is put back to a stopped state, and whoever is looking at a screen is told to sign in again.
   */
  async sessionEnded(): Promise<void> {
    if (!this.started) return;
    await this.stopAfterFailure(new Error("the session is no longer accepted, sign in again"));
    // Let go of here as well. Holding a token the homeserver refuses is holding nothing, and it would be
    // read back on the next start as if it were worth trying. The local copy stays: this is not signing out,
    // and somebody who signs in again as the same person should find their conversations where they were.
    this.context.setSession(undefined);
  }

  assertStarted(): void {
    if (this.started) return;
    if (this.stoppedBecause) {
      throw new RelayKitError("NOT_STARTED", `The client stopped: ${this.stoppedBecause}. Start it again.`);
    }
    throw new RelayKitError("NOT_STARTED", "Start the client before using it");
  }

  isStarted(): boolean {
    return this.started;
  }
  getConnectionStatus(): ConnectionStatus {
    return this.connection;
  }
  getSyncStatus(): SyncStatus {
    return this.sync;
  }

  private handleConnection(status: ConnectionStatus): void {
    // Only the two turning points are worth writing down: "connecting" says the same thing as "lost" a
    // moment later, and a log full of it is a log nobody reads.
    const was = this.connection;
    if (status === "disconnected" && was !== "disconnected") this.context.diagnostics.say("connection.lost");
    if (status === "connected" && was === "disconnected") {
      this.context.diagnostics.say("connection.restored");
    }
    this.setConnection(status);
    if (status === "connected")
      void this.context.flushPending().catch(error => this.context.emitError(error));
  }

  private setConnection(status: ConnectionStatus): void {
    this.connection = status;
    this.context.emitConnection(status);
  }

  private setSync(status: SyncStatus): void {
    this.sync = status;
    this.context.emitSync(status);
  }

  private async stopAfterFailure(cause: unknown): Promise<void> {
    this.stoppedBecause = cause instanceof Error ? cause.message : String(cause);
    try {
      await this.context.adapter.stop();
    } catch (error) {
      this.context.emitError(error);
    }
    this.started = false;
    this.caughtUp = false;
    this.context.forgetRunningState();
    this.setSync("idle");
    this.setConnection("disconnected");
  }
}

/** A homeserver has to be somewhere. Said here so all three ways in refuse the same way. */
function whereThatIs(homeserver: string): string {
  if (!homeserver.trim()) {
    throw new RelayKitError("INVALID_INPUT", "A homeserver address is required");
  }
  return homeserver.trim();
}
