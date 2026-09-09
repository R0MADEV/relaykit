import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type {
  ConversationId,
  FileInput,
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
  private readonly inFlight = new Map<MessageId, Promise<Message>>();
  /** File contents for sends started in this process; persisted operations carry them across restarts. */
  private readonly pendingFiles = new Map<MessageId, FileInput>();
  private readonly progressHandlers = new Map<MessageId, (fraction: number) => void>();

  constructor(
    private readonly context: OutboxOperationsContext,
    private readonly receivedMessageIds: Set<string>
  ) {}

  async send(conversationId: ConversationId, body: string, options: SendMessageOptions = {}): Promise<Message> {
    this.context.assertStarted();
    if (!body.trim()) {
      throw new SdkError("INVALID_INPUT", "Message body cannot be empty");
    }
    if (options.replyTo !== undefined && !options.replyTo.trim()) {
      throw new SdkError("INVALID_INPUT", "The message being replied to must be identified");
    }
    const base = this.createLocalMessage(conversationId, body);
    const localMessage: Message = options.replyTo ? { ...base, replyToId: options.replyTo } : base;
    await this.saveOperation(localMessage);
    await this.saveAndEmit(localMessage);
    return this.deliver(localMessage);
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
      source: ""
    };
    const localFileMessage: Message = { ...localMessage, attachment };
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
    await this.saveAndEmit({ ...message, status: "sending" });
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
      return adapter.sendMessage(message.conversationId, message.body, message.transactionId, message.replyToId);
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
      ...(message.replyToId ? { replyToId: message.replyToId } : {})
    });
  }

  private findOperation(operationId: string): Promise<OutboxOperation | undefined> {
    return this.context.storage?.getOutboxOperation(operationId) ?? Promise.resolve(undefined);
  }

  private async fail(message: Message, error: unknown): Promise<void> {
    await this.saveAndEmit({ ...message, status: "failed" });
    const operation = await this.findOperation(message.id);
    if (operation) {
      const attempts = operation.attempts + 1;
      const nextAttemptAt = attempts >= maxAutomaticAttempts
        ? Number.POSITIVE_INFINITY
        : Date.now() + Math.min(maxBackoffMs, 1000 * 2 ** attempts);
      await this.context.storage?.saveOutboxOperation({
        ...operation,
        status: "failed",
        attempts,
        nextAttemptAt,
        lastError: error instanceof Error ? error.message : String(error)
      });
    }
    this.context.emitError(error);
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
