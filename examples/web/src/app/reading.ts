import {
  createMessageTimeline,
  type Call,
  type Conversation,
  type ConversationId,
  type Message,
  type MessageId,
  type MessagingClient,
  type LiveTimeline,
  type UserId
} from "@relaykit/web";
import { fetchIfNeeded } from "./attachments.js";
import { paintHead } from "./conversation-head.js";
import { element, onClick } from "./dom.js";
import type { People } from "./people.js";
import { paintTimeline, type Entry } from "./timeline.js";
import { titleOf } from "./sidebar.js";

/** Enough to fill a screen. What the sync happened to bring is not a number anybody chose. */
const enoughToOpenWith = 30;

/**
 * The one conversation somebody is reading: what is in it, how far back it has been read, and how much of it
 * has been seen.
 *
 * All of it together because it is one thing that changes together — a message arriving changes the timeline,
 * what hangs off it, and whether there is anything left unread — and splitting that across screens is how a
 * conversation ends up showing three different moments at once.
 */
export class Reading {
  private conversationId: ConversationId | undefined;
  private timeline: LiveTimeline | undefined;
  private entries: readonly Entry[] = [];
  private threads = new Map<MessageId, number>();
  private more = true;
  private readUpTo: MessageId | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly me: UserId,
    private readonly around: {
      readonly conversations: () => readonly Conversation[];
      /** A call going on in a conversation, and whether this side is already on it. */
      readonly goingIn: (conversationId: ConversationId) => Call | undefined;
      readonly onACallIn: (conversationId: ConversationId) => boolean;
      readonly opened: () => void;
      readonly repaintTheRest: () => void;
      readonly repaintTheThread: () => void;
      readonly closeTheThread: () => void;
      readonly wentWrong: (error: unknown) => void;
    }
  ) {}

  wire(): void {
    element("timeline").addEventListener("scroll", () => void this.scrolled());
    onClick("leave-here", () => void this.leave());
    onClick("accept-invitation", () => void this.acceptInvitation());
    onClick("refuse-invitation", () => void this.leave(true));
  }

  /** Saying yes to an invitation, which is the only way anything in it ever arrives. */
  private async acceptInvitation(): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    try {
      await this.client.conversations.join(conversationId);
      await this.open(conversationId);
    } catch (error) {
      this.around.wentWrong(error);
    }
  }

  openId(): ConversationId | undefined {
    return this.conversationId;
  }

  /** What a conversation is called, for anywhere that has an identifier and needs a name. */
  nameOf(conversationId: ConversationId): string | undefined {
    const known = this.around.conversations().find(each => each.id === conversationId);
    return known ? titleOf(known) : undefined;
  }

  /** One of the messages already on screen, by its identifier. */
  messageCalled(messageId: MessageId): Message | undefined {
    for (const entry of this.entries) {
      if (entry.kind === "message" && entry.message.id === messageId) return entry.message;
    }
    return undefined;
  }

  async open(conversationId: ConversationId): Promise<void> {
    this.conversationId = conversationId;
    this.more = true;
    this.readUpTo = undefined;
    this.around.closeTheThread();
    this.timeline?.stop();
    void this.whatIsAllowed(conversationId);
    const timeline = createMessageTimeline(this.client, conversationId, { atLeast: enoughToOpenWith });
    this.timeline = timeline;
    timeline.subscribe(() => void this.reload());
    this.around.opened();
    await timeline.refresh();
    await this.reload();
    element("timeline").scrollTop = element("timeline").scrollHeight;
  }

  /**
   * Reads the timeline again from the adapter, rather than waiting for a message to arrive.
   *
   * A conversation just joined has no timeline yet: the state comes first and what was said follows, and
   * nothing here is listening for "the room finally has history". So when the conversation says it moved,
   * it is asked again.
   */
  async refresh(): Promise<void> {
    await this.timeline?.refresh();
    await this.reload();
  }

  /** Everything a conversation shows, read together: what was said, the calls that are over, and the threads. */
  async reload(): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    const [over, threads] = await Promise.all([
      this.client.calls.history(conversationId, 20).catch(() => []),
      this.client.messages.threads(conversationId).catch(() => [])
    ]);
    // Whoever is open now, and what is on screen now. Several of these run at once while a conversation is
    // still arriving, and one that started with three messages must not finish last and put the other three
    // back. Reading after asking instead of before means every pass paints what is current when it paints.
    if (this.conversationId !== conversationId) return;
    const messages = this.timeline?.get() ?? [];
    this.threads = new Map(threads.map(thread => [thread.rootId, thread.replyCount]));
    const said: Entry[] = messages.map(message => ({ kind: "message", at: message.createdAt, message }));
    const ended: Entry[] = over.map(call => ({ kind: "call", at: call.endedAt, call }));
    this.entries = [...said, ...ended].sort((left, right) => left.at - right.at);
    this.people.learn(
      messages.map(message => message.senderId),
      conversationId
    );
    this.repaint();
    void this.fetchWhatIsShown(messages);
  }

  /** Whatever is on screen and has not arrived yet, asked for once each, and painted again when it does. */
  private async fetchWhatIsShown(messages: readonly Message[]): Promise<void> {
    const attached = messages.map(message => message.attachment).filter(isThere);
    const arrived = await Promise.all(attached.map(one => fetchIfNeeded(this.client, one)));
    if (arrived.some(Boolean)) this.repaint();
  }

  repaint(): void {
    this.around.repaintTheRest();
    const conversationId = this.conversationId;
    if (!conversationId) return;
    const conversation = this.around.conversations().find(each => each.id === conversationId);
    if (conversation) {
      paintHead(conversation, {
        people: this.people,
        me: this.me,
        going: this.around.goingIn(conversationId),
        onIt: this.around.onACallIn(conversationId)
      });
    }
    paintTimeline(element("timeline"), this.entries, {
      people: this.people,
      me: this.me,
      threads: this.threads,
      nameOf: id => this.nameOf(id),
      answered: messageId => this.messageCalled(messageId)?.body
    });
    this.around.repaintTheThread();
  }

  /**
   * Reaching the top goes back for more, and reaching the bottom says the conversation has been read.
   *
   * Both are what somebody scrolling means, rather than a button they have to find: nobody presses "I have
   * read this", and a badge that never comes down is a badge nobody believes.
   */
  private async scrolled(): Promise<void> {
    const timeline = element("timeline");
    const atTheBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 40;
    if (atTheBottom) this.readIt();
    // Near the top of something there is room to scroll in. A conversation shorter than the screen is
    // already showing all of itself, and asking for more of it on the way in is asking for nothing.
    const isRoomToScroll = timeline.scrollHeight > timeline.clientHeight + 40;
    const nearTheTop = timeline.scrollTop < 60;
    if (!isRoomToScroll || !nearTheTop || !this.more || !this.timeline) return;
    // Held so the conversation does not jump: going back adds above whatever is being read.
    const was = timeline.scrollHeight;
    this.more = await this.timeline.loadMore().catch(() => false);
    await this.reload();
    timeline.scrollTop += timeline.scrollHeight - was;
  }

  /** The newest is on screen, so it has been read. Told once: saying it again on every scroll is noise. */
  private readIt(): void {
    const conversationId = this.conversationId;
    const newest = this.entries.at(-1);
    if (!conversationId || newest?.kind !== "message" || newest.message.id === this.readUpTo) return;
    this.readUpTo = newest.message.id;
    void this.client.messages.markRead(conversationId, newest.message.id).catch(() => undefined);
  }

  /**
   * What this person may do here. Offering to invite somebody to a conversation that will refuse it is worse
   * than not offering: the refusal arrives after they have chosen who to invite.
   */
  private async whatIsAllowed(conversationId: ConversationId): Promise<void> {
    const allowed = await this.client.conversations.permissions(conversationId).catch(() => undefined);
    if (this.conversationId !== conversationId) return;
    element("invite-here").hidden = allowed?.canInvite === false;
  }

  /** Leaving is not undoable in a conversation nobody can be invited back into, so it is asked for. */
  private async leave(refusing = false): Promise<void> {
    const conversationId = this.conversationId;
    if (!conversationId) return;
    // Refusing an invitation is leaving a conversation nothing was ever read in, so nothing is lost by it.
    if (!refusing && !window.confirm("¿Salir de esta conversación?")) return;
    element("more-menu").hidden = true;
    try {
      await this.client.conversations.leave(conversationId);
      this.conversationId = undefined;
      this.around.repaintTheRest();
    } catch (error) {
      this.around.wentWrong(error);
    }
  }
}

function isThere<Thing>(thing: Thing | undefined): thing is Thing {
  return thing !== undefined;
}
