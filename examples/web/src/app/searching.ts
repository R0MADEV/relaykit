import type { Conversation, ConversationId, Message, MessageId, MessagingClient } from "@relaykit/web";
import { element, input, onClick, pressedIn, safe } from "./dom.js";
import { face, type People } from "./people.js";
import { dayOf, timeOf } from "./when.js";

/** Long enough that a search is worth making, short enough that nobody has to press anything. */
const enoughToLookFor = 2;

/**
 * Looking for something that was said.
 *
 * Across everything by default, and inside one conversation when somebody asked for that — which is the one
 * thing the magnifying glass in the header of a conversation can sensibly mean. What it searches is what this
 * device holds: a homeserver cannot look inside an encrypted conversation, because it cannot read it.
 */
export class Searching {
  private inside: ConversationId | undefined;
  private looking: number | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      readonly nameOf: (conversationId: ConversationId) => string | undefined;
      readonly open: (conversationId: ConversationId) => void;
      /** Opens a conversation where something was said, which is what a result is for. */
      readonly openAt: (conversationId: ConversationId, messageId: MessageId) => void;
    }
  ) {}

  wire(): void {
    input("search").addEventListener("input", () => this.lookAgainShortly());
    onClick("search-here", () => this.lookInHere());
    onClick("results-close", () => this.close());
    element("results-list").addEventListener("click", event => {
      const conversationId = pressedIn(event, "found-in");
      if (!conversationId) return;
      this.close();
      const messageId = pressedIn(event, "found-said");
      // A conversation found by its name has nothing inside it to land on; one found by something said does.
      if (messageId) this.where.openAt(conversationId, messageId);
      else this.where.open(conversationId);
    });
  }

  /** Whatever is open is what the magnifying glass in its header means by "here". */
  private lookInHere(): void {
    this.inside = this.where.openId();
    input("search").focus();
    this.lookAgainShortly();
  }

  private close(): void {
    input("search").value = "";
    this.inside = undefined;
    element("results").hidden = true;
    element("timeline").hidden = false;
  }

  /**
   * Waits for the typing to stop before looking. Searching reads and decrypts local history, so a search per
   * keystroke is real work per keystroke, and the answers come back out of order.
   */
  private lookAgainShortly(): void {
    window.clearTimeout(this.looking);
    this.looking = window.setTimeout(() => void this.look(), 250);
  }

  private async look(): Promise<void> {
    const query = input("search").value.trim();
    if (query.length < enoughToLookFor) {
      this.close();
      return;
    }
    const inside = this.inside;
    // Two questions at once, because somebody typing into one box means either: a conversation by its name,
    // or something that was said in one. Looking for a conversation while reading one is not what the
    // magnifying glass in its header meant, so that one is only asked across everything.
    const [found, conversations] = await Promise.all([
      this.client.messages.search(query, inside ? { conversationId: inside } : {}).catch(() => []),
      inside ? Promise.resolve([]) : this.client.conversations.search(query).catch(() => [])
    ]);
    // Somebody who kept typing while this was coming back is looking for something else by now.
    if (input("search").value.trim() !== query) return;
    this.paint(query, found, conversations);
  }

  private paint(query: string, found: readonly Message[], conversations: readonly Conversation[] = []): void {
    element("timeline").hidden = true;
    element("results").hidden = false;
    const whereAbouts = this.inside ? ` en #${this.where.nameOf(this.inside) ?? ""}` : "";
    element("results-said").textContent =
      found.length === 0
        ? `Nada que diga «${query}»${whereAbouts}`
        : `${found.length} ${found.length === 1 ? "resultado" : "resultados"} para «${query}»${whereAbouts}`;
    element("results-list").innerHTML =
      conversations.map(conversation => this.conversationRow(conversation)).join("") +
      found.map(message => this.row(message)).join("");
  }

  /** A conversation whose name matches. Pressed, it opens; there is nothing inside it to land on. */
  private conversationRow(conversation: Conversation): string {
    const name = conversation.title ?? conversation.id;
    return `<button class="found" data-found-in="${safe(conversation.id)}">
      <span class="hash" aria-hidden="true">#</span>
      <span class="found-what"><strong>${safe(name)}</strong>
        <span class="faint">${safe(conversation.topic ?? "una conversación")}</span></span>
    </button>`;
  }

  private row(message: Message): string {
    const where = this.where.nameOf(message.conversationId) ?? message.conversationId;
    return `<button class="found" data-found-in="${safe(message.conversationId)}" data-found-said="${safe(message.id)}">
      ${face(this.people, message.senderId, true)}
      <span class="found-what">
        <span class="who">
          <strong>${safe(this.people.nameOf(message.senderId))}</strong>
          <span class="mono faint">#${safe(where)}</span>
          <span class="at">${dayOf(message.createdAt)} · ${timeOf(message.createdAt)}</span>
        </span>
        <span>${safe(message.body)}</span>
      </span>
    </button>`;
  }
}
