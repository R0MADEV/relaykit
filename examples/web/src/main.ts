import {
  MessagingClient,
  createConversationList,
  createMessageTimeline,
  type Attachment,
  type Call,
  type Conversation,
  type ConversationId,
  type LiveCollection,
  type MediaRef,
  type Message,
  type Poll,
  type Session,
  type VoiceInfo
} from "@relaykit/web";

const typingTimeoutMs = 4000;

/**
 * Where this example keeps the session so opening it again does not ask who you are. A real application decides
 * this for itself: an access token in local storage is readable by anything that can run script on the page.
 */
const rememberedSession = "relaykit-demo-session";

class DemoApp {
  readonly client = buildClient();
  private conversationId: ConversationId | undefined;
  /** What is being shared right now, so the same button can stop it. */
  private sharingId: string | undefined;
  /** The call going on, so the same panel can answer it, silence it, hold it or hang it up. */
  private call: Call | undefined;
  private recorder: MediaRecorder | undefined;
  private previewedUrl: string | undefined;
  private ownUserId: string | undefined;
  private stopTypingTimer: number | undefined;
  private conversations: LiveCollection<Conversation> | undefined;
  private timeline: LiveCollection<Message> | undefined;
  private readonly names = new Map<string, string>();
  private replyTo: Message | undefined;

  constructor() {
    this.bindForms();
    this.listen();
    this.element("load-more").addEventListener("click", () => void this.loadMore());
    this.element("invite").addEventListener("click", () => void this.inviteParticipant());
    this.element("rename").addEventListener("click", () => void this.renameConversation());
    this.element("leave").addEventListener("click", () => void this.leaveConversation());
    this.element("favourite").addEventListener("click", () => void this.toggleFavourite());
    this.element("kick").addEventListener("click", () => void this.removeParticipant());
    this.element("register").addEventListener("click", () => void this.registerAccount());
    this.element("rename-me").addEventListener("click", () => void this.renameMyself());
    this.element("topic").addEventListener("click", () => void this.changeTopic());
    this.element("mute").addEventListener("click", () => void this.cycleNotifications());
    this.element("pinned").addEventListener("click", () => void this.showPinned());
    this.element("place").addEventListener("click", () => void this.sendPlace());
    // A tab nobody is looking at could let its connection go, but a client cannot be started twice in the same
    // page: the encryption cannot be set up again over the same store, and the page goes down. Left alone on
    // purpose; the browser already slows down what a hidden tab is doing.
    this.element("door").addEventListener("click", () => void this.cycleJoinRule());
    this.element("discover").addEventListener("click", () => void this.discover());
    this.element("call").addEventListener("click", () => void this.callThem(false));
    this.element("video-call").addEventListener("click", () => void this.callThem(true));
    // Walking into a call already going on in this conversation, without ringing anybody.
    this.element("join-call").addEventListener("click", () => void this.joinThem());
    this.element("answer").addEventListener("click", () => void this.answerThem());
    this.element("reject").addEventListener(
      "click",
      () => void this.duringTheCall((call, client) => client.calls.reject(call.id))
    );
    this.element("hang-up").addEventListener("click", () => void this.hangUp());
    // Every one of these is the same shape: whatever it is now, the other way round.
    this.element("call-mute").addEventListener(
      "click",
      () =>
        void this.duringTheCall((call, client) =>
          client.calls.muteMicrophone(call.id, !call.isMicrophoneMuted)
        )
    );
    this.element("call-camera").addEventListener(
      "click",
      () => void this.duringTheCall((call, client) => client.calls.muteCamera(call.id, !call.isCameraMuted))
    );
    this.select("microphone").addEventListener("change", () => void this.chooseDevice("microphone"));
    this.select("camera").addEventListener("change", () => void this.chooseDevice("camera"));
    this.element("call-screen").addEventListener(
      "click",
      () =>
        void this.duringTheCall((call, client) => client.calls.shareScreen(call.id, !call.isSharingScreen))
    );
    // A form, not a prompt: it works with a keyboard, it can be translated and it can be tested.
    this.element("poll").addEventListener("click", () => {
      const form = this.element("poll-form");
      form.hidden = !form.hidden;
      if (!form.hidden) this.input("poll-question").focus();
    });
    this.element("poll-form").addEventListener("submit", event => {
      event.preventDefault();
      void this.askSomething();
    });
    this.element("live-location").addEventListener("click", () => void this.shareWhereIAm());
    this.element("record").addEventListener("click", () => void this.recordVoice());
    this.element("sticker").addEventListener("click", () => void this.sendSticker());
    // Typing a link looks at what is behind it, so nobody has to open it blind.
    this.input("message").addEventListener("input", () => this.lookAtTheLink());
  }

  private bindForms(): void {
    this.onSubmit("login-form", () => this.login());
    this.onSubmit("open-form", () => this.openConversation());
    this.onSubmit("search-form", () => this.refreshConversations());
    this.onSubmit("message-form", () => this.sendMessage());
    this.onSubmit("file-form", () => this.sendFile());
    this.input("message").addEventListener("input", () => {
      this.notifyTyping();
      void this.rememberDraft();
    });
    this.select("username").addEventListener("change", () => {
      this.input("password").value = `${this.select("username").value}-password`;
    });
    // Closing or reloading the page in the middle of a call: a last word to the others, as far as the browser
    // lets one be said. The homeserver's delayed events take the membership down anyway if this does not land.
    window.addEventListener("pagehide", () => {
      if (this.call) void this.client.calls.hangUp(this.call.id).catch(() => undefined);
    });
    // The way out. The session is forgotten here and on the homeserver, and the page starts over.
    this.element("sign-out").addEventListener("click", () => {
      localStorage.removeItem(rememberedSession);
      void this.client.logout().finally(() => location.reload());
    });
  }

