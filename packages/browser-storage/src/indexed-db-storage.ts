import { RelayKitError } from "@relaykit/core";
import { LockedAway } from "./locked-away.js";
import type {
  GeoLocation,
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
  /** A secret that is already random: a device secret, a token. One digest is enough for those. */
  readonly encryptionSecret?: string;
  /**
   * Something a person typed, which is guessable and needs a slow derivation.
   *
   * Given instead of `encryptionSecret`. The salt is not secret and is kept beside the data; without one the
   * same passphrase would make the same key on every device, and one precomputation would open all of them.
   */
  readonly passphrase?: { readonly typed: string; readonly salt: string };
}

export class IndexedDbStorage implements MessagingStorage {
  private readonly database: Promise<IDBDatabase>;
  /** What makes a record unreadable to anything but this origin with this secret. */
  private readonly locked = new LockedAway();

  constructor(databaseName = "relaykit", options: IndexedDbStorageOptions = {}) {
    this.database = this.open(databaseName);
    if (options.passphrase) {
      this.locked.lockWithPassphrase(options.passphrase.typed, options.passphrase.salt);
    } else {
      this.locked.lockWith(options.encryptionSecret);
    }
  }

  /**
   * Writes everything again under a new secret. Without this, changing the secret leaves every record
   * unreadable and the whole local copy is thrown away and fetched from the server again.
   *
   * What cannot be read with the current secret is dropped: it was already unreachable, and stopping halfway
   * would leave the store half in one secret and half in the other.
   */
  /**
   * Locks everything away again under a different key.
   *
   * Everything is read and re-sealed in memory first, and only then written — all of it inside one
   * transaction, so the database either has the whole thing under the new key or is exactly as it was. The
   * version that cleared first and rewrote record by record could be interrupted by a quota, a closed tab or
   * a killed browser, and leave a half rebuilt database. For messages that is annoying; for an outbox that
   * has not reached a homeserver yet it is losing what somebody wrote.
   */
  async rekey(newSecret: string): Promise<void> {
    const readable = await this.everythingReadable();
    this.locked.lockWith(newSecret);
    const sealed = await this.everythingSealed(readable);
    await this.replaceEverything(sealed);
  }

  /** Read and opened with the key that is still in force. Anything unreadable is already lost and is left. */
  private async everythingReadable(): Promise<WhatIsHeld> {
    const conversations = await this.getConversations();
    const profiles = await this.getProfiles();
    const messages: Message[] = [];
    for (const stored of await this.request<Message[]>(messageStore, "readonly", each => each.getAll())) {
      const restored = await this.restoreMessage(stored);
      if (restored) messages.push(restored);
    }
    const operations: OutboxOperation[] = [];
    for (const stored of await this.request<OutboxOperation[]>(outboxStore, "readonly", each =>
      each.getAll()
    )) {
      const restored = await this.restoreOperation(stored);
      if (restored) operations.push(restored);
    }
    const drafts: { id: string; text: string }[] = [];
    for (const stored of await this.request<{ id: string; text: string }[]>(draftStore, "readonly", each =>
      each.getAll()
    )) {
      const text = await this.locked.decrypt(stored.text);
      if (text !== undefined) drafts.push({ id: stored.id, text });
    }
    return { conversations, profiles, messages, operations, drafts };
  }

  /** Sealed under whatever key is in force now, all of it, before a single record is written. */
  private async everythingSealed(held: WhatIsHeld): Promise<WhatIsHeld> {
    const conversations: Conversation[] = [];
    for (const conversation of held.conversations)
      conversations.push(await this.prepareConversation(conversation));
    const messages: Message[] = [];
    for (const message of held.messages) messages.push(await this.prepareMessage(message));
    const operations: OutboxOperation[] = [];
    for (const operation of held.operations) operations.push(await this.sealOperation(operation));
    const drafts: { id: string; text: string }[] = [];
    for (const draft of held.drafts) {
      drafts.push({ id: draft.id, text: await this.locked.encrypt(draft.text) });
    }
    return { conversations, profiles: held.profiles, messages, operations, drafts };
  }

  /** One transaction over every store: either all of it is there under the new key, or none of it moved. */
  private async replaceEverything(sealed: WhatIsHeld): Promise<void> {
    const database = await this.database;
    const stores = [conversationStore, messageStore, outboxStore, draftStore, profileStore];
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(stores, "readwrite");
      for (const name of stores) transaction.objectStore(name).clear();
      for (const conversation of sealed.conversations) {
        transaction.objectStore(conversationStore).put(conversation);
      }
      for (const message of sealed.messages) transaction.objectStore(messageStore).put(message);
      for (const operation of sealed.operations) transaction.objectStore(outboxStore).put(operation);
      for (const draft of sealed.drafts) transaction.objectStore(draftStore).put(draft);
      // Not locked away, and kept on purpose rather than by accident: it used to be cleared and never
      // written back, so a rekey that worked perfectly threw the profile cache away.
      for (const profile of sealed.profiles) transaction.objectStore(profileStore).put(profile);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("The rekey was aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("The rekey failed"));
    });
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

  /**
   * Something still waiting to go out, which is the most private thing this holds: it is somewhere else only
   * if it was sent, and it has not been.
   */
  async saveOutboxOperation(operation: OutboxOperation): Promise<void> {
    const sealed = await this.sealOperation(operation);
    await this.request(outboxStore, "readwrite", store => store.put(sealed));
  }

