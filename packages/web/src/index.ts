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
  type Session,
  type User
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
   * Secret used to derive the key that encrypts the local IndexedDB storage. Defaults to a secret made once
   * for this browser and kept there, so signing in again does not leave the local copy unreadable. Hand in a
   * passphrase the person types if the copy has to be protected from somebody holding the device.
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
          // The device secret first, so signing in again does not leave yesterday's copy unreadable. Where
          // there is nowhere to keep one, the access token still serves: a local copy that is lost on the next
          // sign in beats no local copy at all.
          storageSecret ?? rememberedDeviceSecret() ?? holder.session?.accessToken
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

  async getDraft(conversationId: ConversationId): Promise<string | undefined> {
    return this.target?.getDraft(conversationId);
  }

  async saveDraft(conversationId: ConversationId, text: string | undefined): Promise<void> {
    await this.target?.saveDraft(conversationId, text);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.target?.saveConversation(conversation);
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    await this.target?.deleteConversation(conversationId);
  }

  async deleteMessages(messageIds: readonly MessageId[]): Promise<void> {
    await this.target?.deleteMessages(messageIds);
  }

  async getProfiles(): Promise<readonly User[]> {
    return this.target?.getProfiles() ?? [];
  }

  async saveProfiles(profiles: readonly User[]): Promise<void> {
    await this.target?.saveProfiles(profiles);
  }

  async saveMessages(messages: readonly Message[]): Promise<void> {
    await this.target?.saveMessages(messages);
  }

  async saveConversations(conversations: readonly Conversation[]): Promise<void> {
    await this.target?.saveConversations(conversations);
  }

  async saveMessage(message: Message): Promise<void> {
    await this.target?.saveMessage(message);
  }

  async clear(): Promise<void> {
    await this.target?.clear();
  }
}

const deviceSecretKey = "relaykit-device-secret";

/**
 * Without somewhere to keep it there is no stable secret, and then no local copy at all: better none than one
 * thrown away on every sign in. A browser with storage turned off, or a page running somewhere that only
 * pretends to have it, must not stop the client from starting.
 */
function rememberedDeviceSecret(): string | undefined {
  try {
    const canKeepThings = typeof localStorage?.getItem === "function" && typeof localStorage.setItem === "function";
    return canKeepThings ? secretForThisDevice() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The secret that encrypts the local copy. It belongs to this browser, not to the session: using something
 * that changes when somebody signs in again, such as the access token, leaves yesterday's copy unreadable,
 * and unreadable records are dropped without a word.
 *
 * It is kept beside the data it protects, so it is not protection from somebody who can already run script on
 * this page or read this disk. What it does is keep the local copy out of plain sight and readable only by
 * this origin. For protection from somebody with the device, ask the person for a passphrase and hand it in as
 * `storageSecret`; `IndexedDbStorage.rekey` rewrites what is already there under the new one.
 */
export function secretForThisDevice(): string {
  const kept = localStorage.getItem(deviceSecretKey);
  if (kept) return kept;
  const made = [...crypto.getRandomValues(new Uint8Array(32))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  localStorage.setItem(deviceSecretKey, made);
  return made;
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
