import {
  createConversationList,
  createMessageTimeline,
  type Conversation,
  type ConversationId,
  type LiveCollection,
  type LiveTimeline,
  type Message,
  type MessageId,
  type Session
} from "@relaykit/web";
import { Account } from "./account.js";
import { CallScreen } from "./call-screen.js";
import { Composing } from "./composing.js";
import { element, input, onClick, pressedIn } from "./dom.js";
import { MakingThings } from "./making-things.js";
import { People } from "./people.js";
import { ProtectingKeys } from "./protecting-keys.js";
import { paintHead } from "./conversation-head.js";
import { Searching } from "./searching.js";
import { Sidebar, titleOf } from "./sidebar.js";
import { ThreadPanel } from "./thread.js";
import { paintTimeline, type Entry } from "./timeline.js";
import { Typing } from "./typing.js";
import { forgetAndStartOver, SigningIn } from "./signing-in.js";
import { show } from "./views.js";

class Deitu {
  private readonly signingIn = new SigningIn(
    session => this.enter(session),
    error => this.wentWrong(error)
  );
  private readonly client = this.signingIn.client;
  private me = "";
  private people = new People(this.client, () => this.repaint());
  private calls: CallScreen | undefined;
  private conversations: LiveCollection<Conversation> | undefined;
  private timeline: LiveTimeline | undefined;
  private openId: ConversationId | undefined;
  private thread: ThreadPanel | undefined;
  private threads = new Map<MessageId, number>();
  private entries: readonly Entry[] = [];
  private making: MakingThings | undefined;
  private typing: Typing | undefined;
  private keys: ProtectingKeys | undefined;
  private searching: Searching | undefined;
  private sidebar: Sidebar | undefined;
  private account: Account | undefined;
  private more = true;
  private readUpTo: MessageId | undefined;

  /** Either straight in with the session kept from last time, or the form until somebody answers it. */
  async open(): Promise<void> {
    await this.signingIn.reopen();
  }

  private async enter(session: Session): Promise<void> {
    this.me = session.userId;
    document.title = `Deitu · ${this.people.nameOf(session.userId)}`;
    this.calls = new CallScreen(this.client, this.people, this.me, () => this.backToChat());
    this.calls.wire();
    this.typing = new Typing(this.client, this.people, this.me, () => this.openId);
    this.typing.wire();
    this.keys = new ProtectingKeys(this.client, this.me, error => this.wentWrong(error));
    this.keys.wire();
    new Composing(this.client, {
      openId: () => this.openId,
      threadRootId: () => this.thread?.rootId(),
      said: () => this.typing?.stop(),
      wentWrong: error => this.wentWrong(error)
    }).wire();
    this.searching = new Searching(this.client, this.people, {
      openId: () => this.openId,
      nameOf: id => this.nameOfConversation(id),
      open: id => void this.openConversation(id)
    });
    this.searching.wire();
    this.thread = new ThreadPanel(this.client, this.people, {
      openId: () => this.openId,
      messageCalled: messageId => this.messageCalled(messageId),
      nameOfOpen: () => element("open-title").textContent ?? ""
    });
    this.thread.wire();
    this.sidebar = new Sidebar({
      people: this.people,
      me: this.me,
      conversations: () => this.conversations?.get() ?? [],
      openId: () => this.openId,
      liveIn: () => this.calls?.liveIn() ?? new Set(),
      open: conversationId => void this.openConversation(conversationId)
    });
    this.sidebar.wire();
    this.account = new Account(this.client, this.people, this.me, () => forgetAndStartOver());
    this.account.wire();
    this.account.paintWhoYouAre();
    this.making = new MakingThings(this.client, this.people, {
      openId: () => this.openId,
      opened: conversationId => void this.openConversation(conversationId),
      wentWrong: error => this.wentWrong(error)
    });
    this.wire();
    // Not waiting: what was here yesterday goes on screen at once, and the rest arrives as the server answers.
    await this.client.start({ waitForSync: false });
    element("sign-in").hidden = true;
    element("shell").hidden = false;
    show("chat");
    const conversations = createConversationList(this.client);
    this.conversations = conversations;
    conversations.subscribe(() => this.somethingToRead());
    // Not awaited on purpose. Catching up on an account with hundreds of conversations keeps the list
    // reloading, and one that is still reloading has not resolved: waiting here is waiting for the sync.
    void conversations.refresh();
    this.listen();
    // Asked once the client is running: a device that cannot read what was said before it has something to
    // offer about it, and that is worth saying before anybody stares at a conversation full of locks.
    void this.keys?.look();
  }

