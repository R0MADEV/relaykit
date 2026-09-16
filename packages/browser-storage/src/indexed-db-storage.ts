import { RelayKitError } from "@relaykit/core";
import { LockedAway, type HowItWasDerived } from "./locked-away.js";
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
/** How this copy is locked, unencrypted, because it is what says how to open the rest. */
const metadataStore = "metadata";
const howItIsLockedKey = "how-it-is-locked";

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
  /** Not readonly on purpose: a change of key replaces it, and only once the database has taken it. */
  private locked = new LockedAway();

  constructor(
    private readonly databaseName = "relaykit",
    options: IndexedDbStorageOptions = {}
  ) {
    this.database = this.open(databaseName);
    if (options.passphrase) {
      this.locked.lockWithPassphrase(options.passphrase.typed, options.passphrase.salt);
    } else {
      this.locked.lockWith(options.encryptionSecret);
    }
    // Written down the first time this copy is opened, not only when the key changes: a copy made today has
    // to say how it was locked, or a version that raises the work factor cannot open it and cannot say why.
    void this.writeDownHowItIsLocked(this.locked).catch(() => undefined);
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
  async rekey(
    to: string | StorageKeyMaterial,
    how: { readonly dropUnreadable?: boolean } = {}
  ): Promise<void> {
    const next = new LockedAway();
    lockItWith(next, to);
    await next.ready();
    // Read with the key in force, and every record has to open. A wrong passphrase looks exactly like
    // unreadable data, and rewriting the database with only what opened would throw away what is still
    // perfectly there — for an outbox that never reached a homeserver, that is the only copy.
    const readable = await this.everythingReadable({ strict: how.dropUnreadable !== true });
    const sealed = await this.everythingSealed(readable, next);
    await this.replaceEverything(sealed);
    await this.writeDownHowItIsLocked(next);
    // Only now. Swapping first leaves this instance holding a key the database is not under whenever
    // anything after it fails, and then everything looks unreadable that is not.
    this.locked = next;
  }

  /** How the key in force was made, as it was written down beside the data. */
  async howItIsLocked(): Promise<HowItWasDerived> {
    const kept = await this.request<{ id: string; how: HowItWasDerived } | undefined>(
      metadataStore,
      "readonly",
      store => store.get(howItIsLockedKey)
    );
    return kept?.how ?? this.locked.howItWasDerived();
  }

  /**
   * Written beside the data, unencrypted, because it is what says how to open it.
   *
   * Without this, raising the work factor in two years — or moving to another algorithm — would lock people
   * out of copies made today, and there would be no way to tell that is what happened.
   */
  private async writeDownHowItIsLocked(locked: LockedAway): Promise<void> {
    await this.request(metadataStore, "readwrite", store =>
      store.put({ id: howItIsLockedKey, how: locked.howItWasDerived() })
    );
  }

  /** Read and opened with the key that is still in force. Anything unreadable is already lost and is left. */
  private async everythingReadable(how: { readonly strict: boolean }): Promise<WhatIsHeld> {
    const conversations = await this.getConversations();
    const profiles = await this.getProfiles();
    const messages: Message[] = [];
    for (const stored of await this.request<StoredMessage[]>(messageStore, "readonly", each =>
      each.getAll()
    )) {
      const restored = await this.restoreMessage(stored);
      if (!restored && how.strict) throw unreadable();
      if (restored) messages.push(restored);
    }
    const operations: OutboxOperation[] = [];
    for (const stored of await this.request<StoredSend[]>(outboxStore, "readonly", each => each.getAll())) {
      const restored = await this.restoreOperation(stored);
      if (!restored && how.strict) throw unreadable();
      if (restored) operations.push(restored);
    }
    const drafts: { id: string; text: string }[] = [];
    for (const stored of await this.request<{ id: string; text: string }[]>(draftStore, "readonly", each =>
      each.getAll()
    )) {
      const text = await this.locked.decrypt(stored.text);
      if (text === undefined && how.strict) throw unreadable();
      if (text !== undefined) drafts.push({ id: stored.id, text });
    }
    return { conversations, profiles, messages, operations, drafts };
  }

  /** Sealed under whatever key is in force now, all of it, before a single record is written. */
  private async everythingSealed(held: WhatIsHeld, under: LockedAway): Promise<WhatIsSealed> {
    const conversations: StoredConversation[] = [];
    for (const conversation of held.conversations)
      conversations.push(await this.prepareConversation(conversation, under));
    const messages: StoredMessage[] = [];
    for (const message of held.messages) messages.push(await this.prepareMessage(message, under));
    const operations: StoredSend[] = [];
    for (const operation of held.operations) operations.push(await this.sealOperation(operation, under));
    const drafts: { id: string; text: string }[] = [];
    for (const draft of held.drafts) {
      drafts.push({ id: draft.id, text: await under.encrypt(draft.text) });
    }
    return { conversations, profiles: held.profiles, messages, operations, drafts };
  }

  /** One transaction over every store: either all of it is there under the new key, or none of it moved. */
  private async replaceEverything(sealed: WhatIsSealed): Promise<void> {
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
    const operations = await this.request<StoredSend[]>(outboxStore, "readonly", store => store.getAll());
    const result: OutboxOperation[] = [];
    for (const operation of operations) {
      if (operation.nextAttemptAt > now) continue;
      const restored = await this.restoreOperation(operation);
      if (restored) result.push(restored);
    }
    return result;
  }

  async getOutboxOperation(operationId: string): Promise<OutboxOperation | undefined> {
    const operation = await this.request<StoredSend | undefined>(outboxStore, "readonly", store =>
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

  /** The same for something still waiting to go out, which the store finds by its id alone. */
  private async sealOperation(operation: OutboxOperation, under = this.locked): Promise<StoredSend> {
    const { id, status, nextAttemptAt, attachment, ...everythingElse } = operation;
    return {
      id,
      status,
      nextAttemptAt,
      sealed: await under.encrypt(intoAnEnvelope(everythingElse)),
      ...(attachment ? { attachment: await this.lockedAway(attachment, under) } : {})
    };
  }

  private async restoreOperation(operation: StoredSend): Promise<OutboxOperation | undefined> {
    const { attachment } = operation;
    const thumbnail = attachment?.thumbnail;
    const written = whereTheSealedPartIs(operation);
    if (written === undefined) return undefined;
    const opened = await this.locked.decrypt(written.sealed);
    if (opened === undefined) return undefined;
    const inside = outOfAnEnvelope(opened);
    if (written.fromBefore) {
      const before = written.fromBefore;
      const readable = { ...before, body: opened };
      return isWhatASendCarries(readable) ? { ...operation, ...readable } : undefined;
    }
    const data = attachment ? await this.locked.decryptBytes(attachment.data) : undefined;
    const thumbnailData = thumbnail ? await this.locked.decryptBytes(thumbnail.data) : undefined;
    // One whose file content cannot be read could never be sent, so it is dropped with the rest.
    const isUnreadable = !isWhatASendCarries(inside) || (attachment !== undefined && data === undefined);
    if (isUnreadable || !isWhatASendCarries(inside)) return undefined;
    const { id, status, nextAttemptAt } = operation;
    // Everything else comes back out of the envelope, so nothing added to the model later is written down
    // and then quietly dropped on the way back in — which is what happened to the formatting.
    return {
      id,
      status,
      nextAttemptAt,
      ...inside,
      ...(attachment && data ? { attachment: readBack(attachment, data, thumbnailData) } : {})
    };
  }

  /** A file on its way out, put away: its own bytes locked, and the picture standing in for it locked too. */
  private async lockedAway(attachment: FileInput, under = this.locked): Promise<FileInput> {
    const locked = { ...attachment, data: await under.encryptBytes(attachment.data) };
    const { thumbnail } = attachment;
    if (!thumbnail) return locked;
    return { ...locked, thumbnail: { ...thumbnail, data: await this.locked.encryptBytes(thumbnail.data) } };
  }

  async getMessage(messageId: MessageId): Promise<Message | undefined> {
    const message = await this.request<StoredMessage | undefined>(messageStore, "readonly", store =>
      store.get(messageId)
    );
    return message ? this.restoreMessage(message) : undefined;
  }

  async getConversations(): Promise<readonly Conversation[]> {
    const conversations = await this.request<StoredConversation[]>(conversationStore, "readonly", store =>
      store.getAll()
    );
    const result: Conversation[] = [];
    for (const conversation of conversations) {
      // The conversation itself is readable even when its preview was written with another key.
      const { lastMessage: sealed, ...withoutPreview } = conversation;
      if (!sealed) {
        result.push(withoutPreview);
        continue;
      }
      const lastMessage = await this.restoreMessage(sealed);
      result.push(lastMessage ? { ...withoutPreview, lastMessage } : withoutPreview);
    }
    return result;
  }

  /** Asking the index instead of reading every message there has ever been, which is what a busy account has. */
  async getMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    const messages = await this.request<StoredMessage[]>(messageStore, "readonly", store =>
      store.index("conversationId").getAll(conversationId)
    );
    return this.restoreAll(messages);
  }

  async getPendingMessages(): Promise<readonly Message[]> {
    const queued = await this.request<StoredMessage[]>(messageStore, "readonly", store =>
      store.index("status").getAll("queued")
    );
    const failed = await this.request<StoredMessage[]>(messageStore, "readonly", store =>
      store.index("status").getAll("failed")
    );
    return this.restoreAll([...queued, ...failed]);
  }

  private async restoreAll(messages: readonly StoredMessage[]): Promise<readonly Message[]> {
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

  private async prepareConversation(
    conversation: Conversation,
    under = this.locked
  ): Promise<StoredConversation> {
    // The preview goes in sealed like any other message; the rest of the conversation is what the list is
    // painted from without opening anything, so it stays out here.
    const { lastMessage, ...rest } = conversation;
    return {
      ...rest,
      ...(lastMessage ? { lastMessage: await this.prepareMessage(lastMessage, under) } : {})
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
    const messages = await this.request<StoredMessage[]>(messageStore, "readonly", store => store.getAll());
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

  /**
   * Takes the copy away, rather than emptying it.
   *
   * What signing out wants: an emptied database is still a database, sitting in the browser's storage with
   * its stores and its version, next to the ones the session did take with it. A copy nobody is signed in to
   * is not a cache of anything.
   */
  async destroy(): Promise<void> {
    await this.close();
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(this.databaseName);
      // Whatever it answers. A browser that will not let go of a database is not worth failing over, and
      // `onblocked` means another tab still has it open — which will delete it when that tab lets go.
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  private open(databaseName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 6);
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
        if (!database.objectStoreNames.contains(metadataStore)) {
          database.createObjectStore(metadataStore, { keyPath: "id" });
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
   * A message on its way to disk, with everything about it locked away except what the database finds it by.
   *
   * Named the other way round on purpose. Listing what is private and letting the rest through means the
   * next private field somebody adds to the model — a caption, a title, whatever — reaches disk in the clear
   * until somebody remembers to come back here, and nobody would. Listing what may stay out means the
   * unknown is private, which is the only safe default for a thing that carries what people say.
   *
   * What stays out is exactly what the store looks things up by: the key, the conversation it indexes on,
   * and the status it filters pending sends by. Everything else, known or not, goes inside.
   */
  private async prepareMessage(message: Message, under = this.locked): Promise<StoredMessage> {
    const { id, conversationId, status, ...everythingElse } = message;
    return { id, conversationId, status, sealed: await under.encrypt(intoAnEnvelope(everythingElse)) };
  }

  private async restoreMessage(stored: StoredMessage): Promise<Message | undefined> {
    // A copy written before messages were kept this way holds everything beside a `body` that was sealed on
    // its own. Read as what it is, because an update that silently emptied somebody's history would be the
    // worst thing this file could do.
    const written = whereTheSealedPartIs(stored);
    if (written === undefined) return undefined;
    const opened = await this.locked.decrypt(written.sealed);
    if (opened === undefined) return undefined;
    const { id, conversationId, status } = stored;
    const inside = outOfAnEnvelope(opened);
    if (written.fromBefore) {
      const asItWas = { ...written.fromBefore, body: opened };
      return isWhatAMessageCarries(asItWas) ? { id, conversationId, status, ...asItWas } : undefined;
    }
    if (!isWhatAMessageCarries(inside)) return undefined;
    // Spread rather than rebuilt field by field: anything added to a message later survives the round trip
    // instead of being written down and then quietly dropped on the way back, which is what happened to the
    // formatting of everything waiting in the outbox.
    return { id, conversationId, status, ...inside };
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
 * Everything private, written as one thing with a mark saying what it is.
 *
 * The mark matters: without it a message somebody typed that happens to look like `{"body":"hola"}` is read
 * as this library's own bookkeeping, and comes back as `hola`. Nothing anybody types starts with this.
 */
function intoAnEnvelope(parts: object): string {
  return JSON.stringify({ [thisIsAnEnvelope]: 1, ...parts });
}

/**
 * What was inside, or nothing when it was never an envelope.
 *
 * Nothing is assumed about the shape: what comes out may have been written by an older version of this
 * library, or by a browser that stopped half way, or be a sentence somebody typed.
 */
function outOfAnEnvelope(opened: string): Record<string, unknown> | undefined {
  const parsed = parsedOrNothing(opened);
  if (parsed === undefined) return undefined;
  if (fieldOf(parsed, thisIsAnEnvelope) !== 1) return undefined;
  const { [thisIsAnEnvelope]: mark, ...inside } = parsed;
  return typeof fieldOf(inside, "body") === "string" ? inside : undefined;
}

/**
 * A message as this database holds it, which is not the shape an application sees.
 *
 * Only what the store finds things by stays out here — the key, the conversation it indexes on, and the
 * status it filters pending sends by. Everything else about the message is inside `sealed`, known or not.
 */
interface StoredMessage {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly status: Message["status"];
  readonly sealed: string;
}

/**
 * What a copy is locked with, said in a way that cannot be mistaken.
 *
 * A passphrase somebody typed and a secret that is already random are different problems and must never be
 * treated as one: naming which is which here means a human password cannot be put through the fast path by
 * somebody passing the wrong string to the wrong parameter.
 */
export type StorageKeyMaterial =
  | { readonly kind: "secret"; readonly value: string }
  | { readonly kind: "passphrase"; readonly value: string; readonly salt: string };

/** The one place either kind of key material is turned into a key. */
function lockItWith(locked: LockedAway, material: string | StorageKeyMaterial): void {
  // A bare string is the old way of saying "a random secret", and is kept working.
  if (typeof material === "string") return locked.lockWith(material);
  if (material.kind === "passphrase") return locked.lockWithPassphrase(material.value, material.salt);
  locked.lockWith(material.value);
}

/**
 * Where the sealed part of a record is, whichever way it was written.
 *
 * Records made before this shape existed keep everything beside a `body` that was sealed alone; ones made
 * since keep only what the store indexes on, and everything else inside `sealed`. Both are read, because an
 * update that quietly emptied a person's history is not an update anybody should ship.
 */
function whereTheSealedPartIs(
  stored: object
): { readonly sealed: string; readonly fromBefore?: Record<string, unknown> } | undefined {
  const sealed = fieldOf(stored, "sealed");
  if (typeof sealed === "string") return { sealed };
  const body = fieldOf(stored, "body");
  if (typeof body !== "string") return undefined;
  const beside: Record<string, unknown> = { ...stored };
  delete beside.body;
  return { sealed: body, fromBefore: beside };
}

/** Said when a change of key finds something it cannot open, which is almost always the wrong key. */
function unreadable(): RelayKitError {
  return new RelayKitError(
    "STORAGE_ERROR",
    "Part of the local copy could not be read with the key in force, so nothing was changed"
  );
}

/** A conversation as this database holds it: as it is, with its preview sealed like any other message. */
type StoredConversation = Omit<Conversation, "lastMessage"> & { readonly lastMessage?: StoredMessage };

/** The same for something waiting to go out: found by its id, and asked about by when it may be tried. */
interface StoredSend {
  readonly id: string;
  readonly status: OutboxOperation["status"];
  readonly nextAttemptAt: number;
  readonly sealed: string;
  readonly attachment?: FileInput;
}

/** What was in there, when it was JSON at all. Nothing when it was written before there were envelopes. */
function parsedOrNothing(opened: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(opened);
    return typeof parsed === "object" && parsed !== null ? { ...parsed } : undefined;
  } catch {
    return undefined;
  }
}

/** The mark, and the version of what is beside it. Namespaced so nothing in a message can collide. */
const thisIsAnEnvelope = "__relaykit";

/**
 * Whether what came out of an envelope is the rest of a message.
 *
 * The three the store keeps outside are not in here; everything else is, whatever it is. What is checked is
 * only what a message cannot be without — a record missing those was written by something that is not this,
 * or written half way, and is dropped rather than turned into a message with holes in it.
 */
function isWhatAMessageCarries(
  inside: Record<string, unknown> | undefined
): inside is Omit<Message, "id" | "conversationId" | "status"> {
  if (inside === undefined) return false;
  return (
    typeof inside.body === "string" &&
    typeof inside.senderId === "string" &&
    typeof inside.createdAt === "number"
  );
}

/** The same for something waiting to go out, which cannot be sent without these. */
function isWhatASendCarries(
  inside: Record<string, unknown> | undefined
): inside is Omit<OutboxOperation, "id" | "status" | "nextAttemptAt" | "attachment"> {
  if (inside === undefined) return false;
  return (
    typeof inside.body === "string" &&
    typeof inside.conversationId === "string" &&
    typeof inside.transactionId === "string"
  );
}

/** One field of something whose shape is not known, read without pretending to know it. */
function fieldOf(from: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(from, name)?.value;
}

/** Everything this database holds, opened: what a change of key has to carry across. */
interface WhatIsHeld {
  readonly conversations: readonly Conversation[];
  readonly profiles: readonly User[];
  readonly messages: readonly Message[];
  readonly operations: readonly OutboxOperation[];
  readonly drafts: readonly { id: string; text: string }[];
}

/** The same, sealed under whatever key is in force, ready to be written. */
interface WhatIsSealed {
  readonly conversations: readonly StoredConversation[];
  readonly profiles: readonly User[];
  readonly messages: readonly StoredMessage[];
  readonly operations: readonly StoredSend[];
  readonly drafts: readonly { id: string; text: string }[];
}
