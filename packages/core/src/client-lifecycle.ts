import { SdkError } from "./errors.js";
import {
  validateLoginCredentials,
  validateRegisterCredentials,
  validateSession
} from "./session-validation.js";
import type { MessagingAdapter, AdapterHandlers, SsoAdapter } from "./adapter.js";
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
      throw new SdkError("INVALID_INPUT", "Where to come back to is required");
    }
    return this.sso.wayInAddress(whereThatIs(homeserver), comeBackTo.trim(), wayInId);
  }

  /** The one-time token the homeserver came back with, turned into a session. */
  async finishSigningIn(homeserver: string, token: string): Promise<Session> {
    if (this.started) throw new SdkError("ALREADY_STARTED", "Stop the client before signing in again");
    if (!token.trim()) {
      throw new SdkError("INVALID_INPUT", "A sign in token is required");
    }
    const session = await this.sso.signInWithToken(whereThatIs(homeserver), token.trim());
    this.context.setSession(session);
    return session;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get sso(): SsoAdapter {
    const found = this.context.adapter.sso;
    if (!found) {
      throw new SdkError("NOT_SUPPORTED", "Signing in elsewhere is not something this homeserver has");
    }
    return found;
  }

  async register(credentials: RegisterCredentials): Promise<Session> {
    if (this.started) throw new SdkError("ALREADY_STARTED", "Stop the client before registering");
    validateRegisterCredentials(credentials);
    const session = await this.context.adapter.register(credentials);
    this.context.setSession(session);
    return session;
  }

  async login(credentials: LoginCredentials): Promise<Session> {
    if (this.started) throw new SdkError("ALREADY_STARTED", "Stop the client before logging in again");
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
    if (this.started) throw new SdkError("ALREADY_STARTED", "The client is already started");
    const session = this.context.getSession();
    if (!session) throw new SdkError("INVALID_SESSION", "A session is required to start the client");
    validateSession(session);
    this.started = true;
    this.caughtUp = false;
    this.stoppedBecause = undefined;
    this.setConnection("connecting");
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
            this.finishCatchingUp();
            await this.context.flushPending();
          })
          .catch(async error => {
            // Catching up failed, so there is no working client here: it is put back to a stopped state
            // instead of sitting there looking as if it were running.
            this.context.emitError(error);
            if (this.started) await this.stopAfterFailure(error);
          });
        this.setSync("syncing");
        return;
      }
      await running;
      this.finishCatchingUp();
      await this.context.flushPending();
    } catch (error) {
      await this.stopAfterFailure(error);
      const reason = error instanceof Error ? error.message : String(error);
      throw new SdkError("ADAPTER_ERROR", `The messaging adapter could not start: ${reason}`);
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

  async logout(): Promise<void> {
    // The adapter revokes the server session and stops itself; stopping first would leave the token valid.
    try {
      await this.context.adapter.logout();
    } finally {
      this.started = false;
      this.context.forgetRunningState();
      this.setSync("idle");
      this.setConnection("disconnected");
    }
    this.context.setSession(undefined);
    await this.context.purgeStorage();
  }

  /**
   * The homeserver stopped accepting this session and nobody here asked for it: suspended by whoever
   * provisions the accounts, revoked from another device, or simply expired. There is no working client left,
   * so it is put back to a stopped state, and whoever is looking at a screen is told to sign in again.
   */
  async sessionEnded(): Promise<void> {
    if (!this.started) return;
    await this.stopAfterFailure(new Error("the session is no longer accepted, sign in again"));
  }

  assertStarted(): void {
    if (this.started) return;
    if (this.stoppedBecause) {
      throw new SdkError("NOT_STARTED", `The client stopped: ${this.stoppedBecause}. Start it again.`);
    }
    throw new SdkError("NOT_STARTED", "Start the client before using it");
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
    throw new SdkError("INVALID_INPUT", "A homeserver address is required");
  }
  return homeserver.trim();
}
