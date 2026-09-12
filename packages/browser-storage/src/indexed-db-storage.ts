import { SdkError } from "@relaykit/core";
import type {
  Conversation,
  ConversationId,
  Message,
  MessageId,
  MessagingStorage,
  OutboxOperation,
  User
} from "@relaykit/core";

const conversationStore = "conversations";
const messageStore = "messages";
const outboxStore = "outbox";
const draftStore = "drafts";
const profileStore = "profiles";

export interface IndexedDbStorageOptions {
  readonly encryptionSecret?: string;
}

export class IndexedDbStorage implements MessagingStorage {
  private readonly database: Promise<IDBDatabase>;
  private encryptionKey: Promise<CryptoKey> | undefined;

  constructor(databaseName = "relaykit", options: IndexedDbStorageOptions = {}) {
    this.database = this.open(databaseName);
    this.encryptionKey = options.encryptionSecret
      ? this.createKey(options.encryptionSecret)
      : undefined;
    // Held onto until somebody asks for the store, so a failure here is reported then and not as a rejection
    // nobody was listening for.
    this.encryptionKey?.catch(() => undefined);
  }

  /**
   * Writes everything again under a new secret. Without this, changing the secret leaves every record
   * unreadable and the whole local copy is thrown away and fetched from the server again.
   *
   * What cannot be read with the current secret is dropped: it was already unreachable, and stopping halfway
   * would leave the store half in one secret and half in the other.
   */
  async rekey(newSecret: string): Promise<void> {
    const messages = await this.request<Message[]>(messageStore, "readonly", store => store.getAll());
    const conversations = await this.getConversations();
    const operations = await this.request<OutboxOperation[]>(outboxStore, "readonly", store => store.getAll());
    const drafts = await this.request<{ id: string; text: string }[]>(draftStore, "readonly", store => store.getAll());

    const readableMessages: Message[] = [];
    for (const stored of messages) {
      const restored = await this.restoreMessage(stored);
      if (restored) readableMessages.push(restored);
    }
    const readableOperations: OutboxOperation[] = [];
    for (const stored of operations) {
      const restored = await this.restoreOperation(stored);
      if (restored) readableOperations.push(restored);
    }
    const readableDrafts: { id: string; text: string }[] = [];
    for (const stored of drafts) {
      const text = await this.decrypt(stored.text);
      if (text !== undefined) readableDrafts.push({ id: stored.id, text });
    }

    this.encryptionKey = this.createKey(newSecret);

    await Promise.all([conversationStore, messageStore, outboxStore, draftStore, profileStore].map(name =>
      this.request(name, "readwrite", store => store.clear())
    ));
    for (const conversation of conversations) await this.saveConversation(conversation);
    for (const message of readableMessages) await this.saveMessage(message);
    for (const operation of readableOperations) await this.saveOutboxOperation(operation);
    for (const draft of readableDrafts) await this.saveDraft(draft.id, draft.text);
  }

  /** An unfinished message is the person's own text, so it is kept encrypted like everything else they wrote. */
  async getDraft(conversationId: ConversationId): Promise<string | undefined> {
    const stored = await this.request<{ text: string } | undefined>(draftStore, "readonly", store =>
      store.get(conversationId)
    );
    return stored ? this.decrypt(stored.text) : undefined;
  }

  async saveDraft(conversationId: ConversationId, text: string | undefined): Promise<void> {
    if (text === undefined) {
      await this.request(draftStore, "readwrite", store => store.delete(conversationId));
      return;
    }
    const encrypted = await this.encrypt(text);
    await this.request(draftStore, "readwrite", store => store.put({ id: conversationId, text: encrypted }));
  }

  /** What people are called. Kept so a screen with no homeserver shows names and not identifiers. */
  async getProfiles(): Promise<readonly User[]> {
    return this.request<User[]>(profileStore, "readonly", store => store.getAll());
  }

  async saveProfiles(profiles: readonly User[]): Promise<void> {
    if (profiles.length === 0) return;
    await this.writeAll(profileStore, profiles);
  }

  async deleteMessage(messageId: MessageId): Promise<void> {
    await this.deleteMessages([messageId]);
  }

