import type { ConversationId, MessageId, MessagingClient, SendMessageOptions } from "@relaykit/web";
import { element, input, onSubmit, pressedIn } from "./dom.js";
import { asHtml, mentioned, wrapped, type Style } from "./writing.js";

const styles: Readonly<Record<string, Style>> = {
  bold: "bold",
  italic: "italic",
  code: "code",
  link: "link"
};

/**
 * The write box, and what a message carries besides its text.
 *
 * The marks the toolbar puts in are what somebody reads while they write; what travels is the text and the
 * same text as HTML, worked out at the moment of sending. Keeping one of the two in the box would mean the
 * box showing tags to whoever is typing.
 */
export class Composing {
  constructor(
    private readonly client: MessagingClient,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      readonly threadRootId: () => MessageId | undefined;
      readonly said: () => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    element("tools").addEventListener("click", event => this.styled(event));
    onSubmit("composer", () => void this.send(input("write"), undefined));
    onSubmit("thread-write", () => void this.send(input("thread-write-body"), this.where.threadRootId()));
  }

  private styled(event: Event): void {
    const pressed = pressedIn(event, "styles");
    const style = pressed ? styles[pressed] : undefined;
    const box = input("write");
    if (!style) return;
    const after = wrapped(
      { text: box.value, from: box.selectionStart ?? 0, to: box.selectionEnd ?? 0 },
      style
    );
    box.value = after.text;
    box.focus();
    box.setSelectionRange(after.from, after.to);
  }

  private async send(box: HTMLInputElement, threadId: MessageId | undefined): Promise<void> {
    const body = box.value.trim();
    const conversationId = this.where.openId();
    if (!body || !conversationId) return;
    box.value = "";
    this.where.said();
    try {
      await this.client.messages.send(conversationId, body, whatItCarries(body, threadId));
    } catch (error) {
      // Put back rather than lost: somebody who wrote three lines should not have to write them again.
      box.value = body;
      this.where.wentWrong(error);
    }
  }
}

/** Everything a message carries besides its text, left out entirely where it carries none. */
function whatItCarries(body: string, threadId: MessageId | undefined): SendMessageOptions {
  const formattedBody = asHtml(body);
  const userIds = mentioned(body);
  const carried: { -readonly [Key in keyof SendMessageOptions]?: SendMessageOptions[Key] } = {};
  if (threadId) carried.threadId = threadId;
  if (formattedBody) carried.formattedBody = formattedBody;
  if (userIds.length > 0) carried.mentions = { userIds };
  return carried;
}
