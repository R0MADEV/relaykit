import type { ConversationId, MessagingClient } from "@relaykit/web";
import { element, onClick, pressedIn, safe } from "./dom.js";

/**
 * Filing a conversation away: under a name of your own, or out of your history altogether.
 *
 * The two live together because they are the same shelf seen from both ends, and they are the two things in
 * this application that only you can see: a tag is yours alone, and forgetting takes a conversation out of
 * your history and nobody else's.
 */
export class Filing {
  private conversationId: ConversationId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly around: {
      readonly leftItAll: () => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    onClick("tag-here", () => void this.tag());
    onClick("forget-here", () => void this.forget());
    element("open-tags").addEventListener("click", event => {
      const tag = pressedIn(event, "untags");
      if (tag) void this.untag(tag);
    });
  }

  /** Painted on its own and not with the rest of the head: the homeserver has to be asked for them. */
  async paintOn(conversationId: ConversationId): Promise<void> {
    this.conversationId = conversationId;
    element("open-tags").innerHTML = "";
    const tags = await this.client.conversations.tags(conversationId).catch(() => []);
    // Somebody may have opened another conversation while the homeserver was answering about this one.
    if (this.conversationId !== conversationId) return;
    element("open-tags").innerHTML = tags
      .map(
        tag =>
          `<button class="tag" data-untags="${safe(tag)}" type="button" ` +
          `title="Quitar de ${safe(tag)}">${safe(shownAs(tag))}</button>`
      )
      .join("");
  }

  private async tag(): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    element("more-menu").hidden = true;
    const name = window.prompt("Archivar esta conversación en:", "trabajo");
    if (!name?.trim()) return;
    try {
      await this.client.conversations.tag(conversationId, `u.${name.trim()}`);
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private async untag(tag: string): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    try {
      await this.client.conversations.untag(conversationId, tag);
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  /**
   * Leaving and forgetting, which are two steps and in that order: forgetting one you are still in brings it
   * straight back. Said plainly before it happens, because nothing here can undo it.
   */
  private async forget(): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    element("more-menu").hidden = true;
    const sure = window.confirm(
      "Salir y borrarla de tu historial. No podrás volver a leer lo que se dijo aquí, ni aunque vuelvas a entrar. ¿Seguir?"
    );
    if (!sure) return;
    try {
      await this.client.conversations.leave(conversationId);
      await this.client.conversations.forget(conversationId);
      this.conversationId = undefined;
      this.around.leftItAll();
    } catch (error) {
      this.around.wentWrong(error);
    }
  }
}

/** The namespace is how a tag of yours is told apart from the protocol's, and not something worth reading. */
function shownAs(tag: string): string {
  return tag.startsWith("u.") ? tag.slice(2) : tag;
}
