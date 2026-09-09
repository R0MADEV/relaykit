import {
  MessagingClient as CoreMessagingClient,
  type Conversation,
  type ConversationId,
  type LoginCredentials,
  type Message,
  type MessageId,
  type MessagingAdapter,
  type MessagingClientConfig,
  type MessagingStorage,
  type OutboxOperation,
  type Session
} from "@relaykit/core";
import {
  MatrixJsAdapter,
  type MatrixJsAdapterOptions
} from "@relaykit/matrix-js";
import { IndexedDbStorage } from "@relaykit/browser-storage";

export interface WebMessagingClientConfig extends Omit<MessagingClientConfig, "adapter"> {
  readonly adapter?: MessagingAdapter;
  readonly matrix?: MatrixJsAdapterOptions;
  /**
   * Secret used to derive the key that encrypts the local IndexedDB storage. Defaults to the session access
   * token, which stops working if the token is rotated; provide a stable per-device secret in production.
   */
  readonly storageSecret?: string;
}

export class MessagingClient extends CoreMessagingClient {
  private readonly sessionHolder: { session?: Session };

  constructor(config: WebMessagingClientConfig) {
    const { adapter, matrix, storageSecret, ...clientConfig } = config;
    // The store is named after the user, so it can only be opened once there is a session. Waiting for one
    // keeps local persistence working when the application logs in instead of restoring a stored session.
    const holder: { session?: Session } = config.session ? { session: config.session } : {};
    const storage = config.storage ?? (typeof indexedDB === "undefined"
      ? undefined
      : new DeferredBrowserStorage(() => createBrowserStorage(
          matrix,
          holder.session?.userId,
          storageSecret ?? holder.session?.accessToken
        )));
    super({
      ...clientConfig,
      adapter: adapter ?? new MatrixJsAdapter(matrix),
      ...(storage ? { storage } : {})
    });
    this.sessionHolder = holder;
  }

  override async login(credentials: LoginCredentials): Promise<Session> {
    const session = await super.login(credentials);
    this.sessionHolder.session = session;
    return session;
  }
}

/** Opens the store on first use, because the session that names it may arrive after the client is built. */
class DeferredBrowserStorage implements MessagingStorage {
  private storage: IndexedDbStorage | undefined;

  constructor(private readonly open: () => IndexedDbStorage | undefined) {}

  private get target(): IndexedDbStorage | undefined {
    this.storage ??= this.open();
    return this.storage;
  }

  async getConversations(): Promise<readonly Conversation[]> {
    return await this.target?.getConversations() ?? [];
  }

  async getMessage(messageId: MessageId): Promise<Message | undefined> {
    return this.target?.getMessage(messageId);
  }

  async getMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return await this.target?.getMessages(conversationId) ?? [];
  }

  async getPendingMessages(): Promise<readonly Message[]> {
    return await this.target?.getPendingMessages() ?? [];
  }

  async getReadyOutbox(now: number): Promise<readonly OutboxOperation[]> {
    return await this.target?.getReadyOutbox(now) ?? [];
  }

  async getOutboxOperation(operationId: string): Promise<OutboxOperation | undefined> {
    return this.target?.getOutboxOperation(operationId);
  }

  async deleteMessage(messageId: MessageId): Promise<void> {
    await this.target?.deleteMessage(messageId);
  }

  async deleteOutboxOperation(operationId: string): Promise<void> {
    await this.target?.deleteOutboxOperation(operationId);
  }

  async saveOutboxOperation(operation: OutboxOperation): Promise<void> {
    await this.target?.saveOutboxOperation(operation);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.target?.saveConversation(conversation);
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    await this.target?.deleteConversation(conversationId);
  }

  async saveMessage(message: Message): Promise<void> {
    await this.target?.saveMessage(message);
  }

  async clear(): Promise<void> {
    await this.target?.clear();
  }
}

function createBrowserStorage(
  matrix: MatrixJsAdapterOptions | undefined,
  userId: string | undefined,
  encryptionSecret: string | undefined
): IndexedDbStorage | undefined {
  if (typeof indexedDB === "undefined" || !userId || !encryptionSecret) {
    return undefined;
  }

  return new IndexedDbStorage(matrix?.storeName ?? `relaykit-app-${userId}`, { encryptionSecret });
}

// Everything from core except MessagingClient, which the local class above replaces.
export * from "@relaykit/core";
export { IndexedDbStorage } from "@relaykit/browser-storage";
export {
  MatrixJsAdapter,
  type MatrixJsAdapterOptions
} from "@relaykit/matrix-js";
