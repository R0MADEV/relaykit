import {
  MessagingClient as CoreMessagingClient,
  type Conversation,
  type ConversationId,
  type Message,
  type MessageId,
  type MessagingAdapter,
  type MessagingClientConfig,
  type MessagingStorage,
  type OutboxOperation,
  type Session,
  type User
} from "@relaykit/core";
import { MatrixJsAdapter, type MatrixJsAdapterOptions } from "@relaykit/matrix-js";
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
  /**
   * A passphrase the person typed, for a local copy that has to survive somebody holding the device.
   *
   * Given instead of `storageSecret`, and treated differently on purpose: what somebody types is guessable,
   * so it goes through a slow derivation with a salt kept beside the data, rather than the single digest a
   * random secret needs. `IndexedDbStorage.rekey` moves what is already there onto a new one.
   */
  readonly storagePassphrase?: string;
}

export class MessagingClient extends CoreMessagingClient {
  constructor(config: WebMessagingClientConfig) {
    const { adapter, matrix, storageSecret, storagePassphrase, ...clientConfig } = config;
    // Named after whoever is signed in, so it can only be opened once somebody is. Which may be now, or may
    // be after a sign in, a registration, a guest door or a trip through somebody else's identity provider.
    const store =
      config.storage ??
      (typeof indexedDB === "undefined"
        ? undefined
        : new StoreForWhoeverIsSignedIn(session =>
            createBrowserStorage(
              matrix,
              session?.userId,
              // The device secret first, so signing in again does not leave yesterday's copy unreadable.
              // Where there is nowhere to keep one, the access token still serves: a local copy lost on the
              // next sign in beats no local copy at all.
              storageSecret ?? rememberedDeviceSecret() ?? session?.accessToken,
              storagePassphrase
            )
          ));
    super({
      ...clientConfig,
      adapter: adapter ?? new MatrixJsAdapter(matrix),
      ...(store ? { storage: store } : {})
    });
    // One thing to follow instead of six places to remember. Every way of getting a session — signing in,
    // registering, a guest, coming back from an identity provider, a token renewed on its own, signing out —
    // arrives here, so the local copy can never belong to somebody who is not signed in any more.
    if (store instanceof StoreForWhoeverIsSignedIn) {
      store.nowSignedInAs(config.session);
      this.on("session.changed", session => store.nowSignedInAs(session));
    }
  }
}

/**
 * The local copy of whoever is signed in, and nobody else.
 *
 * Opened when there is somebody to name it after, which may be after the client was built. Closed and opened
 * again the moment that is somebody else: holding one person's copy open while another is signed in is how a
 * browser ends up showing one account's conversations to the next person who uses it.
 */
export class StoreForWhoeverIsSignedIn implements MessagingStorage {
  private storage: IndexedDbStorage | undefined;
  private openFor: string | undefined;

  constructor(private readonly open: (session: Session | undefined) => IndexedDbStorage | undefined) {}

  /**
   * Told every time the session changes, and does nothing at all unless it is a different person.
   *
   * Answers when the copy that was open has been let go of, which nothing has to wait for — the next person
   * gets their own either way — but which a test has no other way of knowing.
   */
  nowSignedInAs(session: Session | undefined): Promise<void> {
    const whoNow = session?.userId;
    if (this.storage !== undefined && whoNow === this.openFor) return Promise.resolve();
    // Letting go rather than only forgetting: a database still open refuses to be deleted and refuses to be
    // upgraded, and does it by waiting rather than by failing, so nobody finds out. Whether it let go is not
    // allowed to decide whether the next person gets their own copy.
    //
    // And when there is nobody now, the copy goes with the session rather than staying emptied: signing out
    // already takes the sync copy and the keys away, and a local copy nobody is signed in to is a cache of
    // nothing. Somebody else signing in is a different thing — the person before them has not left, so what
    // they wrote is waiting for them.
    const letting = this.storage;
    const nobodyNow = whoNow === undefined;
    const letGo = Promise.resolve()
      .then(() => (nobodyNow ? letting?.destroy() : letting?.close()))
      .catch(() => undefined);
    this.storage = undefined;
    this.openFor = whoNow;
    this.session = session;
    return letGo;
  }

  private session: Session | undefined;

  private get target(): IndexedDbStorage | undefined {
    this.storage ??= this.open(this.session);
    return this.storage;
  }

  async getConversations(): Promise<readonly Conversation[]> {
    return (await this.target?.getConversations()) ?? [];
  }

  async getMessage(messageId: MessageId): Promise<Message | undefined> {
    return this.target?.getMessage(messageId);
  }

  async getMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return (await this.target?.getMessages(conversationId)) ?? [];
  }

  async getPendingMessages(): Promise<readonly Message[]> {
    return (await this.target?.getPendingMessages()) ?? [];
  }

  async getReadyOutbox(now: number): Promise<readonly OutboxOperation[]> {
    return (await this.target?.getReadyOutbox(now)) ?? [];
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
    const canKeepThings =
      typeof localStorage?.getItem === "function" && typeof localStorage.setItem === "function";
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
  encryptionSecret: string | undefined,
  typedPassphrase: string | undefined
): IndexedDbStorage | undefined {
  if (typeof indexedDB === "undefined" || !userId) return undefined;
  const name = createBrowserStoreName(matrix?.storeName, userId);
  if (typedPassphrase) {
    return new IndexedDbStorage(name, { passphrase: { typed: typedPassphrase, salt: saltFor(name) } });
  }
  if (!encryptionSecret) return undefined;
  return new IndexedDbStorage(name, { encryptionSecret });
}

/**
 * The salt for one person's copy on this browser, made once and kept.
 *
 * Not a secret, and kept beside what it protects. What it stops is the same passphrase producing the same
 * key everywhere, so that breaking one copy does not break every other copy of every other account.
 */
function saltFor(databaseName: string): string {
  const where = `relaykit-salt-${databaseName}`;
  try {
    const kept = localStorage.getItem(where);
    if (kept) return kept;
    const made = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(where, made);
    return made;
  } catch {
    // Nowhere to keep one. The database name is no salt at all against somebody who knows it, but it is
    // still different per account, which is better than every copy everywhere sharing one key.
    return databaseName;
  }
}

// Everything from core except MessagingClient, which the local class above replaces.
export * from "@relaykit/core";
export { IndexedDbStorage } from "@relaykit/browser-storage";
export { MatrixJsAdapter, type MatrixJsAdapterOptions } from "@relaykit/matrix-js";

/**
 * What to call the local copy. Always ends in whoever it belongs to.
 *
 * A name the application chose is a prefix, never the whole name. Taking it whole means every account that
 * ever signs in on this browser shares one database — one person's conversations left where the next person
 * to sign in can reach them, with nothing to make anybody suspect it. The Matrix store next door has always
 * been named this way; this one had not.
 */
export function createBrowserStoreName(chosen: string | undefined, userId: string): string {
  return `${chosen ?? "relaykit-app"}-${userId}`;
}
