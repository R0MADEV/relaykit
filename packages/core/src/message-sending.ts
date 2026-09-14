import { SdkError } from "./errors.js";
import type { MediaAdapter } from "./adapter.js";
import type {
  ConversationId,
  FileInput,
  GeoLocation,
  Message,
  MessageId,
  SendFileOptions,
  SendMessageOptions,
  VoiceInfo
} from "./models.js";
import type { MessageOperationsContext } from "./message-operations.js";
import type { OutboxOperations } from "./outbox-operations.js";

/**
 * Putting something on the wire, and what happens to it when the wire is not there.
 *
 * Apart from reading a conversation because sending has a life of its own: what goes out may not go out
 * yet, and the queue that holds it, what the homeserver will take, and giving up on something are all
 * about the sending and none of them about the reading.
 */
export class MessageSending {
  constructor(
    private readonly context: MessageOperationsContext,
    private readonly outbox: OutboxOperations,
    private readonly findMessage: (messageId: MessageId) => Promise<Message | undefined>
  ) {}

  sendMessage(
    conversationId: ConversationId,
    body: string,
    options: SendMessageOptions = {}
  ): Promise<Message> {
    return this.outbox.send(conversationId, body, options);
  }
  async sendFile(
    conversationId: ConversationId,
    file: FileInput,
    options: SendFileOptions = {}
  ): Promise<Message> {
    await this.refuseWhatIsTooBig(file);
    return this.outbox.sendFile(conversationId, file, options);
  }
  /**
   * Refused here rather than after sending it. Every homeserver has a limit and says what it is; without
   * asking, the only way to find out is to upload something over a phone connection and be told no at the
   * end, with nothing to show for it.
   */
  private async refuseWhatIsTooBig(file: FileInput): Promise<void> {
    const allowed = (await this.context.whatTheHomeserverTakes()).maxUploadBytes;
    const size = file.data.byteLength;
    if (size <= allowed) return;
    throw new SdkError(
      "INVALID_INPUT",
      `This homeserver takes files up to ${allowed} bytes and this one is ${size}`
    );
  }
  sendSticker(conversationId: ConversationId, sticker: FileInput): Promise<Message> {
    return this.outbox.sendSticker(conversationId, sticker);
  }
  sendLocation(conversationId: ConversationId, location: GeoLocation): Promise<Message> {
    return this.outbox.sendLocation(conversationId, location);
  }
  sendVoice(conversationId: ConversationId, file: FileInput, voice: VoiceInfo): Promise<Message> {
    return this.outbox.sendVoice(conversationId, file, voice);
  }
  /**
   * Passes a message on to another conversation. A file is fetched and sent again rather than pointed at, because
   * the copy in one conversation is locked with a key the other conversation does not have.
   */
  async forward(messageId: MessageId, toConversationId: ConversationId): Promise<Message> {
    this.context.assertStarted();
    const original = await this.findMessage(messageId);
    if (!original) {
      throw new SdkError("MESSAGE_NOT_FOUND", "The message does not exist");
    }
    if (original.undecryptable || original.deletedAt) {
      throw new SdkError("INVALID_INPUT", "A message that cannot be read cannot be passed on");
    }
    const { attachment } = original;
    if (attachment) {
      const data = await this.media.downloadAttachment(attachment);
      return this.outbox.sendFile(
        toConversationId,
        {
          name: attachment.name,
          mimeType: attachment.mimeType,
          data: new Uint8Array(data),
          ...(attachment.width !== undefined ? { width: attachment.width } : {}),
          ...(attachment.height !== undefined ? { height: attachment.height } : {}),
          ...(attachment.voice ? { voice: attachment.voice } : {})
        },
        {}
      );
    }
    if (original.location) {
      return this.outbox.sendLocation(toConversationId, original.location);
    }
    return this.outbox.send(toConversationId, original.body, {
      ...(original.formattedBody ? { formattedBody: original.formattedBody } : {}),
      ...(original.kind ? { kind: original.kind } : {})
    });
  }
  draftWritten(conversationId: ConversationId): void {
    this.outbox.draftWritten(conversationId);
  }
  retryMessage(messageId: MessageId): Promise<Message> {
    return this.outbox.retry(messageId);
  }
  cancelMessage(messageId: MessageId): Promise<Message> {
    return this.outbox.cancel(messageId);
  }
  flushPending(): Promise<void> {
    return this.outbox.flush();
  }
  /** The one place that answers whether this adapter does this at all. */
  private get media(): MediaAdapter {
    const media = this.context.adapter.media;
    if (!media) throw new SdkError("NOT_SUPPORTED", "Carrying files is not something this homeserver does");
    return media;
  }
}
