import type { ConversationId, Message, MessageId, MessagingClient } from "@relaykit/web";
import { element, onClick, safe } from "./dom.js";
import { face, type People } from "./people.js";
import { timeOf } from "./when.js";

/**
 * A thread: the message it hangs from, and everything said under it.
 *
 * Drawn apart from the timeline on purpose. The same message is in both, and a thread shows it differently —
 * no day headings, no collapsing — because a thread is one exchange about one thing.
 */
export class ThreadPanel {
  private hangingFrom: MessageId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      /** The root is not in what `messages.thread` gives: it is in the timeline, where it was read from. */
      readonly messageCalled: (messageId: MessageId) => Message | undefined;
      readonly nameOfOpen: () => string;
    }
  ) {}

  wire(): void {
    onClick("thread-close", () => this.close());
  }

  rootId(): MessageId | undefined {
    return this.hangingFrom;
  }

  open(rootId: MessageId): void {
    this.hangingFrom = rootId;
    element("thread").hidden = false;
    element("thread-where").textContent = this.where.nameOfOpen();
    void this.repaint();
  }

  close(): void {
    this.hangingFrom = undefined;
    element("thread").hidden = true;
  }

  async repaint(): Promise<void> {
    const rootId = this.hangingFrom;
    const conversationId = this.where.openId();
    if (!rootId || !conversationId) return;
    const answers = await this.client.messages.thread(conversationId, rootId).catch(() => []);
    // Somebody who moved on while this was coming back is not looking at this thread any more.
    if (this.hangingFrom !== rootId) return;
    const root = this.where.messageCalled(rootId);
    const count = answers.length === 1 ? "1 respuesta" : `${answers.length} respuestas`;
    element("thread-body").innerHTML = !root
      ? ""
      : [
          said(root, this.people),
          `<p class="thread-count">${count}</p>`,
          ...answers.map(answer => said(answer, this.people))
        ].join("");
  }
}

function said(message: Message, people: People): string {
  return `<div class="said">
    ${face(people, message.senderId, true)}
    <div>
      <p class="who">
        <strong>${safe(people.nameOf(message.senderId))}</strong>
        <span class="at">${timeOf(message.createdAt)}</span>
      </p>
      <p>${safe(message.body)}</p>
    </div>
  </div>`;
}
