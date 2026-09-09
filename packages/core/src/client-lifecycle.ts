import { SdkError } from "./errors.js";
import { validateLoginCredentials, validateSession } from "./session-validation.js";
import type { MessagingAdapter, AdapterHandlers } from "./adapter.js";
import type { ConnectionStatus, LoginCredentials, Session, SyncStatus } from "./models.js";

export interface ClientLifecycleContext {
  readonly adapter: MessagingAdapter;
  readonly getSession: () => Session | undefined;
  readonly setSession: (session: Session | undefined) => void;
  readonly flushPending: () => Promise<void>;
  readonly purgeStorage: () => Promise<void>;
  readonly handlers: AdapterHandlers;
  readonly emitConnection: (status: ConnectionStatus) => void;
  readonly emitSync: (status: SyncStatus) => void;
  readonly emitError: (error: unknown) => void;
}

export class ClientLifecycle {
  private started = false;
  private connection: ConnectionStatus = "disconnected";
  private sync: SyncStatus = "idle";

  constructor(private readonly context: ClientLifecycleContext) {}

  async login(credentials: LoginCredentials): Promise<Session> {
    if (this.started) throw new SdkError("ALREADY_STARTED", "Stop the client before logging in again");
    validateLoginCredentials(credentials);
    const session = await this.context.adapter.login(credentials);
    this.context.setSession(session);
    return session;
  }

  async start(): Promise<void> {
    if (this.started) throw new SdkError("ALREADY_STARTED", "The client is already started");
    const session = this.context.getSession();
    if (!session) throw new SdkError("INVALID_SESSION", "A session is required to start the client");
    validateSession(session);
    this.started = true;
    this.setConnection("connecting");
    try {
      await this.context.adapter.start(session, {
        ...this.context.handlers,
        onConnectionChanged: status => this.handleConnection(status),
        onSyncChanged: status => this.setSync(status)
      });
      this.setConnection("connected");
      this.setSync("synced");
      await this.context.flushPending();
    } catch (error) {
      await this.stopAfterFailure();
      const reason = error instanceof Error ? error.message : String(error);
      throw new SdkError("ADAPTER_ERROR", `The messaging adapter could not start: ${reason}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.context.adapter.stop();
    this.started = false;
    this.setSync("idle");
    this.setConnection("disconnected");
  }

  async logout(): Promise<void> {
    // The adapter revokes the server session and stops itself; stopping first would leave the token valid.
    try {
      await this.context.adapter.logout();
    } finally {
      this.started = false;
      this.setSync("idle");
      this.setConnection("disconnected");
    }
    this.context.setSession(undefined);
    await this.context.purgeStorage();
  }

  assertStarted(): void {
    if (!this.started) throw new SdkError("NOT_STARTED", "Start the client before using it");
  }

  isStarted(): boolean { return this.started; }
  getConnectionStatus(): ConnectionStatus { return this.connection; }
  getSyncStatus(): SyncStatus { return this.sync; }

  private handleConnection(status: ConnectionStatus): void {
    this.setConnection(status);
    if (status === "connected") void this.context.flushPending().catch(error => this.context.emitError(error));
  }

  private setConnection(status: ConnectionStatus): void {
    this.connection = status;
    this.context.emitConnection(status);
  }

  private setSync(status: SyncStatus): void {
    this.sync = status;
    this.context.emitSync(status);
  }

  private async stopAfterFailure(): Promise<void> {
    try {
      await this.context.adapter.stop();
    } catch (error) {
      this.context.emitError(error);
    }
    this.started = false;
    this.setConnection("disconnected");
  }
}