  /** The first conversation opens on its own, as soon as there is one. Nobody wants to arrive at nothing. */
  private somethingToRead(): void {
    this.sidebar?.paint();
    if (this.openId) return;
    const first = this.conversations?.get()[0];
    if (first) void this.openConversation(first.id);
  }

  private listen(): void {
    this.client.on("call.incoming", () => void this.calls?.heard());
    this.client.on("call.changed", () => void this.calls?.heard());
    this.client.on("presence.changed", presence => this.people.heard(presence));
    // What hangs off a conversation — its threads, the calls that are over — is read alongside the timeline.
    // Asked once on the way in, a conversation the homeserver had not finished describing keeps its answer,
    // so it is read again whenever the conversation moves and once catching up is over.
    this.client.on("conversation.updated", conversation => {
      if (conversation.id === this.openId) void this.reload();
    });
    this.client.on("sync.changed", status => {
      if (status === "synced") void this.reload();
    });
    this.client.on("reaction.added", () => void this.reload());
    this.client.on("reaction.removed", () => void this.reload());
    this.client.on("error", error => this.wentWrong(error));
    void this.calls?.heard();
  }

  private wire(): void {
    const menu = element("new-menu");
    onClick("new-button", () => {
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", event => {
      const inside = event.target instanceof Element && event.target.closest(".new");
      if (!inside) menu.hidden = true;
    });
    for (const opener of document.querySelectorAll("[data-opens]")) {
      const which = opener instanceof HTMLElement ? opener.dataset.opens : undefined;
      if (!which) continue;
      opener.addEventListener("click", () => {
        menu.hidden = true;
        this.making?.open(which);
      });
    }

    element("timeline").addEventListener("click", event => this.pressedInTimeline(event));
    onClick("open-room", () => void this.openRoom());
    onClick("room-banner-join", () => void this.openRoom());
    element("timeline").addEventListener("scroll", () => void this.scrolled());
  }

  // --- what is open ---------------------------------------------------------

  private async openConversation(conversationId: ConversationId): Promise<void> {
    this.typing?.stop();
    this.openId = conversationId;
    this.more = true;
    this.readUpTo = undefined;
    this.thread?.close();
    this.timeline?.stop();
    // Enough to fill a screen, rather than whatever the sync happened to bring: a conversation opened with
    // two lines in it looks like a conversation with two lines in it.
    const timeline = createMessageTimeline(this.client, conversationId, { atLeast: 30 });
    this.timeline = timeline;
    timeline.subscribe(() => void this.reload());
    this.backToChat();
    await timeline.refresh();
    await this.reload();
    element("timeline").scrollTop = element("timeline").scrollHeight;
  }

  /** Everything a conversation shows, read together: what was said, the calls that are over, and the threads. */
  private async reload(): Promise<void> {
    const conversationId = this.openId;
    if (!conversationId) return;
    const [over, threads] = await Promise.all([
      this.client.calls.history(conversationId, 20).catch(() => []),
      this.client.messages.threads(conversationId).catch(() => [])
    ]);
    // Whoever is open now, and what is on screen now. Several of these run at once while a conversation is
    // still arriving, and one that started with three messages must not finish last and put the other three
    // back. Reading after asking instead of before means every pass paints what is current when it paints.
    if (this.openId !== conversationId) return;
    const messages = this.timeline?.get() ?? [];
    this.threads = new Map(threads.map(thread => [thread.rootId, thread.replyCount]));
    const said: Entry[] = messages.map(message => ({ kind: "message", at: message.createdAt, message }));
    const ended: Entry[] = over.map(call => ({ kind: "call", at: call.endedAt, call }));
    this.entries = [...said, ...ended].sort((left, right) => left.at - right.at);
    this.people.learn(messages.map(message => message.senderId));
    this.repaint();
  }

