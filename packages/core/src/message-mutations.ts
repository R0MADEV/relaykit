import { RelayKitError } from "./errors.js";
import type { MessagingAdapter, EditingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type { ConversationId, Message, MessageId } from "./models.js";
import type { PendingActions } from "./pending-actions.js";

export interface MessageMutationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly assertStarted: () => void;
  readonly emitUpdated: (message: Message) => void;
  readonly waiting: PendingActions;
}

export class MessageMutations {
  constructor(private readonly context: MessageMutationsContext) {}

  async edit(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message> {
    this.context.assertStarted();
    if (!body.trim()) {
      throw new RelayKitError("INVALID_INPUT", "Message body cannot be empty");
    }

    // With no homeserver to tell, the new wording is remembered and sent when there is one. Only the last
    // wording matters: the ones on the way to it were never seen by anybody else.
    try {
      const message = await this.editing.editMessage(conversationId, messageId, body);
      this.context.waiting.forget(`edit:${messageId}`);
      return this.keepAndTell(message);
    } catch (error) {
      const known = await this.context.storage?.getMessage(messageId);
      if (!known) throw error;
      this.context.waiting.remember(`edit:${messageId}`, () =>
        this.editing.editMessage(conversationId, messageId, body).then(message => this.keepAndTell(message))
      );
      return this.keepAndTell({ ...known, body, editedAt: Date.now() });
    }
  }

  async delete(conversationId: ConversationId, messageId: MessageId): Promise<Message> {
    this.context.assertStarted();
    try {
      const message = await this.editing.deleteMessage(conversationId, messageId);
      this.context.waiting.forget(`delete:${messageId}`);
      return this.keepAndTell(message);
    } catch (error) {
      const known = await this.context.storage?.getMessage(messageId);
      if (!known) throw error;
      this.context.waiting.remember(`delete:${messageId}`, () =>
        this.editing.deleteMessage(conversationId, messageId).then(message => this.keepAndTell(message))
      );
      return this.keepAndTell({ ...known, body: "", deletedAt: Date.now() });
    }
  }

  private async keepAndTell(message: Message): Promise<Message> {
    await this.context.storage?.saveMessage(message);
    this.context.emitUpdated(message);
    return message;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get editing(): EditingAdapter {
    const found = this.context.adapter.editing;
    if (!found)
      throw new RelayKitError(
        "NOT_SUPPORTED",
        "Editing and deleting messages is not something this homeserver has"
      );
    return found;
  }
}
