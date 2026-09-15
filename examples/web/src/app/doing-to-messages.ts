import type { ConversationId, MessageId, MessagingClient } from "@relaykit/web";
import { element, input, pressedIn } from "./dom.js";

/** The handful a keyboard can reach for, which is what a picker is for most of the time. */
const handy = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

/**
 * What somebody does to a message that is already there: answer it, react to it, and where it is theirs,
 * change it or take it back.
 *
 * One listener on the timeline rather than one per message: the timeline is repainted whole every time
 * anything moves, and wiring each row again on every repaint is both more code and one more thing to forget.
 */
export class DoingToMessages {
  private answering: MessageId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      readonly said: (messageId: MessageId) => string | undefined;
      readonly hangFrom: (messageId: MessageId) => void;
      readonly pin: (messageId: MessageId) => void;
      /** Every conversation this account is in, for choosing where something is sent on to. */
      readonly conversations: () => readonly { readonly id: ConversationId; readonly title?: string }[];
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    element("timeline").addEventListener("click", event => void this.pressed(event));
    element("answering").addEventListener("click", () => this.stopAnswering());
  }

  /** What the next message carries besides its text, which is nothing unless somebody is answering something. */
  answeringWhat(): MessageId | undefined {
    return this.answering;
  }

  stopAnswering(): void {
    this.answering = undefined;
    element("answering").hidden = true;
  }

  /**
   * Sending something on to another conversation.
   *
   * Asked for by name rather than picked from a list: this is an example, and a conversation picker is a
   * screen of its own that would say nothing new about the library.
   */
  private async forward(from: ConversationId, messageId: MessageId): Promise<void> {
    const elsewhere = this.where.conversations().filter(each => each.id !== from);
    const asked = window.prompt(
      `¿A cuál lo reenvío?\n\n${elsewhere.map(each => each.title ?? each.id).join("\n")}`
    );
    if (!asked?.trim()) return;
    const wanted = elsewhere.find(each => (each.title ?? each.id) === asked.trim());
    if (!wanted) return;
    try {
      await this.client.messages.forward(messageId, wanted.id);
    } catch (error) {
      this.where.wentWrong(error);
    }
  }

  /** Telling the homeserver's administrators about one message. A reason is required, and is the point. */
  private async report(messageId: MessageId): Promise<void> {
    const why = window.prompt("¿Por qué lo denuncias?");
    if (!why?.trim()) return;
    try {
      await this.client.messages.report(messageId, why.trim());
    } catch (error) {
      this.where.wentWrong(error);
    }
  }

  private async pressed(event: Event): Promise<void> {
    const conversationId = this.where.openId();
    if (!conversationId) return;
    const answers = pressedIn(event, "answers");
    if (answers) return this.answer(answers);
    const reacts = pressedIn(event, "reacts");
    if (reacts)
      return this.react(conversationId, reacts, pressedIn(event, "takes-back"), pressedIn(event, "key"));
    const picks = pressedIn(event, "reacts-to");
    if (picks) return this.pick(conversationId, picks);
    const edits = pressedIn(event, "edits");
    if (edits) return this.edit(conversationId, edits);
    const deletes = pressedIn(event, "deletes");
    if (deletes) return this.delete(conversationId, deletes);
    const pins = pressedIn(event, "pins");
    if (pins) return void this.where.pin(pins);
    const forwards = pressedIn(event, "forwards");
    if (forwards) return this.forward(conversationId, forwards);
    const reports = pressedIn(event, "reports");
    if (reports) return this.report(reports);
    // The pill under a message and the button in its row mean the same thing: open the thread hanging here.
    const retries = pressedIn(event, "retries");
    if (retries) return this.sendAgain(retries);
    const givesUp = pressedIn(event, "gives-up");
    if (givesUp) return this.giveUp(givesUp);
    // The pill under a message and the button in its row mean the same thing: open the thread hanging here.
    const hangs = pressedIn(event, "hangs-from") ?? pressedIn(event, "opens-thread");
    if (hangs) this.where.hangFrom(hangs);
  }

  private answer(messageId: MessageId): void {
    this.answering = messageId;
    element("answering").hidden = false;
    element("answering-what").textContent = this.where.said(messageId) ?? "un mensaje";
    input("write").focus();
  }

  /** Pressing a pill that is already yours takes it back, which is the only thing pressing it can mean. */
  private async react(
    conversationId: ConversationId,
    messageId: MessageId,
    takesBack: string | undefined,
    key: string | undefined
  ): Promise<void> {
    if (!key) return;
    try {
      if (takesBack) await this.client.reactions.remove(conversationId, takesBack);
      else await this.client.reactions.add(conversationId, messageId, key);
    } catch (error) {
      this.where.wentWrong(error);
    }
  }

  private async pick(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    const key = window.prompt(`Reacciona con una de estas, o escribe otra:\n${handy.join("  ")}`, handy[0]);
    if (!key?.trim()) return;
    await this.client.reactions.add(conversationId, messageId, key.trim()).catch(this.where.wentWrong);
  }

  private async sendAgain(messageId: MessageId): Promise<void> {
    await this.client.messages.retry(messageId).catch(this.where.wentWrong);
  }

  private async giveUp(messageId: MessageId): Promise<void> {
    await this.client.messages.cancel(messageId).catch(this.where.wentWrong);
  }

  private async edit(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    const was = this.where.said(messageId) ?? "";
    const now = window.prompt("Editar el mensaje", was);
    if (now === null || now.trim() === was) return;
    await this.client.messages.edit(conversationId, messageId, now.trim()).catch(this.where.wentWrong);
  }

  private async delete(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    // Asked because it cannot be undone: what is taken back is taken back for everybody, on every device.
    if (!window.confirm("¿Borrar este mensaje para todos?")) return;
    await this.client.messages.delete(conversationId, messageId).catch(this.where.wentWrong);
  }
}
