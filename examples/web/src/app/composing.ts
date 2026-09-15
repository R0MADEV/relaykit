import type { ConversationId, MessageId, MessagingClient, SendMessageOptions } from "@relaykit/web";
import { element, input, onClick, onSubmit, pressedIn } from "./dom.js";
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
  private keeping: number | undefined;
  /** The link a preview was last asked about, so typing past it does not paint a stale one. */
  private lookingAt: string | undefined;
  /** Where the box was when it was last written in, which is where what is in it belongs. */
  private wasIn: ConversationId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      readonly threadRootId: () => MessageId | undefined;
      /** What the next message answers, when somebody pressed answer on one. */
      readonly answering: () => MessageId | undefined;
      readonly stopAnswering: () => void;
      readonly said: () => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    element("tools").addEventListener("click", event => this.styled(event));
    // Kept as it is typed rather than only on the way out: a tab closed mid-sentence is the common way to
    // lose one, and by then there is nobody left to ask.
    input("write").addEventListener("input", () => {
      this.keepShortly();
      this.lookAtTheLink();
    });
    onClick("attach", () => input("attachment").click());
    input("attachment").addEventListener("change", () => void this.attach());
    onSubmit("composer", () => void this.send(input("write"), undefined));
    onSubmit("thread-write", () => void this.send(input("thread-write-body"), this.where.threadRootId()));
  }

  /** Reads back what was left here last time, and puts away what is here now. */
  async moveTo(conversationId: ConversationId | undefined): Promise<void> {
    await this.keep(conversationId);
    const box = input("write");
    box.value = "";
    if (!conversationId) return;
    const kept = await this.client.conversations.draft(conversationId).catch(() => undefined);
    // Somebody who moved on again while this was coming back is not looking at that conversation any more.
    // Compared against where this box is headed, not against what is open: what is open catches up after
    // this runs, so asking it would say no every time and throw away every draft it just read.
    if (this.wasIn === conversationId && kept) box.value = kept;
  }

  /**
   * What is behind the link somebody is typing.
   *
   * The homeserver looks, not this browser: that way whoever publishes the link learns nothing about who is
   * about to send it. A link it cannot look at is not an error to show — there is simply no preview.
   */
  private lookAtTheLink(): void {
    const found = /(https?:\/\/\S+)/.exec(input("write").value);
    const preview = element("link-preview");
    if (!found?.[1]) {
      preview.hidden = true;
      this.lookingAt = undefined;
      return;
    }
    const url = found[1];
    if (url === this.lookingAt) return;
    this.lookingAt = url;
    void this.client.media.preview(url).then(
      seen => {
        // Somebody may have typed past it while the homeserver was looking.
        if (this.lookingAt !== url) return;
        preview.textContent = seen.title
          ? `🔗 ${seen.title}${seen.description ? ` — ${seen.description}` : ""}`
          : "";
        preview.hidden = !seen.title;
      },
      () => {
        preview.hidden = true;
      }
    );
  }

  private keepShortly(): void {
    window.clearTimeout(this.keeping);
    this.keeping = window.setTimeout(() => void this.keep(), 500);
  }

  /**
   * Puts away what is in the box, against the conversation it was written in.
   *
   * `movingTo` is given when somebody is on their way somewhere else, because by then what is open has not
   * caught up yet: without it, coming back to a conversation saves the empty box over the draft that is
   * about to be read out of it, and what somebody half wrote is gone the moment they return for it.
   */
  private async keep(movingTo?: ConversationId | undefined): Promise<void> {
    window.clearTimeout(this.keeping);
    const conversationId = this.wasIn;
    this.wasIn = movingTo ?? this.where.openId();
    if (!conversationId) return;
    await this.client.conversations.saveDraft(conversationId, input("write").value).catch(() => undefined);
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

  /** A file goes as itself, not as a line of text with a link in it. */
  private async attach(): Promise<void> {
    const box = input("attachment");
    const chosen = box.files?.[0];
    const conversationId = this.where.openId();
    box.value = "";
    if (!chosen || !conversationId) return;
    try {
      await this.client.messages.sendFile(conversationId, {
        name: chosen.name,
        mimeType: chosen.type || "application/octet-stream",
        data: new Uint8Array(await chosen.arrayBuffer())
      });
    } catch (error) {
      this.where.wentWrong(error);
    }
  }

  private async send(box: HTMLInputElement, threadId: MessageId | undefined): Promise<void> {
    const body = box.value.trim();
    const conversationId = this.where.openId();
    if (!body || !conversationId) return;
    box.value = "";
    this.where.said();
    void this.keep();
    try {
      const answering = this.where.answering();
      await this.client.messages.send(conversationId, body, whatItCarries(body, threadId, answering));
      this.where.stopAnswering();
    } catch (error) {
      // Put back rather than lost: somebody who wrote three lines should not have to write them again.
      box.value = body;
      this.where.wentWrong(error);
    }
  }
}

/** Everything a message carries besides its text, left out entirely where it carries none. */
function whatItCarries(
  body: string,
  threadId: MessageId | undefined,
  replyTo: MessageId | undefined
): SendMessageOptions {
  const formattedBody = asHtml(body);
  const userIds = mentioned(body);
  const carried: { -readonly [Key in keyof SendMessageOptions]?: SendMessageOptions[Key] } = {};
  if (threadId) carried.threadId = threadId;
  if (replyTo) carried.replyTo = replyTo;
  if (formattedBody) carried.formattedBody = formattedBody;
  if (userIds.length > 0) carried.mentions = { userIds };
  return carried;
}
