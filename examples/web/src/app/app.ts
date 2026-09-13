import {
  createConversationList,
  createMessageTimeline,
  type Conversation,
  type ConversationId,
  type LiveCollection,
  type Message,
  type MessageId,
  type Session
} from "@relaykit/web";
import { CallScreen } from "./call-screen.js";
import { element, input, onClick, onSubmit, pressedIn } from "./dom.js";
import { MakingThings } from "./making-things.js";
import { People } from "./people.js";
import { isBetweenTwo, onePerPerson, paintChannels, paintDirects, titleOf } from "./sidebar.js";
import { paintThread } from "./thread.js";
import { paintTimeline, type Entry } from "./timeline.js";
import { SigningIn } from "./signing-in.js";
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
  private timeline: LiveCollection<Message> | undefined;
  private openId: ConversationId | undefined;
  private threadRootId: MessageId | undefined;
  private threads = new Map<MessageId, number>();
  private entries: readonly Entry[] = [];
  private making: MakingThings | undefined;

  /** Either straight in with the session kept from last time, or the form until somebody answers it. */
  async open(): Promise<void> {
    await this.signingIn.reopen();
  }

  private async enter(session: Session): Promise<void> {
    this.me = session.userId;
    document.title = `Deitu · ${this.people.nameOf(session.userId)}`;
    this.calls = new CallScreen(this.client, this.people, this.me, () => this.backToChat());
    this.calls.wire();
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
  }

  /** The first conversation opens on its own, as soon as there is one. Nobody wants to arrive at nothing. */
  private somethingToRead(): void {
    this.paintSidebar();
    if (this.openId) return;
    const first = this.conversations?.get()[0];
    if (first) void this.openConversation(first.id);
  }

  private listen(): void {
    this.client.on("call.incoming", () => void this.calls?.heard());
    this.client.on("call.changed", () => void this.calls?.heard());
    this.client.on("presence.changed", presence => this.people.heard(presence));
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

    element("lists").addEventListener("click", event => {
      const conversationId = pressedIn(event, "conversation");
      if (conversationId) void this.openConversation(conversationId);
    });
    element("timeline").addEventListener("click", event => this.pressedInTimeline(event));
    onClick("thread-close", () => this.closeThread());
    onClick("open-room", () => void this.openRoom());
    onClick("room-banner-join", () => void this.openRoom());
    onSubmit("composer", () => void this.say(input("write"), undefined));
    onSubmit("thread-write", () => void this.say(input("thread-write-body"), this.threadRootId));
    input("search").addEventListener("input", () => this.paintSidebar());
  }

  // --- what is open ---------------------------------------------------------

  private async openConversation(conversationId: ConversationId): Promise<void> {
    this.openId = conversationId;
    this.closeThread();
    this.timeline?.stop();
    const timeline = createMessageTimeline(this.client, conversationId);
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
    const messages = this.timeline?.get() ?? [];
    const [over, threads] = await Promise.all([
      this.client.calls.history(conversationId, 20).catch(() => []),
      this.client.messages.threads(conversationId).catch(() => [])
    ]);
    this.threads = new Map(threads.map(thread => [thread.rootId, thread.replyCount]));
    const said: Entry[] = messages.map(message => ({ kind: "message", at: message.createdAt, message }));
    const ended: Entry[] = over.map(call => ({ kind: "call", at: call.endedAt, call }));
    this.entries = [...said, ...ended].sort((left, right) => left.at - right.at);
    this.people.learn(messages.map(message => message.senderId));
    this.repaint();
  }

  private repaint(): void {
    this.paintSidebar();
    const conversationId = this.openId;
    if (!conversationId) return;
    const conversation = this.conversations?.get().find(each => each.id === conversationId);
    if (conversation) this.paintHead(conversation);
    paintTimeline(element("timeline"), this.entries, { people: this.people, threads: this.threads });
    void this.paintThread();
  }

  private paintHead(conversation: Conversation): void {
    const name = titleOf(conversation, this.people, this.me);
    element("open-title").textContent = isBetweenTwo(conversation) ? name : `# ${name}`;
    element("open-topic").textContent = conversation.topic ?? "";
    // The identifier is not an address anybody can use, so a conversation without an alias says nothing.
    element("open-address").textContent = conversation.alias ?? "";
    const people = element("open-people");
    people.innerHTML = `<span aria-hidden="true">◍</span> ${conversation.participantIds.length}`;
    people.hidden = false;
    element("foot").textContent = conversation.isEncrypted
      ? "Matrix · cifrado extremo a extremo"
      : "Matrix · sin cifrar";
    input("write").placeholder = `Escribe en ${isBetweenTwo(conversation) ? name : `#${name}`}…`;
    const going = this.calls?.goingIn(conversation.id);
    element("room-banner").hidden = !going || Boolean(this.calls?.onACallIn(conversation.id));
    element("room-banner-who").textContent = `${going?.participants.length ?? 0} participantes`;
  }

  private paintSidebar(): void {
    const all = this.conversations?.get() ?? [];
    const query = input("search").value.trim().toLowerCase();
    const shown = query
      ? all.filter(each => titleOf(each, this.people, this.me).toLowerCase().includes(query))
      : all;
    const where = {
      people: this.people,
      me: this.me,
      openId: this.openId,
      live: this.calls?.liveIn() ?? new Set<ConversationId>()
    };
    paintChannels(
      element("channels"),
      shown.filter(each => !isBetweenTwo(each)),
      where
    );
    paintDirects(element("directs"), onePerPerson(shown.filter(isBetweenTwo), this.me), where);
    // A conversation with no name of its own is called by who is in it, so those names have to be known.
    for (const conversation of all) {
      if (conversation.title ?? conversation.alias) continue;
      this.people.learn(conversation.participantIds.slice(0, 4), conversation.id);
    }
  }

  // --- talking --------------------------------------------------------------

  private async say(where: HTMLInputElement, threadId: MessageId | undefined): Promise<void> {
    const body = where.value.trim();
    const conversationId = this.openId;
    if (!body || !conversationId) return;
    where.value = "";
    const options = threadId ? { threadId } : {};
    await this.client.messages.send(conversationId, body, options).catch(error => this.wentWrong(error));
  }

  private pressedInTimeline(event: Event): void {
    const rootId = pressedIn(event, "opensThread");
    if (rootId) return this.openThread(rootId);
    const entersId = pressedIn(event, "enters");
    if (entersId) return void this.enterRoomOf(entersId);
    const messageId = pressedIn(event, "reacts");
    const key = pressedIn(event, "key");
    if (messageId && key && this.openId) {
      void this.client.reactions.add(this.openId, messageId, key).catch(error => this.wentWrong(error));
    }
  }

  private openThread(rootId: MessageId): void {
    this.threadRootId = rootId;
    element("thread").hidden = false;
    element("thread-where").textContent = element("open-title").textContent;
    void this.paintThread();
  }

  private closeThread(): void {
    this.threadRootId = undefined;
    element("thread").hidden = true;
  }

  private async paintThread(): Promise<void> {
    const rootId = this.threadRootId;
    const conversationId = this.openId;
    if (!rootId || !conversationId) return;
    const messages = await this.client.messages.thread(conversationId, rootId).catch(() => []);
    paintThread(element("thread-body"), messages, this.people);
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
