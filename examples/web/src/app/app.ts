import {
  createConversationList,
  type Conversation,
  type ConversationId,
  type MessageId,
  type LiveCollection,
  type Notification,
  type Session
} from "@relaykit/web";
import { Account } from "./account.js";
import { DoingToMessages } from "./doing-to-messages.js";
import { Exploring } from "./exploring.js";
import { CallScreen } from "./call-screen.js";
import { Composing } from "./composing.js";
import { element, input, onClick, pressedIn, sayWhatWentWrong } from "./dom.js";
import { MakingThings } from "./making-things.js";
import { Moderating } from "./moderating.js";
import { People } from "./people.js";
import { ProtectingKeys } from "./protecting-keys.js";
import { Reading } from "./reading.js";
import { Searching } from "./searching.js";
import { Extras } from "./extras.js";
import { Settings } from "./settings.js";
import { Sidebar } from "./sidebar.js";
import { tellAbout, titleWith, worthInterrupting } from "./telling.js";
import { ThreadPanel } from "./thread.js";
import { Typing } from "./typing.js";
import { forgetAndStartOver, SigningIn } from "./signing-in.js";
import { show } from "./views.js";

class Deitu {
  private readonly signingIn = new SigningIn(session => this.enter(session), sayWhatWentWrong);
  private readonly client = this.signingIn.client;
  private me = "";
  private people = new People(this.client, () => this.reading?.repaint());
  private calls: CallScreen | undefined;
  private conversations: LiveCollection<Conversation> | undefined;
  private reading: Reading | undefined;
  private thread: ThreadPanel | undefined;
  private composing: Composing | undefined;
  private making: MakingThings | undefined;
  private typing: Typing | undefined;
  private keys: ProtectingKeys | undefined;
  private searching: Searching | undefined;
  private sidebar: Sidebar | undefined;
  private account: Account | undefined;
  private doing: DoingToMessages | undefined;
  private exploring: Exploring | undefined;

  /** Either straight in with the session kept from last time, or the form until somebody answers it. */
  async open(): Promise<void> {
    await this.signingIn.reopen();
  }

