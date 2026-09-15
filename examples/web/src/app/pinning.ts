import type { ConversationId, MessageId, MessagingClient } from "@relaykit/web";
import { element, onClick, pressedIn, safe } from "./dom.js";
import type { People } from "./people.js";

/**
 * The messages a conversation keeps to hand.
 *
 * Above what is being said rather than among it, and for the same reason polls are: the timeline is rebuilt
 * whole whenever somebody speaks, and the point of pinning something is that it does not scroll away.
 */
export class Pinning {
  private conversationId: ConversationId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly around: {
      readonly openId: () => ConversationId | undefined;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    element("pinned").addEventListener("click", event => {
      const unpinning = pressedIn(event, "unpins");
      if (unpinning) void this.unpin(unpinning);
    });
    onClick("pin-what-was-said", () => void this.pinTheLastOne());
  }

  async paintOn(conversationId: ConversationId | undefined): Promise<void> {
    this.conversationId = conversationId;
    if (!conversationId) {
      element("pinned").innerHTML = "";
      return;
    }
    const kept = await this.client.conversations.pinned(conversationId).catch(() => []);
    if (this.conversationId !== conversationId) return;
    element("pinned").innerHTML = kept
      .map(
        message =>
          `<div class="kept-message">
            <strong>${safe(this.people.nameOf(message.senderId))}</strong>
            <span>${safe(message.body)}</span>
            <button class="icon-button" data-unpins="${safe(message.id)}" aria-label="Quitar">✕</button>
          </div>`
      )
      .join("");
  }

  /** Pins one message, named by whoever pressed the thing that says so. */
  async pin(messageId: MessageId): Promise<void> {
    const conversationId = this.around.openId();
    if (!conversationId) return;
    try {
      await this.client.conversations.pin(conversationId, messageId);
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private async pinTheLastOne(): Promise<void> {
    element("more-menu").hidden = true;
    const last = [...document.querySelectorAll("#timeline [data-message]")].at(-1);
    const messageId = last instanceof HTMLElement ? last.dataset.message : undefined;
    if (messageId) await this.pin(messageId);
  }

  private async unpin(messageId: MessageId): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    try {
      await this.client.conversations.unpin(conversationId, messageId);
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }
}
