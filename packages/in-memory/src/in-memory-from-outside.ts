import {
  SdkError,
  type ConversationId,
  type Message,
  type MessageId,
  type MessageSurroundings
} from "@relaykit/core";

/** What reading around a message needs from the adapter around it, and nothing else of it. */
export interface InMemoryFromOutsideContext {
  readonly messages: () => readonly Message[];
}

/**
 * Opening a conversation where something was said instead of at its end.
 *
 * Apart from the conversations themselves because it is not about being in one: it is what a search result
 * needs to be worth opening.
 */
export class InMemoryFromOutside {
  constructor(private readonly context: InMemoryFromOutsideContext) {}

  async readAroundMessage(
    conversationId: ConversationId,
    messageId: MessageId,
    limit: number
  ): Promise<MessageSurroundings> {
    const said = this.said(conversationId);
    const at = said.findIndex(message => message.id === messageId);
    if (at < 0) throw new SdkError("MESSAGE_NOT_FOUND", `There is no message called ${messageId}`);
    return {
      message: said[at] as Message,
      before: said.slice(Math.max(0, at - limit), at),
      after: said.slice(at + 1, at + 1 + limit)
    };
  }

  private said(conversationId: ConversationId): readonly Message[] {
    return this.context
      .messages()
      .filter(message => message.conversationId === conversationId)
      .sort((one, other) => one.createdAt - other.createdAt);
  }
}