  private async enter(session: Session): Promise<void> {
    this.me = session.userId;
    this.calls = new CallScreen(this.client, this.people, this.me, () => this.backToChat());
    this.calls.wire();
    this.typing = new Typing(this.client, this.people, this.me, () => this.reading?.openId());
    this.typing.wire();
    this.keys = new ProtectingKeys(this.client, this.me, sayWhatWentWrong);
    this.keys.wire();
    this.composing = new Composing(this.client, {
      openId: () => this.reading?.openId(),
      threadRootId: () => this.thread?.rootId(),
      answering: () => this.doing?.answeringWhat(),
      stopAnswering: () => this.doing?.stopAnswering(),
      said: () => this.typing?.stop(),
      wentWrong: sayWhatWentWrong
    });
    this.composing.wire();
    this.searching = new Searching(this.client, this.people, {
      openId: () => this.reading?.openId(),
      nameOf: id => this.reading?.nameOf(id),
      open: id => void this.openConversation(id),
      openAt: (id, messageId) => void this.openConversation(id, messageId)
    });
    this.searching.wire();
    this.thread = new ThreadPanel(this.client, this.people, {
      openId: () => this.reading?.openId(),
      messageCalled: messageId => this.reading?.messageCalled(messageId),
      nameOfOpen: () => element("open-title").textContent ?? ""
    });
    this.thread.wire();
    this.sidebar = new Sidebar({
      people: this.people,
      me: this.me,
      conversations: () => this.conversations?.get() ?? [],
      openId: () => this.reading?.openId(),
      liveIn: () => this.calls?.liveIn() ?? new Set(),
      open: conversationId => void this.openConversation(conversationId)
    });
    this.sidebar.wire();
    this.account = new Account(this.client, this.people, this.me, () => forgetAndStartOver());
    this.account.wire();
    this.account.paintWhoYouAre();
    this.doing = new DoingToMessages(this.client, {
      openId: () => this.reading?.openId(),
      said: messageId => this.reading?.messageCalled(messageId)?.body,
      hangFrom: messageId => this.thread?.open(messageId),
      pin: messageId => extras.pin(messageId),
      conversations: () => this.conversations?.get() ?? [],
      wentWrong: sayWhatWentWrong
    });
    this.doing.wire();
    this.exploring = new Exploring(this.client, {
      joined: conversationId => void this.openConversation(conversationId),
      wentWrong: sayWhatWentWrong
    });
    this.exploring.wire();
    new Moderating(this.client, this.people, {
      openId: () => this.reading?.openId(),
      nameOfOpen: () => element("open-title").textContent ?? ""
    }).wire();
    new Settings(this.client, {
      openId: () => this.reading?.openId(),
      conversations: () => this.conversations?.get() ?? []
    }).wire();
    const extras = new Extras(this.client, this.people, {
      openId: () => this.reading?.openId(),
      leftItAll: () => {
        extras.nowIn(undefined);
        this.reading?.close();
        this.sidebar?.paint();
      },
      wentWrong: sayWhatWentWrong
    });
    extras.wire();
    this.reading = new Reading(this.client, this.people, this.me, {
      filed: conversationId => extras.nowIn(conversationId),
      conversations: () => this.conversations?.get() ?? [],
      goingIn: conversationId => this.calls?.goingIn(conversationId),
      onACallIn: conversationId => Boolean(this.calls?.onACallIn(conversationId)),
      opened: () => this.backToChat(),
      repaintTheRest: () => {
        this.sidebar?.paint();
        this.account?.paintWhoYouAre();
      },
      repaintTheThread: () => void this.thread?.repaint(),
      closeTheThread: () => this.thread?.close(),
      wentWrong: sayWhatWentWrong
    });
    this.reading.wire();
    // Saying you are about, and saying you are not when this window goes away. A dot that never changes is
    // a dot nobody reads.
    void this.client.presence.set({ presence: "online" }).catch(() => undefined);
    document.addEventListener("visibilitychange", () => {
      const presence = document.hidden ? "unavailable" : "online";
      void this.client.presence.set({ presence }).catch(() => undefined);
    });
    this.making = new MakingThings(this.client, this.people, {
      openId: () => this.reading?.openId(),
      opened: conversationId => void this.openConversation(conversationId),
      wentWrong: sayWhatWentWrong
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

  /** Something arrived that deserves attention. Whether it deserves interrupting is a separate question. */
  private tell(arrived: Notification): void {
    const here = { openId: this.reading?.openId(), looking: !document.hidden };
    if (!worthInterrupting(arrived, here)) return;
    tellAbout(
      arrived,
      this.people.nameOf(arrived.senderId),
      () => void this.openConversation(arrived.conversationId)
    );
  }

  /** The first conversation opens on its own, as soon as there is one. Nobody wants to arrive at nothing. */
  private somethingToRead(): void {
    this.sidebar?.paint();
    const waiting = (this.conversations?.get() ?? []).reduce(
      (total, conversation) => total + (conversation.unreadCount ?? 0),
      0
    );
    document.title = titleWith(waiting);
    if (this.reading?.openId()) return;
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
      if (conversation.id === this.reading?.openId()) void this.reading?.refresh();
    });
    this.client.on("sync.changed", status => {
      if (status === "synced") void this.reading?.refresh();
    });
    this.client.on("reaction.added", () => void this.reading?.reload());
    this.client.on("reaction.removed", () => void this.reading?.reload());
    this.client.on("notification", arrived => this.tell(arrived));
    this.client.on("error", sayWhatWentWrong);
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
    // The list is a drawer at narrow widths, and opening a conversation from it puts it away again.
    onClick("drawer", () => element("shell").toggleAttribute("data-list-open"));
    const more = element("more-menu");
    onClick("more-button", () => {
      more.hidden = !more.hidden;
    });
    document.addEventListener("click", event => {
      const inside = event.target instanceof Element && event.target.closest(".head-actions .new");
      if (!inside) more.hidden = true;
    });
    for (const opener of document.querySelectorAll("[data-opens]")) {
      const which = opener instanceof HTMLElement ? opener.dataset.opens : undefined;
      if (!which) continue;
      opener.addEventListener("click", () => {
        menu.hidden = true;
        more.hidden = true;
        if (which === "explore") this.exploring?.open();
        else this.making?.open(which);
      });
    }
    // An invitation card in the timeline is a way into a conversation this account may not be in yet.
    element("timeline").addEventListener("click", event => {
      const conversationId = pressedIn(event, "enters");
      if (conversationId) void this.enterRoomOf(conversationId);
    });
    onClick("open-room", () => void this.openRoom());
    onClick("room-banner-join", () => void this.openRoom());
  }

  // --- rooms ----------------------------------------------------------------

  private async openRoom(): Promise<void> {
    const conversationId = this.reading?.openId();
    if (!conversationId) return;
    await this.calls?.open(conversationId).catch(sayWhatWentWrong);
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
    if (!known) await this.client.conversations.join(conversationId).catch(sayWhatWentWrong);
    await this.openConversation(conversationId);
    await this.openRoom();
  }

  private backToChat(): void {
    show("chat");
    this.reading?.repaint();
  }

  /** Opening a conversation, which is the one thing every part of this asks the shell to do. */
  /** Opening a conversation, at its end or where something was said — which is what a result is for. */
  private async openConversation(conversationId: ConversationId, at?: MessageId): Promise<void> {
    this.typing?.stop();
    element("shell").removeAttribute("data-list-open");
    await this.composing?.moveTo(conversationId);
    await (at ? this.reading?.openAt(conversationId, at) : this.reading?.open(conversationId));
  }
}

void new Deitu().open();