  private async sealOperation(operation: OutboxOperation): Promise<OutboxOperation> {
    const { attachment, body, formattedBody, ...rest } = operation;
    return {
      ...rest,
      body: await this.locked.encrypt(JSON.stringify({ body, formattedBody })),
      ...(attachment ? { attachment: await this.lockedAway(attachment) } : {})
    };
  }

  private async restoreOperation(operation: OutboxOperation): Promise<OutboxOperation | undefined> {
    const { attachment } = operation;
    const thumbnail = attachment?.thumbnail;
    const opened = await this.locked.decrypt(operation.body);
    const said = opened === undefined ? undefined : whatWasSaid(opened);
    const body = said?.body;
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

  /**
   * Lets go of the connection.
   *
   * A database that is still open from somewhere refuses to be deleted and refuses to be upgraded; it just
   * blocks, silently, until whoever holds it lets go. On a browser where people sign in and out of different
   * accounts, that is the difference between the last person's copy going away and sitting there for ever.
   */
  async close(): Promise<void> {
    await this.database.then(database => database.close()).catch(() => undefined);
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
      // Another tab wanting a newer version has to wait for this one to let go, and waits silently for as
      // long as this page is open. Letting go when asked is what makes an upgrade possible at all.
      request.onblocked = () =>
        reject(new RelayKitError("STORAGE_ERROR", "Another tab is holding the local copy open"));
      request.onsuccess = () => {
        const opened = request.result;
        opened.onversionchange = () => opened.close();
        resolve(opened);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    });
  }

  /**
   * A message on its way to disk, with everything a person said locked away together.
   *
   * Together rather than field by field, and that is the point: what somebody typed reaches disk as text, as
   * the HTML that says the same thing in bold, and as the place they sent it from. Locking one of those and
   * leaving the others is locking nothing. An envelope also means the next private field somebody adds to a
   * message is inside it by default, instead of quietly not being.
   *
   * What stays legible is what the database needs to find things with: who, where, when, and in what state.
   */
  private async prepareMessage(message: Message): Promise<Message> {
    const { body, formattedBody, location, ...metadata } = message;
    const sealed = await this.locked.encrypt(JSON.stringify({ body, formattedBody, location }));
    return { ...metadata, body: sealed };
  }

  private async restoreMessage(message: Message): Promise<Message | undefined> {
    const opened = await this.locked.decrypt(message.body);
    if (opened === undefined) return undefined;
    const said = whatWasSaid(opened);
    if (!said) return undefined;
    return {
      ...message,
      body: said.body,
      ...(said.formattedBody === undefined ? {} : { formattedBody: said.formattedBody }),
      ...(said.location === undefined ? {} : { location: said.location })
    };
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
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      if (mode === "readonly") {
        request.onsuccess = () => resolve(request.result);
        return;
      }
      // A write is done when the transaction commits, not when the request succeeds. IndexedDB lets a
      // request succeed and then aborts the transaction it was in, and what is in the outbox may be the
      // only copy of something that never reached a homeserver. Reads may answer as soon as they have it.
      let answered: Result;
      request.onsuccess = () => {
        answered = request.result;
      };
      transaction.oncomplete = () => resolve(answered);
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
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

/**
 * What somebody actually said, read back out of the envelope it was locked away in.
 *
 * Nothing is assumed about the shape: what comes out was written by an older version of this library, or by
 * a browser that half wrote it, and a record that cannot be read is dropped the same way an unreadable one
 * is. `body` is the one part that has to be there for the record to mean anything.
 */
function whatWasSaid(opened: string): PrivateParts | undefined {
  // A copy written before this envelope existed holds the text on its own. Those are read as what they are
  // rather than dropped: somebody who updates their application should not lose the conversations they
  // already had on that device, and dropping them would be silent.
  const parsed = parsedOrNothing(opened);
  if (parsed === undefined) return { body: opened };
  const body = fieldOf(parsed, "body");
  if (typeof body !== "string") return { body: opened };
  const formattedBody = fieldOf(parsed, "formattedBody");
  const location = fieldOf(parsed, "location");
  return {
    body,
    ...(typeof formattedBody === "string" ? { formattedBody } : {}),
    ...(isAPlace(location) ? { location } : {})
  };
}

/** What was in there, when it was an envelope at all. Nothing when it was written before there were any. */
function parsedOrNothing(opened: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(opened);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Everything about a message that is the person speaking rather than the database filing. */
interface PrivateParts {
  readonly body: string;
  readonly formattedBody?: string;
  readonly location?: GeoLocation;
}

function isAPlace(value: unknown): value is GeoLocation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof fieldOf(value, "latitude") === "number" &&
    typeof fieldOf(value, "longitude") === "number"
  );
}

/** One field of something whose shape is not known, read without pretending to know it. */
function fieldOf(from: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(from, name)?.value;
}

/** Everything this database holds that a change of key has to carry across. */
interface WhatIsHeld {
  readonly conversations: readonly Conversation[];
  readonly profiles: readonly User[];
  readonly messages: readonly Message[];
  readonly operations: readonly OutboxOperation[];
  readonly drafts: readonly { id: string; text: string }[];
}
