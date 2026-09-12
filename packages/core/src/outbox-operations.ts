import { SdkError } from "./errors.js";
import type { RecentIds } from "./recent-ids.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type {
  ConversationId,
  FileInput,
  GeoLocation,
  VoiceInfo,
  Message,
  MessageId,
  OutboxOperation,
  SendFileOptions,
  SendMessageOptions,
  Session
} from "./models.js";

export interface OutboxOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly getSession: () => Session | undefined;
  readonly assertStarted: () => void;
  readonly emitUpdated: (message: Message) => void;
  readonly emitError: (error: unknown) => void;
}

const maxBackoffMs = 60000;
const maxAutomaticAttempts = 8;

export class OutboxOperations {
  private readonly draftsAlreadyCleared = new Set<ConversationId>();

  private readonly inFlight = new Map<MessageId, Promise<Message>>();
  /** File contents for sends started in this process; persisted operations carry them across restarts. */
  private readonly pendingFiles = new Map<MessageId, FileInput>();
  private readonly progressHandlers = new Map<MessageId, (fraction: number) => void>();
  private readonly scheduledRetries = new Map<MessageId, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly context: OutboxOperationsContext,
    private readonly receivedMessageIds: RecentIds
  ) {}

  async send(conversationId: ConversationId, body: string, options: SendMessageOptions = {}): Promise<Message> {
    this.context.assertStarted();
    if (!body.trim()) {
      throw new SdkError("INVALID_INPUT", "Message body cannot be empty");
    }
    if (options.replyTo !== undefined && !options.replyTo.trim()) {
      throw new SdkError("INVALID_INPUT", "The message being replied to must be identified");
    }
    if (options.threadId !== undefined && !options.threadId.trim()) {
      throw new SdkError("INVALID_INPUT", "The message the thread hangs from must be identified");
    }
    if (options.formattedBody !== undefined && !options.formattedBody.trim()) {
      throw new SdkError("INVALID_INPUT", "Formatted text cannot be empty");
    }
    if ((options.mentions?.userIds ?? []).some(userId => !userId.trim())) {
      throw new SdkError("INVALID_INPUT", "A mention must name somebody");
    }
    const base = this.createLocalMessage(conversationId, body);
    const localMessage: Message = {
      ...base,
      ...(options.replyTo ? { replyToId: options.replyTo } : {}),
      ...(options.threadId ? { threadId: options.threadId } : {}),
      ...(options.formattedBody ? { formattedBody: options.formattedBody } : {}),
      ...(options.mentions ? { mentions: options.mentions } : {}),
      ...(options.kind ? { kind: options.kind } : {})
    };
    await this.saveOperation(localMessage);
    await this.saveAndEmit(localMessage);
    await this.clearDraft(conversationId);
    return this.deliver(localMessage);
  }

  /** A place on the map, which arrives as a place and not as a line of coordinates. */
  async sendLocation(conversationId: ConversationId, location: GeoLocation): Promise<Message> {
    this.context.assertStarted();
    if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90) {
      throw new SdkError("INVALID_INPUT", "The latitude must be between -90 and 90");
    }
    if (!Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
      throw new SdkError("INVALID_INPUT", "The longitude must be between -180 and 180");
    }
    const described = location.description?.trim();
    const body = described && described.length > 0 ? described : `${location.latitude}, ${location.longitude}`;
    const localMessage: Message = {
      ...this.createLocalMessage(conversationId, body),
      location: { ...location, ...(described ? { description: described } : {}) }
    };
    await this.saveOperation(localMessage);
    await this.saveAndEmit(localMessage);
    return this.deliver(localMessage);
  }

  async sendVoice(conversationId: ConversationId, file: FileInput, voice: VoiceInfo): Promise<Message> {
    if (!Number.isFinite(voice.durationMs) || voice.durationMs <= 0) {
      throw new SdkError("INVALID_INPUT", "A voice note needs the length it lasts");
    }
    return this.sendFile(conversationId, { ...file, voice }, {});
  }

  /**
   * Una pegatina no es un adjunto: quien la recibe la pinta sola, sin nombre de fichero ni boton de descarga.
   * Viaja por la misma cola que los demas ficheros, porque tambien hay que subirla y tambien puede fallar.
   */
  sendSticker(conversationId: ConversationId, sticker: FileInput): Promise<Message> {
    return this.sendFile(conversationId, { ...sticker, sticker: true }, {});
  }

  async sendFile(conversationId: ConversationId, file: FileInput, options: SendFileOptions): Promise<Message> {
    this.context.assertStarted();
    validateFile(file);
    const localMessage = this.createLocalMessage(conversationId, file.name);
    const attachment = {
      id: localMessage.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.data.byteLength,
      ...(file.width !== undefined ? { width: file.width } : {}),
      ...(file.height !== undefined ? { height: file.height } : {}),
      ...(file.voice ? { voice: file.voice } : {}),
      ...(file.blurhash ? { blurhash: file.blurhash } : {}),
      source: ""
    };
    const localFileMessage: Message = { ...localMessage, attachment, ...(file.sticker ? { kind: "sticker" as const } : {}) };
    this.pendingFiles.set(localMessage.id, file);
    if (options.onProgress) this.progressHandlers.set(localMessage.id, options.onProgress);
    await this.saveOperation(localFileMessage, file);
    await this.saveAndEmit(localFileMessage);
    return this.deliver(localFileMessage);
  }

  private createLocalMessage(conversationId: ConversationId, body: string): Message {
    const session = this.context.getSession();
    if (!session) {
      throw new SdkError("INVALID_SESSION", "A session is required to send a message");
    }
    const transactionId = crypto.randomUUID();
    // Whatever comes back carrying this transaction id is our own echo, not somebody else writing.
    this.receivedMessageIds.add(transactionId);
    return {
      id: `local-${transactionId}`,
      transactionId,
      conversationId,
      senderId: session.userId,
      body,
      createdAt: Date.now(),
      status: "queued"
    };
  }

  async retry(messageId: MessageId): Promise<Message> {
    this.context.assertStarted();
    const message = await this.context.storage?.getMessage(messageId);
    if (!message) {
      throw new SdkError("MESSAGE_NOT_FOUND", "The message does not exist");
    }
    if (message.status === "sent") {
      return message;
    }
    return this.deliver(message);
  }

  async cancel(messageId: MessageId): Promise<Message> {
    this.context.assertStarted();
    const message = await this.context.storage?.getMessage(messageId);
    if (!message) {
      throw new SdkError("MESSAGE_NOT_FOUND", "The message does not exist");
    }
    const isBeingDelivered = message.status === "sent" || this.inFlight.has(message.id);
    if (isBeingDelivered) {
      throw new SdkError("INVALID_INPUT", "Only queued or failed messages can be cancelled");
    }
    await this.context.storage?.deleteOutboxOperation(message.id);
    await this.context.storage?.deleteMessage(message.id);
    const cancelled: Message = { ...message, status: "cancelled" };
    this.context.emitUpdated(cancelled);
    return cancelled;
  }

  /**
   * Everything still pending is tried again, without waiting for its backoff: the flush runs when the client
   * connects, and a connection coming back is exactly the news that the previous failure is over. Operations
   * that ran out of attempts stay out, because their next attempt is set beyond any reachable time.
   */
  async flush(): Promise<void> {
    const operations = await this.context.storage?.getReadyOutbox(Number.MAX_SAFE_INTEGER);
    if (!operations) {
      return;
    }
    const ordered = [...operations].sort((left, right) => left.createdAt - right.createdAt);
    for (const operation of ordered) {
      const message = await this.restoreMessage(operation);
      if (!message) continue;
      try {
        await this.deliver(message);
      } catch {
        // Keep failed operations for the next connection attempt.
      }
    }
  }

  private deliver(message: Message): Promise<Message> {
    const running = this.inFlight.get(message.id);
    if (running) {
      return running;
    }
    const delivery = this.sendToAdapter(message).finally(() => {
      this.inFlight.delete(message.id);
      this.pendingFiles.delete(message.id);
      this.progressHandlers.delete(message.id);
    });
    this.inFlight.set(message.id, delivery);
    return delivery;
  }

  private async sendToAdapter(message: Message): Promise<Message> {
    const operation = await this.findOperation(message.id);
    if (operation) {
      await this.context.storage?.saveOutboxOperation({ ...operation, status: "processing" });
    }
    // In flight is announced but not written down: it is true for as long as the request lasts and no longer.
    // Writing it would also leave a message stuck in flight after a crash, when what it really is, is waiting.
    this.context.emitUpdated({ ...message, status: "sending" });
    try {
      const sentMessage = await this.sendContent(message, this.pendingFiles.get(message.id) ?? operation?.attachment);
      await this.context.storage?.deleteMessage(message.id);
      await this.context.storage?.deleteOutboxOperation(message.id);
      this.receivedMessageIds.add(sentMessage.id);
      await this.saveAndEmit(sentMessage);
      return sentMessage;
    } catch (error) {
      await this.fail(message, error);
      // A typed error from the adapter, such as a rate limit, is worth more than a generic one.
      if (error instanceof SdkError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new SdkError("ADAPTER_ERROR", `The message could not be sent: ${reason}`);
    }
  }

  private sendContent(message: Message, file: FileInput | undefined): Promise<Message> {
    const { adapter } = this.context;
    if (!message.attachment) {
      return adapter.sendMessage(message.conversationId, message.body, {
        ...(message.transactionId ? { transactionId: message.transactionId } : {}),
        ...(message.replyToId ? { replyToId: message.replyToId } : {}),
        ...(message.threadId ? { threadId: message.threadId } : {}),
        ...(message.formattedBody ? { formattedBody: message.formattedBody } : {}),
        ...(message.mentions ? { mentions: message.mentions } : {}),
        ...(message.kind ? { kind: message.kind } : {}),
        ...(message.location ? { location: message.location } : {})
      });
    }
    if (!file) {
      throw new SdkError("MESSAGE_NOT_FOUND", "The file content of this message is no longer available");
    }
    return adapter.sendAttachment(message.conversationId, file, message.transactionId, this.progressHandlers.get(message.id));
  }

  private async restoreMessage(operation: OutboxOperation): Promise<Message | undefined> {
    const stored = await this.context.storage?.getMessage(operation.id);
    if (stored) {
      return stored;
    }
    const session = this.context.getSession();
    if (!session) {
      return undefined;
    }
    const { attachment } = operation;
    return {
      id: operation.id,
      transactionId: operation.transactionId,
      conversationId: operation.conversationId,
      senderId: session.userId,
      body: operation.body,
      createdAt: operation.createdAt,
      status: "queued",
      ...(operation.replyToId ? { replyToId: operation.replyToId } : {}),
      ...(operation.threadId ? { threadId: operation.threadId } : {}),
      ...(operation.formattedBody ? { formattedBody: operation.formattedBody } : {}),
      ...(operation.mentions ? { mentions: operation.mentions } : {}),
      ...(operation.kind ? { kind: operation.kind } : {}),
      ...(attachment ? { attachment: {
        id: operation.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.data.byteLength,
        source: ""
      } } : {})
    };
  }

  private async saveOperation(message: Message, file?: FileInput): Promise<void> {
    await this.context.storage?.saveOutboxOperation({
      id: message.id,
      transactionId: message.transactionId ?? message.id,
      conversationId: message.conversationId,
      body: message.body,
      status: "pending",
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: message.createdAt,
      ...(file ? { attachment: file } : {}),
      ...(message.replyToId ? { replyToId: message.replyToId } : {}),
      ...(message.threadId ? { threadId: message.threadId } : {}),
      ...(message.formattedBody ? { formattedBody: message.formattedBody } : {}),
      ...(message.mentions ? { mentions: message.mentions } : {}),
      ...(message.kind ? { kind: message.kind } : {})
    });
  }

  private findOperation(operationId: string): Promise<OutboxOperation | undefined> {
    return this.context.storage?.getOutboxOperation(operationId) ?? Promise.resolve(undefined);
  }

  /** The homeserver said how long to wait, so waiting exactly that long and trying again is the whole fix. */
  private scheduleRetry(messageId: MessageId, delayMs: number): void {
    this.cancelRetry(messageId);
    const timer = setTimeout(() => {
      this.scheduledRetries.delete(messageId);
      void this.retry(messageId).catch(() => undefined);
    }, delayMs);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    this.scheduledRetries.set(messageId, timer);
  }

  private cancelRetry(messageId: MessageId): void {
    const timer = this.scheduledRetries.get(messageId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.scheduledRetries.delete(messageId);
  }

  /** Called when the client stops, so nothing keeps trying behind its back. */
  cancelScheduledRetries(): void {
    for (const messageId of [...this.scheduledRetries.keys()]) this.cancelRetry(messageId);
  }

  private async fail(message: Message, error: unknown): Promise<void> {
    await this.saveAndEmit({ ...message, status: "failed" });
    const retryAfterMs = error instanceof SdkError && error.code === "RATE_LIMITED" ? error.retryAfterMs : undefined;
    const operation = await this.findOperation(message.id);
    if (operation) {
      const attempts = operation.attempts + 1;
      const nextAttemptAt = attempts >= maxAutomaticAttempts
        ? Number.POSITIVE_INFINITY
        : Date.now() + (retryAfterMs ?? Math.min(maxBackoffMs, 1000 * 2 ** attempts));
      await this.context.storage?.saveOutboxOperation({
        ...operation,
        status: "failed",
        attempts,
        nextAttemptAt,
        lastError: error instanceof Error ? error.message : String(error)
      });
      const canRetry = attempts < maxAutomaticAttempts && retryAfterMs !== undefined;
      if (canRetry) this.scheduleRetry(message.id, retryAfterMs);
    }
    this.context.emitError(error);
  }

  /**
   * Once a message is on its way what was being written is finished, so it must not come back next time. There
   * is usually nothing to clear, and clearing nothing is still a write, so each conversation is only cleared
   * once per session unless something was written since.
   */
  private async clearDraft(conversationId: ConversationId): Promise<void> {
    if (this.draftsAlreadyCleared.has(conversationId)) return;
    this.draftsAlreadyCleared.add(conversationId);
    await this.context.storage?.saveDraft(conversationId, undefined);
  }

  /** Something was written again, so the next message has a draft to clear. */
  draftWritten(conversationId: ConversationId): void {
    this.draftsAlreadyCleared.delete(conversationId);
  }

  /**
   * Only what this client did while it was running counts. Somebody may have written a draft in another tab
   * while this one was stopped, and the next message sent has to clear it.
   */
  forgetWhatWasCleared(): void {
    this.draftsAlreadyCleared.clear();
  }

  private async saveAndEmit(message: Message): Promise<void> {
    await this.context.storage?.saveMessage(message);
    this.context.emitUpdated(message);
  }
}

function validateFile(file: FileInput): void {
  if (!file.name.trim()) {
    throw new SdkError("INVALID_INPUT", "File name cannot be empty");
  }
  if (!file.mimeType.trim()) {
    throw new SdkError("INVALID_INPUT", "File MIME type cannot be empty");
  }
  if (file.data.byteLength === 0) {
    throw new SdkError("INVALID_INPUT", "File content cannot be empty");
  }
}
