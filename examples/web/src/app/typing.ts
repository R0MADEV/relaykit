import type { ConversationId, MessagingClient, UserId } from "@relaykit/web";
import { element, input } from "./dom.js";
import type { People } from "./people.js";

/** How long after the last keystroke somebody has stopped typing, which is also what the homeserver is told. */
const stopsAfter = 4000;

/**
 * Saying you are writing, and showing who else is.
 *
 * Told once at the first keystroke and taken back when the typing stops, rather than on every key: the
 * homeserver is being told a state, not sent an event per letter.
 */
export class Typing {
  private stopping: number | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly me: UserId,
    private readonly openId: () => ConversationId | undefined
  ) {}

  wire(): void {
    for (const id of ["write", "thread-write-body"]) {
      input(id).addEventListener("input", () => this.writing());
    }
    this.client.on("typing.changed", update => this.show(update.conversationId, update.userIds));
  }

  /** Sent, or moved somewhere else: either way this person is no longer writing where they were. */
  stop(): void {
    element("typing").textContent = "";
    if (this.stopping === undefined) return;
    window.clearTimeout(this.stopping);
    this.stopping = undefined;
    const conversationId = this.openId();
    if (conversationId) void this.client.conversations.typing(conversationId, false).catch(() => undefined);
  }

  private writing(): void {
    const conversationId = this.openId();
    if (!conversationId) return;
    if (this.stopping === undefined) {
      void this.client.conversations.typing(conversationId, true).catch(() => undefined);
    }
    window.clearTimeout(this.stopping);
    this.stopping = window.setTimeout(() => this.stop(), stopsAfter);
  }

  private show(conversationId: ConversationId, userIds: readonly UserId[]): void {
    if (conversationId !== this.openId()) return;
    const others = userIds.filter(userId => userId !== this.me).map(userId => this.people.nameOf(userId));
    element("typing").textContent = whoIsWriting(others);
  }
}

/** One person writes, several are writing: the line reads as somebody would say it out loud. */
function whoIsWriting(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} está escribiendo…`;
  if (names.length === 2) return `${names[0]} y ${names[1]} están escribiendo…`;
  return `${names.length} personas están escribiendo…`;
}
