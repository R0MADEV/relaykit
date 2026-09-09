import type {
  Conversation,
  ConversationId,
  Message,
  MessageId,
  MessagingStorage,
  OutboxOperation
} from "@relaykit/core";

const conversationStore = "conversations";
const messageStore = "messages";
const outboxStore = "outbox";

export interface IndexedDbStorageOptions {
  readonly encryptionSecret?: string;
}

export class IndexedDbStorage implements MessagingStorage {
  private readonly database: Promise<IDBDatabase>;
  private readonly encryptionKey: Promise<CryptoKey> | undefined;

  constructor(databaseName = "relaykit", options: IndexedDbStorageOptions = {}) {
    this.database = this.open(databaseName);
    this.encryptionKey = options.encryptionSecret
      ? this.createKey(options.encryptionSecret)
      : undefined;
  }

  async deleteMessage(messageId: MessageId): Promise<void> {
    await this.request(messageStore, "readwrite", store => store.delete(messageId));
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

  async getMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    const messages = await this.request<Message[]>(messageStore, "readonly", store => store.getAll());
    const result: Message[] = [];
    for (const message of messages) {
      if (message.conversationId !== conversationId) continue;
      const restored = await this.restoreMessage(message);
      if (restored) result.push(restored);
    }
    return result;
  }

  async getPendingMessages(): Promise<readonly Message[]> {
    const messages = await this.request<Message[]>(messageStore, "readonly", store => store.getAll());
    const result: Message[] = [];
    for (const message of messages) {
      const isPending = message.status === "queued" || message.status === "failed";
      if (!isPending) continue;
      const restored = await this.restoreMessage(message);
      if (restored) result.push(restored);
    }
    return result;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const storedConversation = {
      ...conversation,
      ...(conversation.lastMessage
        ? { lastMessage: await this.prepareMessage(conversation.lastMessage) }
        : {})
    };
    await this.request(conversationStore, "readwrite", store => store.put(storedConversation));
  }

  async saveMessage(message: Message): Promise<void> {
    const storedMessage = await this.prepareMessage(message);
    await this.request(messageStore, "readwrite", store => store.put(storedMessage));
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    await this.request(conversationStore, "readwrite", store => store.delete(conversationId));
    const messages = await this.request<Message[]>(messageStore, "readonly", store => store.getAll());
    const stale = messages.filter(message => message.conversationId === conversationId);
    await Promise.all(stale.map(message => this.request(messageStore, "readwrite", store => store.delete(message.id))));
  }

  async clear(): Promise<void> {
    await Promise.all([conversationStore, messageStore, outboxStore].map(name =>
      this.request(name, "readwrite", store => store.clear())
    ));
  }

  private open(databaseName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2);
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

  private async request<Result>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<Result>
  ): Promise<Result> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
}