  private async login(): Promise<void> {
    const button = this.element("login-form").querySelector("button");
    if (button) button.disabled = true;
    try {
      const session = await this.client.login({
        homeserver: this.input("homeserver").value,
        username: this.select("username").value,
        password: this.input("password").value,
        deviceName: "RelayKit Example"
      });
      localStorage.setItem(rememberedSession, JSON.stringify(session));
      await this.enter(session.userId);
    } catch (error) {
      this.showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  /** Everything this screen listens to. Said again whenever the client is a new one. */
  private listen(): void {
    this.client.on("connection.changed", status => this.setStatus(status));
    this.client.on("sync.changed", status => {
      if (status === "synced") void this.refreshConversations();
    });
    // An invitation that turns up while the application is open is accepted as one that was waiting at the
    // start: otherwise somebody invited and immediately rung is never rung, because they are not in yet.
    this.client.on("conversation.updated", conversation => {
      if (conversation.membership !== "invite") return;
      void this.client.conversations.join(conversation.id).catch(() => undefined);
    });
    this.client.on("typing.changed", update => this.showTyping(update.conversationId, update.userIds));
    this.client.on("notification", notification =>
      this.setStatus(
        `${this.nameOf(notification.senderId)}${notification.isMention ? " te menciona" : ""}: ${notification.body}`
      )
    );
    // Somebody calling is not something to be asked for: it arrives, and the screen has to ring.
    // Everything about calls is drawn again from what is going on, rather than from what the last event said.
    // A phone on a desk holds several at once, they end in any order, and keeping a note here of which one is
    // being talked on means keeping it right through every one of those — which it was not: a note left
    // pointing at a call that had ended made the next one arrive to a screen that thought it was busy.
    this.client.on("call.incoming", () => void this.drawTheCalls());
    this.client.on("call.changed", () => void this.drawTheCalls());
    // Who is talking lights a border and nothing else: this arrives several times a second.
    this.client.on("call.speaking", ({ userIds }) => {
      for (const box of this.element("participants").querySelectorAll("figure")) {
        box.classList.toggle("speaking", userIds.includes(box.dataset.user ?? ""));
      }
    });
    this.client.on("error", error => this.setStatus(`Error: ${error.message}`));
  }

  /** Opening it again with a session already here: straight in, without asking anything. */
  async reopen(): Promise<void> {
    const kept = readRememberedSession();
    if (!kept) return;
    try {
      await this.enter(kept.userId);
    } catch (error) {
      // A session that is no longer good is not worth keeping, and the sign in form is the way back. The
      // client may have started before whatever went wrong, and one that is running refuses to sign in again:
      // leaving it like that means the form is there and does nothing.
      localStorage.removeItem(rememberedSession);
      await this.client.stop().catch(() => undefined);
      this.element("app").hidden = true;
      delete document.body.dataset.signedIn;
      this.showError(error);
    }
  }

  private async enter(userId: string): Promise<void> {
    this.ownUserId = userId;
    // Said out loud and put in the tab: two windows of this on one machine are otherwise indistinguishable.
    this.element("who-am-i").textContent = userId;
    paintAvatar(this.element("me-avatar"), userId);
    document.body.dataset.signedIn = "true";
    document.title = `RelayKit · ${userId}`;
    void this.fillInDevices();
    // Somebody other than yourself to talk to, whoever you turned out to be.
    const others = [...this.select("participant").options].map(option => option.value);
    this.select("participant").value = others.find(other => other !== userId) ?? others[0] ?? "";
    // Not waiting: what was here yesterday goes on screen at once, and the list updates as the server answers.
    await this.client.start({ waitForSync: false });
    const conversations = createConversationList(this.client);
    this.conversations = conversations;
    conversations.subscribe(() => {
      if (!this.input("search").value.trim()) this.renderConversations(conversations.get());
    });
    this.element("app").hidden = false;
    await this.refreshConversations();
    // Joining runs after the list is on screen, so a bad invitation never leaves the user staring at nothing.
    void this.acceptInvitations();
  }

  private async acceptInvitations(): Promise<void> {
    const conversations = await this.client.conversations.list();
    const invitations = conversations.filter(conversation => conversation.membership === "invite");
    for (const invitation of invitations) {
      // An invitation to a room nobody is in any more cannot be joined, and must not stop the others.
      await this.client.conversations.join(invitation.id).catch(() => undefined);
    }
    if (invitations.length > 0) await this.refreshConversations();
  }

  private async refreshConversations(): Promise<void> {
    const query = this.input("search").value.trim();
    if (query) {
      this.renderConversations(await this.client.conversations.search(query));
      return;
    }
    await this.conversations?.refresh();
    this.renderConversations(this.conversations?.get() ?? []);
  }

  private renderConversations(conversations: readonly Conversation[]): void {
    this.element("conversations").replaceChildren(
      ...conversations.map(conversation => this.conversationItem(conversation))
    );
  }

  private conversationItem(conversation: Conversation): HTMLLIElement {
    const item = document.createElement("li");
    item.setAttribute("aria-current", String(conversation.id === this.conversationId));
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    const name = document.createElement("span");
    name.className = "name";
    const pending = new Set(conversation.invitedIds ?? []);
    const others = this.otherParticipants(conversation).map(
      participantId =>
        `${this.nameOf(participantId, conversation.id)}${pending.has(participantId) ? " (pendiente)" : ""}`
    );
    name.textContent = conversation.title ?? (others.length > 0 ? others.join(", ") : conversation.id);
    paintAvatar(avatar, name.textContent);
    const preview = document.createElement("span");
    preview.className = "preview";
    preview.textContent = `${conversation.isFavourite ? "★ " : ""}${conversation.lastMessage?.body ?? "Sin mensajes"}`;
    item.append(avatar, name, preview);
    if (conversation.unreadCount) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(conversation.unreadCount);
      item.append(badge);
    }
    item.addEventListener("click", () => void this.selectConversation(conversation.id));
    return item;
  }

  private otherParticipants(conversation: Conversation): string[] {
    return conversation.participantIds.filter(participantId => participantId !== this.ownUserId);
  }

  /** Shows the user id until the profile arrives, then repaints whatever is already on screen. */
  private nameOf(userId: string, conversationId?: ConversationId): string {
    const key = conversationId ? `${conversationId}/${userId}` : userId;
    const known = this.names.get(key);
    if (known !== undefined) return known;
    this.names.set(key, userId);
    void this.client.users
      .profile(userId, conversationId)
      .then(profile => {
        const resolved = profile.displayName ?? userId;
        if (resolved === userId) return;
        this.names.set(key, resolved);
        void this.refreshConversations();
        if (this.timeline) this.renderTimeline(this.timeline.get());
      })
      .catch(() => undefined);
    return userId;
  }

  private async openConversation(): Promise<void> {
    try {
      const conversation = await this.client.conversations.open(this.select("participant").value);
      await this.selectConversation(conversation.id);
      await this.refreshConversations();
    } catch (error) {
      this.showError(error);
    }
  }

  private async selectConversation(conversationId: ConversationId): Promise<void> {
    this.conversationId = conversationId;
    this.timeline?.stop();
    this.clearReply();
    this.element("empty").hidden = true;
    this.element("timeline").hidden = false;
    // Which conversation is on screen, so anything driving this page knows what it is looking at.
    this.element("timeline").dataset["conversation"] = conversationId;
    this.element("conversation-actions").hidden = false;
    this.showTopic();
    void this.restoreDraft();
    const footer = document.querySelector("footer");
    if (footer) footer.hidden = false;
    const timeline = createMessageTimeline(this.client, conversationId);
    this.timeline = timeline;
    timeline.subscribe(() => this.renderTimeline(timeline.get()));
    try {
      await timeline.refresh();
      this.renderTimeline(timeline.get());
      await this.markLastAsRead(timeline.get());
      await this.refreshConversations();
      // Polls live apart from the timeline, so they are asked for when the conversation opens.
      await this.showPolls();
    } catch (error) {
      this.showError(error);
    }
  }

  private renderTimeline(messages: readonly Message[]): void {
    const timeline = this.element("timeline");
    // The line goes right after the last message this person had read, which the conversation remembers.
    const lastRead = this.conversations
      ?.get()
      .find(item => item.id === this.conversationId)?.lastReadMessageId;
    const lastReadIndex = lastRead ? messages.findIndex(message => message.id === lastRead) : -1;
    const drawn: Node[] = [this.element("load-more")];
    messages.forEach((message, index) => {
      const newMessagesStartHere = index === lastReadIndex + 1 && lastReadIndex !== -1;
      if (newMessagesStartHere) {
        const line = document.createElement("div");
        line.className = "unread-line";
        line.textContent = "mensajes nuevos";
        drawn.push(line);
      }
      // The same person, a moment later, and nothing between: one name and one face for the run of them.
      const previous = messages[index - 1];
      const continued =
        previous !== undefined &&
        !newMessagesStartHere &&
        previous.senderId === message.senderId &&
        message.createdAt - previous.createdAt < 5 * 60 * 1000 &&
        !message.replyToId;
      drawn.push(this.messageElement(message, messages, continued));
    });
    timeline.replaceChildren(...drawn);
    timeline.scrollTop = timeline.scrollHeight;
  }

  private messageElement(message: Message, all: readonly Message[], continued = false): HTMLElement {
    const item = document.createElement("article");
    const faded = message.deletedAt || message.undecryptable ? " deleted" : "";
    const kind = message.kind ? ` ${message.kind}` : "";
    const run = continued ? " continued" : "";
    item.className = `message${message.senderId === this.ownUserId ? " own" : ""}${faded}${kind}${run}`;
    // Said as data and not only as words: whatever reads the screen to know whether a message went out must
    // not depend on how that is phrased, or on it being phrased at all.
    item.dataset.status = message.status;
    // Who, and when, above what: the face with initials until there is a real one.
    const sender = this.nameOf(message.senderId, message.conversationId);
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    paintAvatar(avatar, sender);
    const author = document.createElement("div");
    author.className = "author";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = sender;
    const when = document.createElement("time");
    when.dateTime = new Date(message.createdAt).toISOString();
    when.textContent = timeOf(message.createdAt);
    author.append(who, when);
    const children: (Node | string)[] = [avatar, author];
    if (message.replyToId) {
      const quoted = document.createElement("div");
      quoted.className = "quote";
      quoted.textContent = all.find(other => other.id === message.replyToId)?.body ?? "Mensaje anterior";
      children.push(quoted);
    }
    // A sticker draws itself: the image and nothing else, no file name and no download button.
    if (message.kind === "sticker" && message.attachment && !message.deletedAt) {
      const sticker = document.createElement("img");
      sticker.alt = message.body;
      void this.paintImage(sticker, message.attachment);
      item.replaceChildren(avatar, author, sticker);
      return item;
    }
    const body = document.createElement("div");
    if (message.undecryptable) body.textContent = "Mensaje cifrado que este dispositivo no puede leer";
    else body.textContent = message.deletedAt ? "Mensaje eliminado" : message.body;
    children.push(body);
    if (message.attachment?.mimeType.startsWith("image/") && !message.deletedAt) {
      children.push(this.imageWithBlur(message.attachment));
    }
    if (message.attachment?.voice && !message.deletedAt) {
      children.push(drawWaveform(message.attachment.voice));
    }
    const place = message.location;
    if (place && !message.deletedAt) {
      // A place is a link to a map, so it is not read as a line of numbers in the middle of the conversation.
      const link = document.createElement("a");
      link.href = `https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `📍 ${place.description ?? `${place.latitude}, ${place.longitude}`}`;
      children.push(link);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    // Delivered is the normal case and says nothing; what is worth a word is a message still on its way, or
    // one that failed, or one that was changed.
    const worthSaying = [
      ...(message.status === "sent" ? [] : [message.status]),
      ...(message.editedAt ? ["editado"] : [])
    ];
    if (worthSaying.length > 0) meta.append(worthSaying.join(" · "));
    const attachment = message.attachment;
    if (attachment?.voice) {
      meta.append(`🎤 ${Math.round(attachment.voice.durationMs / 1000)}s`);
    }
    if (attachment?.source) {
      meta.append(this.button("Descargar", () => void this.download(attachment, attachment.name)));
    }
    if (attachment?.thumbnail) {
      const thumbnail = attachment.thumbnail;
      meta.append(
        this.button("Vista previa", () => void this.download(thumbnail, `preview-${attachment.name}`))
      );
    }
    if (!message.deletedAt && !message.undecryptable) {
      meta.append(this.button("Responder", () => this.startReply(message)));
      meta.append(this.button("Fijar", () => void this.pin(message)));
      meta.append(this.button("Reenviar", () => void this.forward(message)));
      if (message.senderId !== this.ownUserId) {
        meta.append(this.button("Denunciar", () => void this.report(message)));
      }
    }
    if (message.status === "failed") {
      meta.append(
        this.button(
          "Reintentar",
          () => void this.client.messages.retry(message.id).catch(error => this.showError(error))
        )
      );
      meta.append(
        this.button(
          "Cancelar",
          () => void this.client.messages.cancel(message.id).catch(error => this.showError(error))
        )
      );
    }
    item.replaceChildren(...children, meta);
    return item;
  }

  private async markLastAsRead(messages: readonly Message[]): Promise<void> {
    const last = messages.at(-1);
    if (!last || !this.conversationId) return;
    await this.client.messages.markRead(this.conversationId, last.id);
  }

  private async loadMore(): Promise<void> {
    if (!this.conversationId) return;
    try {
      const page = await this.client.messages.loadMore(this.conversationId, 20);
      this.renderTimeline(page.messages);
      this.element("load-more").hidden = !page.hasMore;
    } catch (error) {
      this.showError(error);
    }
  }

  private async registerAccount(): Promise<void> {
    const username = window.prompt("Nombre de la cuenta nueva", `persona-${Date.now()}`);
    if (!username) return;
    try {
      await this.client.register({
        homeserver: this.input("homeserver").value,
        username,
        password: this.input("password").value,
        deviceName: "RelayKit Example"
      });
      this.setStatus(`Cuenta ${username} creada, ya puedes conectar`);
    } catch (error) {
      this.showError(error);
    }
  }

  private async renameMyself(): Promise<void> {
    const displayName = window.prompt("¿Cómo quieres que te vean?");
    if (!displayName) return;
    try {
      await this.client.users.setDisplayName(displayName);
      this.names.clear();
      await this.refreshConversations();
    } catch (error) {
      this.showError(error);
    }
  }

  private async changeTopic(): Promise<void> {
    if (!this.conversationId) return;
    const current = this.conversations?.get().find(item => item.id === this.conversationId);
    const topic = window.prompt("¿De qué habláis aquí?", current?.topic ?? "");
    if (topic === null) return;
    try {
      await this.client.conversations.setTopic(this.conversationId, topic);
      await this.refreshConversations();
      this.showTopic();
    } catch (error) {
      this.showError(error);
    }
  }

  /** The three settings in a row, so a single button covers all of them. */
  private async cycleNotifications(): Promise<void> {
    if (!this.conversationId) return;
    const order = ["all", "mentions", "none"] as const;
    const current =
      this.conversations?.get().find(item => item.id === this.conversationId)?.notifications ?? "all";
    const next = order[(order.indexOf(current) + 1) % order.length] ?? "all";
    try {
      await this.client.conversations.setNotifications(this.conversationId, next);
      await this.refreshConversations();
      const said = { all: "Suena siempre", mentions: "Solo cuando te nombran", none: "En silencio" };
      this.setStatus(said[next]);
    } catch (error) {
      this.showError(error);
    }
  }

  /** Passing a message on: the demo asks which conversation by number, which is enough to show it works. */
  private async forward(message: Message): Promise<void> {
    const others = (this.conversations?.get() ?? []).filter(item => item.id !== this.conversationId);
    if (others.length === 0) {
      this.setStatus("No hay otra conversacion a la que reenviarlo");
      return;
    }
    const menu = others.map((item, index) => `${index + 1}. ${item.title ?? item.id}`).join("\n");
    const answer = window.prompt(`¿A cual lo reenvias?\n${menu}`, "1");
    const chosen = others[Number(answer) - 1];
    if (!chosen) return;
    try {
      await this.client.messages.forward(message.id, chosen.id);
      this.setStatus(`Reenviado a ${chosen.title ?? chosen.id}`);
    } catch (error) {
      this.showError(error);
    }
  }

  private async report(message: Message): Promise<void> {
    const reason = window.prompt("¿Que pasa con este mensaje?");
    if (!reason) return;
    try {
      await this.client.messages.report(message.id, reason);
      this.setStatus("Denunciado a quien administra el servidor");
    } catch (error) {
      this.showError(error);
    }
  }

  /** The public list of the homeserver, which is how somebody finds a conversation nobody invited them to. */
  private async discover(): Promise<void> {
    const query = window.prompt("¿Que buscas?") ?? "";
    try {
      const found = await this.client.conversations.discover(query);
      if (found.length === 0) {
        this.setStatus("No hay ninguna conversacion publica con ese nombre");
        return;
      }
      const menu = found
        .map((item, index) => `${index + 1}. ${item.title ?? item.alias ?? item.id}`)
        .join("\n");
      const answer = window.prompt(`¿A cual entras?\n${menu}`, "1");
      const chosen = found[Number(answer) - 1];
      if (!chosen) return;
      await this.client.conversations.join(chosen.id);
      await this.refreshConversations();
      await this.selectConversation(chosen.id);
    } catch (error) {
      this.showError(error);
    }
  }

  private async pin(message: Message): Promise<void> {
    if (!this.conversationId) return;
    try {
      await this.client.conversations.pin(this.conversationId, message.id);
      this.setStatus("Mensaje fijado");
    } catch (error) {
      this.showError(error);
    }
  }

  /** A place, asked as two numbers, which is all a demo needs to prove it arrives as a place. */
  private async sendPlace(): Promise<void> {
    if (!this.conversationId) return;
    const answer = window.prompt("¿Que sitio? latitud, longitud", "43.263, -2.935");
    if (!answer) return;
    const [latitude, longitude] = answer.split(",").map(part => Number(part.trim()));
    if (
      latitude === undefined ||
      longitude === undefined ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude)
    ) {
      this.setStatus("Eso no son dos numeros");
      return;
    }
    const description = window.prompt("¿Como se llama el sitio?") ?? undefined;
    try {
      await this.client.messages.sendLocation(this.conversationId, {
        latitude,
        longitude,
        ...(description ? { description } : {})
      });
    } catch (error) {
      this.showError(error);
    }
  }

  /** The three doors in a row: only invited, anybody, or anybody who knocks first. */
  private async cycleJoinRule(): Promise<void> {
    if (!this.conversationId) return;
    const order = ["invite", "public", "knock"] as const;
    const current =
      this.conversations?.get().find(item => item.id === this.conversationId)?.joinRule ?? "invite";
    const next = order[(order.indexOf(current) + 1) % order.length] ?? "invite";
    try {
      await this.client.conversations.setJoinRule(this.conversationId, next);
      await this.refreshConversations();
      const said = { invite: "Solo por invitacion", public: "Abierta a cualquiera", knock: "Hay que llamar" };
      this.setStatus(said[next]);
    } catch (error) {
      this.showError(error);
    }
  }

  private async rememberDraft(): Promise<void> {
    if (!this.conversationId) return;
    await this.client.conversations
      .saveDraft(this.conversationId, this.input("message").value)
      .catch(() => undefined);
  }

  private async restoreDraft(): Promise<void> {
    if (!this.conversationId) return;
    const draft = await this.client.conversations.draft(this.conversationId).catch(() => undefined);
    this.input("message").value = draft ?? "";
  }

  private async showPinned(): Promise<void> {
    if (!this.conversationId) return;
    try {
      const pinned = await this.client.conversations.pinned(this.conversationId);
      if (pinned.length === 0) {
        this.setStatus("No hay mensajes fijados");
        return;
      }
      this.setStatus(`Fijados: ${pinned.map(message => message.body).join(" | ")}`);
    } catch (error) {
      this.showError(error);
    }
  }

  private showTopic(): void {
    const topic = this.conversations?.get().find(item => item.id === this.conversationId)?.topic;
    const element = this.element("topic-text");
    element.textContent = topic ?? "";
    element.hidden = !topic;
  }

  private async toggleFavourite(): Promise<void> {
    if (!this.conversationId) return;
    const current = this.conversations?.get().find(item => item.id === this.conversationId);
    try {
      await this.client.conversations.setFavourite(this.conversationId, current?.isFavourite !== true);
      await this.refreshConversations();
    } catch (error) {
      this.showError(error);
    }
  }

  private async removeParticipant(): Promise<void> {
    const userId = window.prompt("¿A quién expulsas?");
    if (!this.conversationId || !userId) return;
    try {
      await this.client.conversations.remove(this.conversationId, userId);
      await this.refreshConversations();
    } catch (error) {
      this.showError(error);
    }
  }

  private async inviteParticipant(): Promise<void> {
    const userId = window.prompt("¿A quién invitas?", "@carol:localhost");
    if (!this.conversationId || !userId) return;
    try {
      await this.client.conversations.invite(this.conversationId, userId);
    } catch (error) {
      this.showError(error);
    }
  }

  private async renameConversation(): Promise<void> {
    const title = window.prompt("Nuevo nombre");
    if (!this.conversationId || !title) return;
    try {
      await this.client.conversations.rename(this.conversationId, title);
      await this.refreshConversations();
    } catch (error) {
      this.showError(error);
    }
  }

  private async leaveConversation(): Promise<void> {
    if (!this.conversationId || !window.confirm("¿Salir de esta conversación?")) return;
    try {
      await this.client.conversations.leave(this.conversationId);
      this.timeline?.stop();
      this.timeline = undefined;
      this.conversationId = undefined;
      this.element("empty").hidden = false;
      this.element("timeline").hidden = true;
      this.element("conversation-actions").hidden = true;
      const footer = document.querySelector("footer");
      if (footer) footer.hidden = true;
      await this.refreshConversations();
    } catch (error) {
      this.showError(error);
    }
  }

  private async sendMessage(): Promise<void> {
    if (!this.conversationId) return;
    const body = this.input("message").value;
    const replyTo = this.replyTo?.id;
    this.input("message").value = "";
    this.clearReply();
    await this.stopTyping();
    try {
      await this.client.messages.send(this.conversationId, body, replyTo ? { replyTo } : {});
    } catch (error) {
      this.showError(error);
    }
  }

  private async sendFile(): Promise<void> {
    const file = this.input("file").files?.[0];
    if (!this.conversationId || !file) return;
    const progress = document.querySelector<HTMLProgressElement>("#upload-progress");
    if (progress) progress.hidden = false;
    try {
      await this.client.messages.sendFile(
        this.conversationId,
        {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          data: new Uint8Array(await file.arrayBuffer())
        },
        {
          onProgress: fraction => {
            if (progress) progress.value = fraction;
          }
        }
      );
      (this.element("file-form") as HTMLFormElement).reset();
    } catch (error) {
      this.showError(error);
    } finally {
      if (progress) progress.hidden = true;
    }
  }

  private startReply(message: Message): void {
    this.replyTo = message;
    this.element("replying").textContent = `Respondiendo a: ${message.body}`;
    this.element("replying").hidden = false;
    this.input("message").focus();
  }

  private clearReply(): void {
    this.replyTo = undefined;
    this.element("replying").hidden = true;
  }

  private notifyTyping(): void {
    if (!this.conversationId) return;
    if (this.stopTypingTimer === undefined) {
      void this.client.conversations.typing(this.conversationId, true).catch(() => undefined);
    }
    window.clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = window.setTimeout(() => void this.stopTyping(), typingTimeoutMs);
  }

  private async stopTyping(): Promise<void> {
    if (this.stopTypingTimer === undefined || !this.conversationId) return;
    window.clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = undefined;
    await this.client.conversations.typing(this.conversationId, false).catch(() => undefined);
  }

  private showTyping(conversationId: ConversationId, userIds: readonly string[]): void {
    if (conversationId !== this.conversationId) return;
    const others = userIds
      .filter(userId => userId !== this.ownUserId)
      .map(userId => this.nameOf(userId, this.conversationId));
    this.element("typing").textContent = others.length > 0 ? `${others.join(", ")} está escribiendo…` : "";
  }

  private async download(media: MediaRef, name: string): Promise<void> {
    try {
      const data = await this.client.media.download(media);
      const url = URL.createObjectURL(new Blob([data], { type: media.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.showError(error);
    }
  }

  /**
   * The blur first and the image after. It takes the exact space from the start, so the conversation does
   * not jump when the photo finally arrives.
   */
  private imageWithBlur(attachment: Attachment): HTMLElement {
    const holder = document.createElement("div");
    const width = Math.min(attachment.width ?? 240, 240);
    const height =
      attachment.height && attachment.width
        ? Math.round((attachment.height / attachment.width) * width)
        : 160;
    if (attachment.blurhash) {
      const blurred = decodeBlurhash(attachment.blurhash, width, height);
      blurred.className = "blurred";
      holder.append(blurred);
    }
    const image = document.createElement("img");
    image.alt = attachment.name;
    image.width = width;
    image.hidden = true;
    holder.append(image);
    void this.paintImage(image, attachment).then(() => {
      image.hidden = false;
      holder.querySelector(".blurred")?.remove();
    });
    return holder;
  }

  private async paintImage(image: HTMLImageElement, attachment: Attachment): Promise<void> {
    const bytes = await this.client.media.download(attachment).catch(() => undefined);
    if (!bytes) return;
    image.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: attachment.mimeType }));
  }

  /** Asking the conversation something. Answers are separated by commas, which is quickest to type. */
  private async askSomething(): Promise<void> {
    if (!this.conversationId) return;
    const question = this.input("poll-question").value.trim();
    const answers = this.input("poll-answers").value;
    if (!question || !answers.trim()) return;
    try {
      await this.client.polls.start(this.conversationId, {
        question,
        answers: answers.split(",").map(answer => answer.trim())
      });
      this.input("poll-question").value = "";
      this.element("poll-form").hidden = true;
      await this.showPolls();
    } catch (error) {
      this.showError(error);
    }
  }

  /**
   * Polls live apart from the message timeline, as in any client that paints them, and in a place of their
   * own: the timeline is rebuilt whole every time a message arrives, so a poll drawn inside it was wiped by
   * whatever was said next.
   */
  private async showPolls(): Promise<void> {
    if (!this.conversationId) return;
    const polls = await this.client.polls.list(this.conversationId).catch(() => []);
    this.element("polls").replaceChildren(...polls.map(poll => this.pollElement(poll)));
  }

  private pollElement(poll: Poll): HTMLElement {
    const item = document.createElement("div");
    item.className = `poll${poll.isClosed ? " closed" : ""}`;
    const question = document.createElement("strong");
    question.textContent = poll.question;
    item.append(question);
    const total = poll.answers.reduce((count, answer) => count + answer.votes, 0);
    for (const answer of poll.answers) {
      const row = document.createElement("div");
      row.className = "answer";
      const bar = document.createElement("span");
      bar.className = "bar";
      bar.style.width = `${total > 0 ? (answer.votes / total) * 120 : 0}px`;
      const label = `${answer.text} · ${answer.votes}${poll.ownAnswerId === answer.id ? " ✓" : ""}`;
      if (poll.isClosed) {
        row.append(label, bar);
      } else {
        row.append(
          this.button(label, () => void this.vote(poll, answer.id)),
          bar
        );
      }
      item.append(row);
    }
    if (!poll.isClosed) {
      item.append(this.button("Cerrar", () => void this.closePoll(poll)));
    }
    return item;
  }

  private async vote(poll: Poll, answerId: string): Promise<void> {
    try {
      await this.client.polls.vote(poll.conversationId, poll.id, answerId);
      await this.showPolls();
    } catch (error) {
      this.showError(error);
    }
  }

  private async closePoll(poll: Poll): Promise<void> {
    try {
      await this.client.polls.close(poll.conversationId, poll.id);
      await this.showPolls();
    } catch (error) {
      this.showError(error);
    }
  }

  /**
   * Telling where I am for a while. The browser gives the position; the duration is required, and what
   * makes it safe is that it ends on its own even if nobody stops anything.
   */
  private async shareWhereIAm(): Promise<void> {
    if (!this.conversationId) return;
    if (this.sharingId) {
      await this.client.location.stop(this.sharingId).catch(error => this.showError(error));
      this.sharingId = undefined;
      this.element("live-location").textContent = "Compartir ubicación";
      this.setStatus("Has dejado de compartir dónde estás");
      return;
    }
    try {
      const sharing = await this.client.location.start(this.conversationId, {
        durationMs: 10 * 60 * 1000,
        description: "voy para allá"
      });
      this.sharingId = sharing.id;
      this.element("live-location").textContent = "Dejar de compartir";
      await this.tellWhereIAm();
      this.setStatus("Compartiendo dónde estás durante 10 minutos");
    } catch (error) {
      this.showError(error);
    }
  }

  private async tellWhereIAm(): Promise<void> {
    const sharingId = this.sharingId;
    if (!sharingId || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      position =>
        void this.client.location
          .update(sharingId, { latitude: position.coords.latitude, longitude: position.coords.longitude })
          .catch(error => this.showError(error)),
      // No permission means no position, and that is not a failure: nothing is told, and that is all.
      () => this.setStatus("Sin permiso para saber dónde estás"),
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }

  /** Recording with the browser microphone, and sending it with its duration and its waveform. */
  private async recordVoice(): Promise<void> {
    if (!this.conversationId) return;
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(microphone);
      const pieces: Blob[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = piece => pieces.push(piece.data);
      recorder.onstop = () => {
        for (const track of microphone.getTracks()) track.stop();
        this.recorder = undefined;
        this.element("record").textContent = "🎤 Grabar nota de voz";
        this.element("record").classList.remove("recording");
        void this.sendVoice(new Blob(pieces, { type: recorder.mimeType }), Date.now() - startedAt);
      };
      recorder.start();
      this.recorder = recorder;
      this.element("record").textContent = "⏹ Parar";
      this.element("record").classList.add("recording");
    } catch (error) {
      this.showError(error);
    }
  }

  private async sendVoice(audio: Blob, durationMs: number): Promise<void> {
    if (!this.conversationId) return;
    const data = new Uint8Array(await audio.arrayBuffer());
    // The waveform that travels with the note: what shows at a glance where the pauses are. Measured from
    // the audio itself, which is the only thing to hand without decoding the whole of it.
    const waveform = Array.from({ length: 30 }, (_unused, step) => {
      const at = Math.floor((step / 30) * data.length);
      return Math.abs((data[at] ?? 128) - 128) * 8;
    });
    try {
      await this.client.messages.sendVoice(
        this.conversationId,
        { data, mimeType: audio.type || "audio/webm", name: "nota-de-voz" },
        { durationMs, waveform }
      );
    } catch (error) {
      this.showError(error);
    }
  }

  /** Any sticker, drawn right here: the point is seeing it painted on its own, not where it comes from. */
  private async sendSticker(): Promise<void> {
    if (!this.conversationId) return;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const brush = canvas.getContext("2d");
    if (brush) {
      brush.fillStyle = "#f5c542";
      brush.beginPath();
      brush.arc(64, 64, 60, 0, Math.PI * 2);
      brush.fill();
      brush.font = "64px serif";
      brush.fillText("😀", 32, 88);
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    try {
      await this.client.messages.sendSticker(this.conversationId, {
        data: new Uint8Array(await blob.arrayBuffer()),
        mimeType: "image/png",
        name: "pegatina",
        width: 128,
        height: 128
      });
    } catch (error) {
      this.showError(error);
    }
  }

  /** What is behind the link being typed. The homeserver looks, not this browser. */
  private lookAtTheLink(): void {
    const found = /(https?:\/\/\S+)/.exec(this.input("message").value);
    const preview = this.element("link-preview");
    if (!found) {
      preview.hidden = true;
      return;
    }
    const url = found[1] as string;
    if (url === this.previewedUrl) return;
    this.previewedUrl = url;
    void this.client.media.preview(url).then(
      seen => {
        if (this.previewedUrl !== url) return;
        preview.textContent = seen.title
          ? `🔗 ${seen.title}${seen.description ? ` — ${seen.description}` : ""}`
          : "";
        preview.hidden = !seen.title;
      },
      // A link the homeserver cannot look at is not an error to show: there is simply no preview.
      () => {
        preview.hidden = true;
      }
    );
  }

  /**
   * Starting a call: this side is the first one on it, and the room rings everybody else in the
   * conversation. Matrix says who they are; a server that cannot read the picture carries it.
   */
  private async callThem(video: boolean, into = this.conversationId): Promise<void> {
    if (!into) return;
    try {
      this.call = await this.client.calls.place(into, { video });
      await this.drawTheCalls();
    } catch (error) {
      // Refusing the microphone or the camera is the usual reason, and whoever pressed the button is the one
      // who has to hear about it.
      this.setStatus(`No se pudo llamar: ${(error as Error).message}`);
    }
  }

  private async joinThem(): Promise<void> {
    if (!this.conversationId) return;
    try {
      this.call = await this.client.calls.join(this.conversationId, { video: true });
      await this.drawTheCalls();
    } catch (error) {
      this.setStatus(`No se pudo entrar: ${(error as Error).message}`);
    }
  }

  private async answerThem(): Promise<void> {
    if (!this.call) return;
    // Answered as it was placed: whoever is calling with a camera is waiting to be seen as well as heard.
    await this.client.calls.answer(this.call.id, { video: this.call.isVideo });
    await this.drawTheCalls();
  }

  private async hangUp(): Promise<void> {
    if (!this.call) return;
    await this.client.calls.hangUp(this.call.id);
  }

  /**
   * What there is to speak and be seen with. The browser is what knows this, so it is asked directly: the
   * library has no business repeating a list the platform already keeps.
   *
   * The names are empty until somebody has been asked for the microphone once, so what there is gets filled
   * in again after every call.
   */
  private async fillInDevices(): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const fill = (id: string, kind: MediaDeviceKind, fallback: string) => {
      const picker = this.select(id);
      const chosen = picker.value;
      picker.replaceChildren(
        ...devices
          .filter(device => device.kind === kind)
          .map(
            (device, position) => new Option(device.label || `${fallback} ${position + 1}`, device.deviceId)
          )
      );
      if (chosen) picker.value = chosen;
    };
    fill("microphone", "audioinput", "Micrófono");
    fill("camera", "videoinput", "Cámara");
  }

  private async chooseDevice(which: "microphone" | "camera"): Promise<void> {
    const deviceId = this.select(which).value;
    if (!deviceId) return;
    try {
      await (which === "microphone"
        ? this.client.calls.useMicrophone(deviceId)
        : this.client.calls.useCamera(deviceId));
    } catch (error) {
      this.setStatus(`No se pudo: ${(error as Error).message}`);
    }
  }

  /**
   * Anything pressed while a call is going on. Nothing to do when there is no call, which is not an error.
   *
   * The call is asked for again rather than taken from what was last drawn. These buttons decide what to ask
   * for from how the call stands — silence it if it is speaking — and deciding that from a copy that is a
   * moment out of date asks for the wrong thing, which reads as a button that undoes itself.
   */
  private async duringTheCall(what: (call: Call, client: MessagingClient) => Promise<void>): Promise<void> {
    if (!this.call) return;
    const going = (await this.client.calls.list()).find(item => item.id === this.call?.id);
    if (!going) return;
    try {
      await what(going, this.client);
    } catch (error) {
      this.setStatus(`No se pudo: ${(error as Error).message}`);
    }
  }

  /**
   * Everything about calls, drawn from what is going on. One is talked on and the rest are listed; which one
   * that is stays whatever it was, as long as it is still there.
   */
  private async drawTheCalls(): Promise<void> {
    const going = await this.client.calls.list();
    const talkingOn =
      going.find(call => call.id === this.call?.id) ??
      going.find(call => call.state !== "ringing") ??
      going[0];
    if (this.call && !talkingOn) void this.fillInDevices();
    this.call = talkingOn;
    if (talkingOn) this.showCall(talkingOn);
    this.element("call-panel").hidden = !talkingOn;
    // Nothing to pick up when there is nothing: buttons left showing inside a hidden panel are what the next
    // call finds already pressed.
    if (!talkingOn) {
      this.element("answer").hidden = true;
      this.element("reject").hidden = true;
      this.element("participants").replaceChildren();
    }
  }

  /** What there is to see and hear while a call is going on. */
  /** What the one being talked on looks like. Which one that is, and whether there is one, is decided above. */
  private showCall(call: Call): void {
    const placedByMe = call.callerId === this.ownUserId;
    const beingRung = call.state === "ringing" && !placedByMe;
    this.element("answer").hidden = !beingRung;
    // Refusing is only something you can do to a call you did not place and have not answered.
    this.element("reject").hidden = !beingRung;
    // A button has to say what pressing it will do, or nobody knows whether it is already pressed.
    this.element("call-mute").textContent = call.isMicrophoneMuted ? "Hablar" : "Silenciar micro";
    this.element("call-screen").textContent = call.isSharingScreen
      ? "Dejar de compartir"
      : "Compartir pantalla";
    const camera = this.element("call-camera");
    camera.hidden = !call.isVideo;
    camera.textContent = call.isCameraMuted ? "Encender cámara" : "Apagar cámara";
    // Naming whoever placed it only says something when it was not this side: "calling myself" is nonsense.
    if (call.wentWrong) this.setStatus(`La llamada fallo: ${call.wentWrong}`);
    // Alone on a call you started is still ringing the others; with anybody else on it, you are talking.
    const others = call.participants.filter(one => one.userId !== this.ownUserId);
    const names = others.map(one => this.nameOf(one.userId)).join(", ");
    // Ringing is a call going on without you: there to be joined, whether or not anybody rang you for it.
    this.element("call-state").textContent =
      call.state === "ringing"
        ? `Llamada en curso con ${names || this.nameOf(call.callerId)}`
        : others.length > 0
          ? `En llamada con ${names}`
          : placedByMe
            ? "Llamando…"
            : "Solo en la llamada";

    this.drawParticipants(call);

    // A shared screen is a second thing to show. Somebody else's when anybody is showing one — whoever it is,
    // however many are on the call — otherwise your own, because showing a room you cannot see yourself is how
    // people share the wrong window.
    const somebodyElses = call.participants.find(one => one.userId !== this.ownUserId && one.screen)?.screen;
    const shared = somebodyElses ?? call.ownScreen;
    const screen = this.element("call-screen-media") as HTMLVideoElement;
    screen.srcObject = shared ?? null;
    screen.hidden = !shared;
  }

  /**
   * One box per person, this side included. The boxes are kept between repaints and only what changed is
   * touched: giving a `<video>` the same stream again restarts it, and the call repaints often.
   */
  private drawParticipants(call: Call): void {
    const grid = this.element("participants");
    const seen = new Set<string>();
    for (const person of call.participants) {
      const key = `${person.userId}/${person.deviceId}`;
      seen.add(key);
      let box = grid.querySelector<HTMLElement>(`figure[data-key="${CSS.escape(key)}"]`);
      if (!box) {
        box = document.createElement("figure");
        box.dataset.key = key;
        box.dataset.user = person.userId;
        if (person.userId === this.ownUserId) box.dataset.me = "true";
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        // Your own voice played back to you is an echo, not information.
        video.muted = person.userId === this.ownUserId;
        box.append(video, document.createElement("figcaption"));
        grid.append(box);
      }
      const video = box.querySelector("video") as HTMLVideoElement;
      if (video.srcObject !== (person.media ?? null)) video.srcObject = person.media ?? null;
      // A box with no picture still has a voice in it: the name stays, the black rectangle goes.
      video.hidden = (person.media?.getVideoTracks().length ?? 0) === 0;
      const me = person.userId === this.ownUserId ? " (tú)" : "";
      const silenced = person.isMicrophoneMuted ? " 🔇" : "";
      const padlock = call.isEncrypted ? " 🔒" : "";
      (box.querySelector("figcaption") as HTMLElement).textContent =
        `${this.nameOf(person.userId)}${me}${silenced}${padlock}`;
    }
    for (const box of grid.querySelectorAll<HTMLElement>("figure")) {
      if (!seen.has(box.dataset.key ?? "")) box.remove();
    }
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private onSubmit(id: string, handler: () => void | Promise<void>): void {
    this.element(id).addEventListener("submit", event => {
      event.preventDefault();
      void handler();
    });
  }

  private element(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`Missing element: ${id}`);
    return element;
  }

  private input(id: string): HTMLInputElement {
    return this.element(id) as HTMLInputElement;
  }

  private select(id: string): HTMLSelectElement {
    return this.element(id) as HTMLSelectElement;
  }

  private setStatus(status: string): void {
    this.element("status").textContent = status;
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Error desconocido";
    this.setStatus(`Error: ${message}`);
  }

  dispose(): void {
    this.timeline?.stop();
    this.conversations?.stop();
    void this.client.stop();
  }
}

/** Two letters and a colour that is always the same for the same name, so a face is recognisable before it is one. */
function paintAvatar(where: HTMLElement, name: string): void {
  const words = name
    .replace(/^@/, "")
    .split(/[\s:._-]+/)
    .filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map(word => word[0] ?? "")
      .join("") || name.slice(0, 2);
  where.textContent = initials;
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  where.style.setProperty(
    "--tone",
    `linear-gradient(135deg, hsl(${hue} 60% 50%), hsl(${(hue + 40) % 360} 60% 40%))`
  );
}

/** Today's messages by the clock, older ones by the day: what anybody reading a conversation wants to know. */
function timeOf(createdAt: number): string {
  const then = new Date(createdAt);
  const today = new Date().toDateString() === then.toDateString();
  return today
    ? then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : then.toLocaleDateString([], { day: "2-digit", month: "short" }) +
        " " +
        then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildClient(): MessagingClient {
  const kept = readRememberedSession();
  return new MessagingClient({
    ...(kept ? { session: kept } : {}),
    // A window over the conversations instead of every room: on an account with thousands, opening at once
    // instead of waiting. Asking for more conversations widens it.
    matrix: { conversationWindow: 40, ...whereConferencesAreCarried() }
  });
}

/**
 * A development homeserver has no `.well-known` to say where its conferences are carried, so the address the
 * demo was opened with can say it instead: `?conference=http://localhost:8091`.
 */
function whereConferencesAreCarried(): { conferenceServiceUrl?: string } {
  const said = new URLSearchParams(location.search).get("conference");
  if (said) return { conferenceServiceUrl: said };
  // On a development machine it is next door, on the port `infrastructure/livekit` publishes it on.
  const isADevelopmentMachine = ["localhost", "127.0.0.1"].includes(location.hostname);
  return isADevelopmentMachine ? { conferenceServiceUrl: "http://localhost:8091" } : {};
}

function readRememberedSession(): Session | undefined {
  try {
    const kept = localStorage.getItem(rememberedSession);
    return kept ? (JSON.parse(kept) as Session) : undefined;
  } catch {
    return undefined;
  }
}

const app = new DemoApp();
// Opening it again with a session already here goes straight in, without asking anything.
void app.reopen();

// Put where the browser check can reach it. Calls need WebRTC, which Node does not have, so a browser is the
// only place their signalling can be exercised at all, and it needs a client to do it with.
(window as unknown as { relaykitDemo: { client: MessagingClient } }).relaykitDemo = { client: app.client };

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}

/**
 * The waveform that travels with the voice note, drawn. It shows at a glance whether somebody sent two
 * seconds or two minutes, and where the pauses are, without having to play it.
 */
function drawWaveform(voice: VoiceInfo): HTMLElement {
  const holder = document.createElement("div");
  const seconds = Math.round(voice.durationMs / 1000);
  const bars = voice.waveform ?? [];
  if (bars.length === 0) {
    holder.textContent = `🎤 ${seconds}s`;
    return holder;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "waveform";
  canvas.width = Math.min(bars.length * 3, 240);
  canvas.height = 32;
  const brush = canvas.getContext("2d");
  if (brush) {
    const loudest = Math.max(...bars, 1);
    bars.forEach((level, index) => {
      const height = Math.max(2, (level / loudest) * canvas.height);
      brush.fillStyle = "#4a90d9";
      brush.fillRect(index * 3, (canvas.height - height) / 2, 2, height);
    });
  }
  holder.append(canvas, `🎤 ${seconds}s`);
  return holder;
}

/**
 * Decodes a blurhash onto a tiny canvas that is then stretched. Neither Matrix nor the SDK carries this
 * because it is not protocol: it is how it is painted. The algorithm is published and is the same one every
 * other client uses.
 */
function decodeBlurhash(hash: string, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const brush = canvas.getContext("2d");
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
  const decode83 = (text: string): number =>
    [...text].reduce((total, letter) => total * 83 + alphabet.indexOf(letter), 0);
  const toLinear = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = (value: number): number => {
    const clamped = Math.max(0, Math.min(1, value));
    const scaled = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(scaled * 255);
  };
  try {
    const sizeFlag = decode83(hash[0] as string);
    const across = (sizeFlag % 9) + 1;
    const down = Math.floor(sizeFlag / 9) + 1;
    const highest = (decode83(hash[1] as string) + 1) / 166;
    const colours: number[][] = [];
    for (let index = 0; index < across * down; index += 1) {
      if (index === 0) {
        const value = decode83(hash.slice(2, 6));
        colours.push([toLinear(value >> 16), toLinear((value >> 8) & 255), toLinear(value & 255)]);
        continue;
      }
      const value = decode83(hash.slice(4 + index * 2, 6 + index * 2));
      const sign = (part: number) => (part - 9) / 9;
      colours.push([
        Math.sign(sign(Math.floor(value / (19 * 19)))) *
          Math.abs(sign(Math.floor(value / (19 * 19)))) ** 2 *
          highest,
        Math.sign(sign(Math.floor(value / 19) % 19)) *
          Math.abs(sign(Math.floor(value / 19) % 19)) ** 2 *
          highest,
        Math.sign(sign(value % 19)) * Math.abs(sign(value % 19)) ** 2 * highest
      ]);
    }
    // Painted small and stretched by the browser: that way the blur comes out smooth without working out
    // every pixel.
    const small = document.createElement("canvas");
    small.width = across * 4;
    small.height = down * 4;
    const smallBrush = small.getContext("2d");
    if (!smallBrush || !brush) return canvas;
    const picture = smallBrush.createImageData(small.width, small.height);
    for (let y = 0; y < small.height; y += 1) {
      for (let x = 0; x < small.width; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let column = 0; column < across; column += 1) {
          for (let row = 0; row < down; row += 1) {
            const weight =
              Math.cos((Math.PI * x * column) / small.width) * Math.cos((Math.PI * y * row) / small.height);
            const colour = colours[row * across + column] as number[];
            red += (colour[0] as number) * weight;
            green += (colour[1] as number) * weight;
            blue += (colour[2] as number) * weight;
          }
        }
        const at = (y * small.width + x) * 4;
        picture.data[at] = toSrgb(red);
        picture.data[at + 1] = toSrgb(green);
        picture.data[at + 2] = toSrgb(blue);
        picture.data[at + 3] = 255;
      }
    }
    smallBrush.putImageData(picture, 0, 0);
    brush.drawImage(small, 0, 0, width, height);
  } catch {
    // A blur that cannot be read is no reason to paint nothing: the gap stays, and that is that.
  }
  return canvas;
}
