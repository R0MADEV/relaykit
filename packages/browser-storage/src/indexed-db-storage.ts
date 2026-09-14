import { LockedAway } from "./locked-away.js";
import type {
  FileInput,
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
  /** What makes a record unreadable to anything but this origin with this secret. */
  private readonly locked = new LockedAway();

  constructor(databaseName = "relaykit", options: IndexedDbStorageOptions = {}) {
    this.database = this.open(databaseName);
    this.locked.lockWith(options.encryptionSecret);
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
    const operations = await this.request<OutboxOperation[]>(outboxStore, "readonly", store =>
      store.getAll()
    );
    const drafts = await this.request<{ id: string; text: string }[]>(draftStore, "readonly", store =>
      store.getAll()
    );

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
      const text = await this.locked.decrypt(stored.text);
      if (text !== undefined) readableDrafts.push({ id: stored.id, text });
    }

    this.locked.lockWith(newSecret);

    await Promise.all(
      [conversationStore, messageStore, outboxStore, draftStore, profileStore].map(name =>
        this.request(name, "readwrite", store => store.clear())
      )
    );
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
    return stored ? this.locked.decrypt(stored.text) : undefined;
  }

  async saveDraft(conversationId: ConversationId, text: string | undefined): Promise<void> {
    if (text === undefined) {
      await this.request(draftStore, "readwrite", store => store.delete(conversationId));
      return;
    }
    const encrypted = await this.locked.encrypt(text);
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
    const operations = await this.request<OutboxOperation[]>(outboxStore, "readonly", store =>
      store.getAll()
    );
    const result: OutboxOperation[] = [];
    for (const operation of operations) {
      if (operation.nextAttemptAt > now) continue;
      const restored = await this.restoreOperation(operation);
      if (restored) result.push(restored);
    }
    return result;
  }

  async getOutboxOperation(operationId: string): Promise<OutboxOperation | undefined> {
    const operation = await this.request<OutboxOperation | undefined>(outboxStore, "readonly", store =>
      store.get(operationId)
    );
    return operation ? this.restoreOperation(operation) : undefined;
  }

  async saveOutboxOperation(operation: OutboxOperation): Promise<void> {
    const { attachment } = operation;
    const storedOperation: OutboxOperation = {
      ...operation,
      body: await this.locked.encrypt(operation.body),
      ...(attachment ? { attachment: await this.lockedAway(attachment) } : {})
    };
    await this.request(outboxStore, "readwrite", store => store.put(storedOperation));
  }

  private async restoreOperation(operation: OutboxOperation): Promise<OutboxOperation | undefined> {
    const { attachment } = operation;
    const thumbnail = attachment?.thumbnail;
    const body = await this.locked.decrypt(operation.body);
    const data = attachment ? await this.locked.decryptBytes(attachment.data) : undefined;
    const thumbnailData = thumbnail ? await this.locked.decryptBytes(thumbnail.data) : undefined;
    // An operation whose file content cannot be read could never be sent, so it is dropped with the rest.
    const isUnreadable = body === undefined || (attachment !== undefined && data === undefined);
    if (isUnreadable) {
      return undefined;
    }
    return {
      ...operation,
      body,
      ...(attachment && data ? { attachment: readBack(attachment, data, thumbnailData) } : {})
    };
  }

  /** A file on its way out, put away: its own bytes locked, and the picture standing in for it locked too. */
  private async lockedAway(attachment: FileInput): Promise<FileInput> {
    const locked = { ...attachment, data: await this.locked.encryptBytes(attachment.data) };
    const { thumbnail } = attachment;
    if (!thumbnail) return locked;
    return { ...locked, thumbnail: { ...thumbnail, data: await this.locked.encryptBytes(thumbnail.data) } };
  }

  async getMessage(messageId: MessageId): Promise<Message | undefined> {
    const message = await this.request<Message | undefined>(messageStore, "readonly", store =>
      store.get(messageId)
    );
    return message ? this.restoreMessage(message) : undefined;
  }

  async getConversations(): Promise<readonly Conversation[]> {
    const conversations = await this.request<Conversation[]>(conversationStore, "readonly", store =>
      store.getAll()
    );
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
    const prepared = await Promise.all(
      conversations.map(conversation => this.prepareConversation(conversation))
    );
    await this.writeAll(conversationStore, prepared);
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    await this.request(conversationStore, "readwrite", store => store.delete(conversationId));
    const messages = await this.request<Message[]>(messageStore, "readonly", store => store.getAll());
    const stale = messages.filter(message => message.conversationId === conversationId);
    await Promise.all(
      stale.map(message => this.request(messageStore, "readwrite", store => store.delete(message.id)))
    );
  }

  async clear(): Promise<void> {
    await Promise.all(
      [conversationStore, messageStore, outboxStore, draftStore, profileStore].map(name =>
        this.request(name, "readwrite", store => store.clear())
      )
    );
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
    return { ...message, body: await this.locked.encrypt(message.body) };
  }

  private async restoreMessage(message: Message): Promise<Message | undefined> {
    const body = await this.locked.decrypt(message.body);
    return body === undefined ? undefined : { ...message, body };
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
    await this.locked.ready();
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
}

/**
 * These bytes in a buffer of their own.
 *
 * A typed array may sit on something shared, and what encrypts will not take one that might be — so it is
 * copied rather than sliced off what is behind it. Slicing copied too; this one says why, and is an
 * ArrayBuffer because it was made as one rather than asserted to be.
 */

/** The same file with what was read back put in place of what was stored. */
function readBack(attachment: FileInput, data: Uint8Array, thumbnailData: Uint8Array | undefined): FileInput {
  const read = { ...attachment, data };
  const { thumbnail } = attachment;
  if (!thumbnail || !thumbnailData) return read;
  return { ...read, thumbnail: { ...thumbnail, data: thumbnailData } };
}