  private repaint(): void {
    this.sidebar?.paint();
    this.account?.paintWhoYouAre();
    const conversationId = this.openId;
    if (!conversationId) return;
    const conversation = this.conversations?.get().find(each => each.id === conversationId);
    if (conversation) {
      paintHead(conversation, {
        people: this.people,
        me: this.me,
        going: this.calls?.goingIn(conversationId),
        onIt: Boolean(this.calls?.onACallIn(conversationId))
      });
    }
    paintTimeline(element("timeline"), this.entries, {
      people: this.people,
      threads: this.threads,
      nameOf: id => this.nameOfConversation(id)
    });
    void this.thread?.repaint();
  }

  /** What a conversation is called, for anywhere that has an identifier and needs a name. */
  private nameOfConversation(conversationId: ConversationId): string | undefined {
    const known = this.conversations?.get().find(each => each.id === conversationId);
    return known ? titleOf(known, this.people, this.me) : undefined;
  }

  // --- talking --------------------------------------------------------------

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
    if (timeline.scrollTop > 60 || !this.more || !this.timeline) return;
    // Held so the conversation does not jump: going back adds above whatever is being read.
    const was = timeline.scrollHeight;
    this.more = await this.timeline.loadMore().catch(() => false);
    await this.reload();
    timeline.scrollTop += timeline.scrollHeight - was;
  }

  /** The newest is on screen, so it has been read. Told once: saying it again on every scroll is noise. */
  private readIt(): void {
    const conversationId = this.openId;
    const newest = this.entries.at(-1);
    if (!conversationId || newest?.kind !== "message" || newest.message.id === this.readUpTo) return;
    this.readUpTo = newest.message.id;
    void this.client.messages.markRead(conversationId, newest.message.id).catch(() => undefined);
  }

  private pressedInTimeline(event: Event): void {
    const rootId = pressedIn(event, "opens-thread");
    if (rootId) return this.thread?.open(rootId);
    const entersId = pressedIn(event, "enters");
    if (entersId) return void this.enterRoomOf(entersId);
    const messageId = pressedIn(event, "reacts");
    const key = pressedIn(event, "key");
    if (messageId && key && this.openId) {
      void this.client.reactions.add(this.openId, messageId, key).catch(error => this.wentWrong(error));
    }
  }

  /** One of the messages already on screen, by its identifier. */
  private messageCalled(messageId: MessageId): Message | undefined {
    for (const entry of this.entries) {
      if (entry.kind === "message" && entry.message.id === messageId) return entry.message;
    }
    return undefined;
  }

  // --- rooms ----------------------------------------------------------------

  private async openRoom(): Promise<void> {
    const conversationId = this.openId;
    if (!conversationId) return;
    await this.calls?.open(conversationId).catch(error => this.wentWrong(error));
    this.calls?.bringBack();
    await this.showTheLink(conversationId);
  }

  /** An invitation somebody can be handed: the same matrix.to link any other client understands. */
  private async showTheLink(conversationId: ConversationId): Promise<void> {
    const link = await this.client.conversations.link(conversationId).catch(() => "");
    input("invite-link").value = link;
  }

  private async enterRoomOf(conversationId: ConversationId): Promise<void> {
    const known = this.conversations?.get().some(each => each.id === conversationId);
    if (!known) await this.client.conversations.join(conversationId).catch(error => this.wentWrong(error));
    await this.openConversation(conversationId);
    await this.openRoom();
  }

  private backToChat(): void {
    show("chat");
    this.repaint();
  }

  private wentWrong(error: unknown): undefined {
    const said = error instanceof Error ? error.message : String(error);
    const where = element("sign-in-wrong");
    where.textContent = said;
    where.hidden = false;
    window.setTimeout(() => (where.hidden = true), 6000);
    return undefined;
  }
}

void new Deitu().open();
