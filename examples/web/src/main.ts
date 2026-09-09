import {
  MessagingClient,
  createConversationList,
  createMessageTimeline,
  type Conversation,
  type ConversationId,
  type LiveCollection,
  type MediaRef,
  type Message
} from "@relaykit/web";

const typingTimeoutMs = 4000;

class DemoApp {
  private readonly client = new MessagingClient({});
  private conversationId: ConversationId | undefined;
  private ownUserId: string | undefined;
  private stopTypingTimer: number | undefined;
  private conversations: LiveCollection<Conversation> | undefined;
  private timeline: LiveCollection<Message> | undefined;
  private readonly names = new Map<string, string>();
  private replyTo: Message | undefined;

  constructor() {
    this.bindForms();
    this.client.on("connection.changed", status => this.setStatus(status));
    this.client.on("typing.changed", update => this.showTyping(update.conversationId, update.userIds));
    this.client.on("notification", notification => this.setStatus(
      `${this.nameOf(notification.senderId)}${notification.isMention ? " te menciona" : ""}: ${notification.body}`
    ));
    this.client.on("error", error => this.setStatus(`Error: ${error.message}`));
    this.element("load-more").addEventListener("click", () => void this.loadMore());
    this.element("invite").addEventListener("click", () => void this.inviteParticipant());
    this.element("rename").addEventListener("click", () => void this.renameConversation());
    this.element("leave").addEventListener("click", () => void this.leaveConversation());
  }

  private bindForms(): void {
    this.onSubmit("login-form", () => this.login());
    this.onSubmit("open-form", () => this.openConversation());
    this.onSubmit("search-form", () => this.refreshConversations());
    this.onSubmit("message-form", () => this.sendMessage());
    this.onSubmit("file-form", () => this.sendFile());
    this.input("message").addEventListener("input", () => this.notifyTyping());
    this.select("username").addEventListener("change", () => {
      this.input("password").value = `${this.select("username").value}-password`;
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
      this.ownUserId = session.userId;
      this.select("participant").value = session.userId === "@alice:localhost" ? "@bob:localhost" : "@alice:localhost";
      await this.client.start();
      const conversations = createConversationList(this.client);
      this.conversations = conversations;
      conversations.subscribe(() => {
        if (!this.input("search").value.trim()) this.renderConversations(conversations.get());
      });
      this.element("app").hidden = false;
      await this.refreshConversations();
      // Joining runs after the list is on screen, so a bad invitation never leaves the user staring at nothing.
      void this.acceptInvitations();
    } catch (error) {
      this.showError(error);
    } finally {
      if (button) button.disabled = false;
    }
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
    const name = document.createElement("span");
    name.className = "name";
    const others = this.otherParticipants(conversation).map(participantId => this.nameOf(participantId));
    name.textContent = conversation.title ?? (others.length > 0 ? others.join(", ") : conversation.id);
    const preview = document.createElement("span");
    preview.className = "preview";
    preview.textContent = conversation.lastMessage?.body ?? "Sin mensajes";
    item.append(name, preview);
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
  private nameOf(userId: string): string {
    const known = this.names.get(userId);
    if (known !== undefined) return known;
    this.names.set(userId, userId);
    void this.client.users.profile(userId).then(profile => {
      const resolved = profile.displayName ?? userId;
      if (resolved === userId) return;
      this.names.set(userId, resolved);
      void this.refreshConversations();
      if (this.timeline) this.renderTimeline(this.timeline.get());
    }).catch(() => undefined);
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
    this.element("conversation-actions").hidden = false;
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
    } catch (error) {
      this.showError(error);
    }
  }

  private renderTimeline(messages: readonly Message[]): void {
    const timeline = this.element("timeline");
    timeline.replaceChildren(
      this.element("load-more"),
      ...messages.map(message => this.messageElement(message, messages))
    );
    timeline.scrollTop = timeline.scrollHeight;
  }

  private messageElement(message: Message, all: readonly Message[]): HTMLElement {
    const item = document.createElement("article");
    const faded = message.deletedAt || message.undecryptable ? " deleted" : "";
    item.className = `message${message.senderId === this.ownUserId ? " own" : ""}${faded}`;
    const children: (Node | string)[] = [];
    if (message.replyToId) {
      const quoted = document.createElement("div");
      quoted.className = "quote";
      quoted.textContent = all.find(other => other.id === message.replyToId)?.body ?? "Mensaje anterior";
      children.push(quoted);
    }
    const body = document.createElement("div");
    if (message.undecryptable) body.textContent = "Mensaje cifrado que este dispositivo no puede leer";
    else body.textContent = message.deletedAt ? "Mensaje eliminado" : message.body;
    children.push(body);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.append(`${this.nameOf(message.senderId)} · ${message.status}${message.editedAt ? " · editado" : ""}`);
    const attachment = message.attachment;
    if (attachment?.source) {
      meta.append(this.button("Descargar", () => void this.download(attachment, attachment.name)));
    }
    if (attachment?.thumbnail) {
      const thumbnail = attachment.thumbnail;
      meta.append(this.button("Vista previa", () => void this.download(thumbnail, `preview-${attachment.name}`)));
    }
    if (!message.deletedAt && !message.undecryptable) {
      meta.append(this.button("Responder", () => this.startReply(message)));
    }
    if (message.status === "failed") {
      meta.append(this.button("Reintentar", () => void this.client.messages.retry(message.id).catch(error => this.showError(error))));
      meta.append(this.button("Cancelar", () => void this.client.messages.cancel(message.id).catch(error => this.showError(error))));
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
        { name: file.name, mimeType: file.type || "application/octet-stream", data: new Uint8Array(await file.arrayBuffer()) },
        { onProgress: fraction => { if (progress) progress.value = fraction; } }
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
    const others = userIds.filter(userId => userId !== this.ownUserId).map(userId => this.nameOf(userId));
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

const app = new DemoApp();

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