  /** One transaction for the lot, the same as writing them. */
  async deleteMessages(messageIds: readonly MessageId[]): Promise<void> {
    if (messageIds.length === 0) return;
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(messageStore, "readwrite");
      const store = transaction.objectStore(messageStore);
      for (const messageId of messageIds) store.delete(messageId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB delete was aborted"));
    });
  }

  async deleteOutboxOperation(operationId: string): Promise<void> {
    await this.request(outboxStore, "readwrite", store => store.delete(operationId));
  }

  async getReadyOutbox(now: number): Promise<readonly OutboxOperation[]> {
    const operations = await this.request<OutboxOperation[]>(outboxStore, "readonly", store => store.getAll());
    const result: OutboxOperation[] = [];
    for (const operation of operations) {
      if (operation.nextAttemptAt > now) continue;
      const restored = await this.restoreOperation(operation);
      if (restored) result.push(restored);
    }
    return result;
  }

  async getOutboxOperation(operationId: string): Promise<OutboxOperation | undefined> {
    const operation = await this.request<OutboxOperation | undefined>(outboxStore, "readonly", store => store.get(operationId));
    return operation ? this.restoreOperation(operation) : undefined;
  }

  async saveOutboxOperation(operation: OutboxOperation): Promise<void> {
    const { attachment } = operation;
    const thumbnail = attachment?.thumbnail;
    const storedOperation: OutboxOperation = {
      ...operation,
      body: await this.encrypt(operation.body),
      ...(attachment ? { attachment: {
        ...attachment,
        data: await this.encryptBytes(attachment.data),
        ...(thumbnail ? { thumbnail: { ...thumbnail, data: await this.encryptBytes(thumbnail.data) } } : {})
      } } : {})
    };
    await this.request(outboxStore, "readwrite", store => store.put(storedOperation));
  }

  private async restoreOperation(operation: OutboxOperation): Promise<OutboxOperation | undefined> {
    const { attachment } = operation;
    const thumbnail = attachment?.thumbnail;
    const body = await this.decrypt(operation.body);
    const data = attachment ? await this.decryptBytes(attachment.data) : undefined;
    const thumbnailData = thumbnail ? await this.decryptBytes(thumbnail.data) : undefined;
    // An operation whose file content cannot be read could never be sent, so it is dropped with the rest.
    const isUnreadable = body === undefined || (attachment !== undefined && data === undefined);
    if (isUnreadable) {
      return undefined;
    }
    return {
      ...operation,
      body,
      ...(attachment && data ? { attachment: {
        ...attachment,
        data,
        ...(thumbnail && thumbnailData ? { thumbnail: { ...thumbnail, data: thumbnailData } } : {})
      } } : {})
    };
  }

  async getMessage(messageId: MessageId): Promise<Message | undefined> {
    const message = await this.request<Message | undefined>(messageStore, "readonly", store => store.get(messageId));
    return message ? this.restoreMessage(message) : undefined;
  }

  async getConversations(): Promise<readonly Conversation[]> {
    const conversations = await this.request<Conversation[]>(conversationStore, "readonly", store => store.getAll());
    const result: Conversation[] = [];
    for (const conversation of conversations) {
      if (!conversation.lastMessage) {
        result.push(conversation);
        continue;
      }
      // The conversation itself is readable even when its preview was written with another key.
      const { lastMessage: _unreadable, ...withoutPreview } = conversation;
      const lastMessage = await this.restoreMessage(conversation.lastMessage);
      result.push(lastMessage ? { ...conversation, lastMessage } : withoutPreview);
    }
    return result;
  }

  /** Asking the index instead of reading every message there has ever been, which is what a busy account has. */
  async getMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    const messages = await this.request<Message[]>(messageStore, "readonly", store =>
      store.index("conversationId").getAll(conversationId)
    );
    return this.restoreAll(messages);
  }

  async getPendingMessages(): Promise<readonly Message[]> {
    const queued = await this.request<Message[]>(messageStore, "readonly", store =>
      store.index("status").getAll("queued")
    );
    const failed = await this.request<Message[]>(messageStore, "readonly", store =>
      store.index("status").getAll("failed")
    );
    return this.restoreAll([...queued, ...failed]);
  }

  private async restoreAll(messages: readonly Message[]): Promise<readonly Message[]> {
    const result: Message[] = [];
    for (const message of messages) {
      const restored = await this.restoreMessage(message);
      if (restored) result.push(restored);
    }
    return result;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.saveConversations([conversation]);
  }

  private async prepareConversation(conversation: Conversation): Promise<Conversation> {
    return {
      ...conversation,
      ...(conversation.lastMessage
        ? { lastMessage: await this.prepareMessage(conversation.lastMessage) }
        : {})
    };
  }

  async saveMessage(message: Message): Promise<void> {
    await this.saveMessages([message]);
  }

  /** One transaction for the lot, instead of one per message. */
  async saveMessages(messages: readonly Message[]): Promise<void> {
    if (messages.length === 0) return;
    const prepared = await Promise.all(messages.map(message => this.prepareMessage(message)));
    await this.writeAll(messageStore, prepared);
  }

  async saveConversations(conversations: readonly Conversation[]): Promise<void> {
    if (conversations.length === 0) return;
    const prepared = await Promise.all(conversations.map(conversation => this.prepareConversation(conversation)));
    await this.writeAll(conversationStore, prepared);
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    await this.request(conversationStore, "readwrite", store => store.delete(conversationId));
    const messages = await this.request<Message[]>(messageStore, "readonly", store => store.getAll());
    const stale = messages.filter(message => message.conversationId === conversationId);
    await Promise.all(stale.map(message => this.request(messageStore, "readwrite", store => store.delete(message.id))));
  }

  async clear(): Promise<void> {
    await Promise.all([conversationStore, messageStore, outboxStore, draftStore, profileStore].map(name =>
      this.request(name, "readwrite", store => store.clear())
    ));
  }

  private open(databaseName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 5);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(conversationStore)) {
          database.createObjectStore(conversationStore, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(messageStore)) {
          database.createObjectStore(messageStore, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(outboxStore)) {
          database.createObjectStore(outboxStore, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(draftStore)) {
          database.createObjectStore(draftStore, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(profileStore)) {
          database.createObjectStore(profileStore, { keyPath: "id" });
        }
        // Without these, reading one conversation means deserialising every message of every conversation.
        const messages = request.transaction?.objectStore(messageStore);
        if (messages && !messages.indexNames.contains("conversationId")) {
          messages.createIndex("conversationId", "conversationId");
        }
        if (messages && !messages.indexNames.contains("status")) {
          messages.createIndex("status", "status");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    });
  }

  private async prepareMessage(message: Message): Promise<Message> {
    return { ...message, body: await this.encrypt(message.body) };
  }

  private async restoreMessage(message: Message): Promise<Message | undefined> {
    const body = await this.decrypt(message.body);
    return body === undefined ? undefined : { ...message, body };
  }

  private async createKey(secret: string): Promise<CryptoKey> {
    // Browsers only offer this on a secure origin. Opening the same page over http on a LAN address instead
    // of localhost is the usual way to end up without it, and saying so beats a TypeError about `undefined`.
    if (!globalThis.crypto?.subtle) {
      throw new SdkError(
        "NOT_CONFIGURED",
        "Encrypted storage needs a secure origin: serve the page over https, or reach it on localhost"
      );
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  private async encrypt(value: string): Promise<string> {
    if (!this.encryptionKey) {
      return value;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.encryptionKey,
      new TextEncoder().encode(value)
    );
    return `${this.encode(iv)}.${this.encode(new Uint8Array(encrypted))}`;
  }

  /** Encrypts raw bytes as `iv (12 bytes) + ciphertext`; file contents queued in the outbox go through here. */
  private async encryptBytes(value: Uint8Array): Promise<Uint8Array> {
    if (!this.encryptionKey) {
      return value;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.encryptionKey, plain));
    const stored = new Uint8Array(iv.byteLength + encrypted.byteLength);
    stored.set(iv);
    stored.set(encrypted, iv.byteLength);
    return stored;
  }

  /** Returns undefined when the stored bytes were written with a different key. */
  private async decryptBytes(value: Uint8Array): Promise<Uint8Array | undefined> {
    if (!this.encryptionKey) {
      return value;
    }
    const iv = value.slice(0, 12);
    const encrypted = value.buffer.slice(value.byteOffset + 12, value.byteOffset + value.byteLength) as ArrayBuffer;
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await this.encryptionKey, encrypted));
    } catch {
      return undefined;
    }
  }

  /** Returns undefined when the stored value was written with a different key. */
  private async decrypt(value: string): Promise<string | undefined> {
    if (!this.encryptionKey || !value.includes(".")) {
      return value;
    }
    const [ivValue, encryptedValue] = value.split(".");
    if (!ivValue || !encryptedValue) {
      return value;
    }
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: this.decode(ivValue) },
        await this.encryptionKey,
        this.decode(encryptedValue)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return undefined;
    }
  }

  private encode(value: Uint8Array): string {
    return btoa(String.fromCharCode(...value));
  }

  private decode(value: string): Uint8Array<ArrayBuffer> {
    const encoded = atob(value);
    const buffer = new ArrayBuffer(encoded.length);
    const result = new Uint8Array(buffer);
    for (let index = 0; index < encoded.length; index += 1) {
      result[index] = encoded.charCodeAt(index);
    }
    return result;
  }

  /** Every record in a single transaction, which is the whole point of writing them together. */
  private async writeAll(storeName: string, records: readonly unknown[]): Promise<void> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write was aborted"));
    });
  }

  private async request<Result>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<Result>
  ): Promise<Result> {
    // Whoever asked for encrypted storage is told here if it cannot exist, rather than finding out later on
    // the first record that happens to need decrypting, or never, as a rejection nobody picked up.
    await this.encryptionKey;
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
}
