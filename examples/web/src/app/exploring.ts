import type { MessagingClient, PublicConversation } from "@relaykit/web";
import { dialog, element, input, pressedIn, safe } from "./dom.js";

/**
 * The channels of this homeserver anybody may walk into.
 *
 * Its own screen because it is the one list that is not yours: everything else here is what this account
 * takes part in, and this is what it could.
 */
export class Exploring {
  private looking: number | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly where: {
      readonly joined: (conversationId: string) => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    input("explore-search").addEventListener("input", () => this.lookAgainShortly());
    element("explore-found").addEventListener("click", event => {
      const conversationId = pressedIn(event, "joins");
      if (conversationId) void this.join(conversationId);
    });
  }

  open(): void {
    input("explore-search").value = "";
    dialog("explore").showModal();
    void this.look();
  }

  private lookAgainShortly(): void {
    window.clearTimeout(this.looking);
    this.looking = window.setTimeout(() => void this.look(), 250);
  }

  private async look(): Promise<void> {
    const query = input("explore-search").value.trim();
    const found = await this.client.conversations.discover(query).catch(() => []);
    // Somebody who kept typing while this was coming back is looking for something else by now.
    if (input("explore-search").value.trim() !== query) return;
    element("explore-found").innerHTML =
      found.length === 0
        ? `<li class="faint">Nada que se llame así</li>`
        : found.map(each => row(each)).join("");
  }

  private async join(conversationId: string): Promise<void> {
    try {
      await this.client.conversations.join(conversationId);
      dialog("explore").close();
      this.where.joined(conversationId);
    } catch (error) {
      this.where.wentWrong(error);
    }
  }
}

function row(found: PublicConversation): string {
  const name = found.title ?? found.alias ?? found.id;
  const many = `${found.participantCount} ${found.participantCount === 1 ? "persona" : "personas"}`;
  return `<li>
    <span class="hash" aria-hidden="true">#</span>
    <span class="who-name">${safe(name)}</span>
    <span class="mono faint">${many}</span>
    <button class="button" type="button" data-joins="${safe(found.id)}">Entrar</button>
  </li>`;
}
