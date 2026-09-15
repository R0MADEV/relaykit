import type { ConversationId, MessagingClient, Poll } from "@relaykit/web";
import { dialog, element, input, onClick, onSubmit, pressedIn, safe } from "./dom.js";

/**
 * Asking the conversation something, and counting what it answers.
 *
 * Painted in a place of its own above the timeline rather than inside it. The timeline is rebuilt whole every
 * time somebody says something, so a poll drawn among the messages is wiped by whatever is said next — and a
 * question people are still answering must not vanish because somebody typed "ok".
 */
export class Asking {
  private conversationId: ConversationId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly around: { readonly wentWrong: (error: unknown) => void }
  ) {}

  wire(): void {
    onClick("ask-something", () => this.open());
    onSubmit("ask-form", () => void this.ask());
    element("polls").addEventListener("click", event => {
      const answering = pressedIn(event, "votes");
      if (answering) return void this.vote(answering);
      const closing = pressedIn(event, "closes");
      if (closing) void this.close(closing);
    });
  }

  /** Repainted when the conversation changes, and after anything that changes a count. */
  async paintOn(conversationId: ConversationId | undefined): Promise<void> {
    this.conversationId = conversationId;
    if (!conversationId) {
      element("polls").innerHTML = "";
      return;
    }
    const asked = await this.client.polls.list(conversationId).catch(() => []);
    // Somebody may have opened another conversation while the homeserver was answering about this one.
    if (this.conversationId !== conversationId) return;
    element("polls").innerHTML = asked.map(poll => this.drawn(poll)).join("");
  }

  private open(): void {
    element("more-menu").hidden = true;
    if (!this.conversationId) return;
    input("ask-question").value = "";
    input("ask-answers").value = "";
    dialog("ask").showModal();
  }

  /** Answers separated by commas, which is the quickest thing to type and the easiest to read back. */
  private async ask(): Promise<void> {
    const conversationId = this.conversationId;
    const question = input("ask-question").value.trim();
    const answers = input("ask-answers")
      .value.split(",")
      .map(answer => answer.trim())
      .filter(Boolean);
    if (!conversationId || !question || answers.length < 2) return;
    try {
      await this.client.polls.start(conversationId, { question, answers });
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private async vote(where: string): Promise<void> {
    const [pollId, answerId] = where.split("|");
    const conversationId = this.conversationId;
    if (!conversationId || !pollId || !answerId) return;
    try {
      await this.client.polls.vote(conversationId, pollId, answerId);
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private async close(pollId: string): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    try {
      await this.client.polls.close(conversationId, pollId);
      await this.paintOn(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  private drawn(poll: Poll): string {
    const votes = poll.answers.reduce((count, answer) => count + answer.votes, 0);
    const answers = poll.answers
      .map(answer => {
        const mine = poll.ownAnswerId === answer.id ? " ✓" : "";
        const share = votes > 0 ? Math.round((answer.votes / votes) * 100) : 0;
        const label = `${safe(answer.text)} · ${answer.votes}${mine}`;
        // A closed poll is read, not answered: the counts stay and there is nothing left to press.
        const inside = poll.isClosed
          ? `<span class="answer-what">${label}</span>`
          : `<button class="answer-what" data-votes="${safe(poll.id)}|${safe(answer.id)}" type="button">${label}</button>`;
        return `<li class="answer">${inside}<span class="share" style="width:${share}%"></span></li>`;
      })
      .join("");
    const close = poll.isClosed
      ? '<span class="tag quiet">Cerrada</span>'
      : `<button class="button small" data-closes="${safe(poll.id)}" type="button">Cerrar</button>`;
    return `<div class="poll card" data-poll="${safe(poll.id)}">
      <p class="poll-question"><strong>${safe(poll.question)}</strong>${close}</p>
      <ul class="answers">${answers}</ul>
    </div>`;
  }
}
