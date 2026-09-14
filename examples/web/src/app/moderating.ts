import type {
  ConversationId,
  ConversationPermissions,
  MessagingClient,
  Participant,
  UserId
} from "@relaykit/web";
import { dialog, element, onClick, pressedIn, safe } from "./dom.js";
import { face, type People } from "./people.js";

const roleNames: Readonly<Record<Participant["role"], string>> = {
  member: "",
  moderator: "Moderador",
  admin: "Administrador"
};

const membershipNames: Readonly<Record<Participant["membership"], string>> = {
  join: "",
  invite: "Invitado",
  knock: "Pide entrar",
  leave: "Se fue",
  ban: "Expulsado"
};

/**
 * Who is in a conversation, and what can be done with each of them.
 *
 * What is offered comes from two answers together: whether this person may moderate at all, and whether they
 * outrank the person in the row. Both are the library's to decide — one is about the conversation and the
 * other about the two people — and offering a button that always fails is worse than offering none.
 */
export class Moderating {
  private allowed: ConversationPermissions | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly where: {
      readonly openId: () => ConversationId | undefined;
      readonly nameOfOpen: () => string;
    }
  ) {}

  wire(): void {
    onClick("people-here", () => void this.open());
    element("who-list").addEventListener("click", event => void this.pressed(event));
  }

  private async open(): Promise<void> {
    element("more-menu").hidden = true;
    element("who-wrong").hidden = true;
    element("who-list").innerHTML = "";
    element("who-under").textContent = this.where.nameOfOpen();
    dialog("who").showModal();
    await this.paint();
  }

  private async paint(): Promise<void> {
    const conversationId = this.where.openId();
    if (!conversationId) return;
    const [inIt, allowed] = await Promise.all([
      this.client.conversations.participants(conversationId).catch(() => []),
      this.client.conversations.permissions(conversationId).catch(() => undefined)
    ]);
    this.allowed = allowed;
    this.people.learn(
      inIt.map(participant => participant.userId),
      conversationId
    );
    element("who-list").innerHTML = inIt.map(participant => this.row(participant)).join("");
  }

  private row(participant: Participant): string {
    const id = safe(participant.userId);
    const marks = [roleNames[participant.role], membershipNames[participant.membership]]
      .filter(Boolean)
      .map(said => `<span class="tag">${said}</span>`)
      .join("");
    return `<li>
      ${face(this.people, participant.userId)}
      <div>
        <strong>${safe(this.people.nameOf(participant.userId))}</strong>
        <p class="mono faint">${id}</p>
      </div>
      <div class="spacer"></div>
      ${marks}${this.whatCanBeDone(participant)}
    </li>`;
  }

  /** Nothing is offered that would be refused: not to somebody at or above this person, and not without say. */
  private whatCanBeDone(participant: Participant): string {
    const id = safe(participant.userId);
    if (participant.membership === "ban") {
      return this.allowed?.canBan
        ? `<button class="button" data-lets-back-in="${id}">Readmitir</button>`
        : "";
    }
    if (!participant.isUnderMe) return "";
    const rank =
      participant.role === "member"
        ? `<button class="button" data-promotes="${id}">Hacer moderador</button>`
        : `<button class="button" data-demotes="${id}">Quitar moderador</button>`;
    const out = this.allowed?.canRemove
      ? `<button class="button" data-shows-out="${id}">Expulsar</button>`
      : "";
    const shut = this.allowed?.canBan
      ? `<button class="button danger" data-shuts-out="${id}">Vetar</button>`
      : "";
    return `${rank}${out}${shut}`;
  }

  private async pressed(event: Event): Promise<void> {
    const conversationId = this.where.openId();
    if (!conversationId) return;
    const promotes = pressedIn(event, "promotes");
    if (promotes)
      return this.doing(() => this.client.conversations.setRole(conversationId, promotes, "moderator"));
    const demotes = pressedIn(event, "demotes");
    if (demotes)
      return this.doing(() => this.client.conversations.setRole(conversationId, demotes, "member"));
    const showsOut = pressedIn(event, "shows-out");
    if (showsOut) return this.showOut(conversationId, showsOut);
    const shutsOut = pressedIn(event, "shuts-out");
    if (shutsOut) return this.shutOut(conversationId, shutsOut);
    const letsBackIn = pressedIn(event, "lets-back-in");
    if (letsBackIn) {
      return this.doing(() => this.client.conversations.unban(conversationId, letsBackIn));
    }
  }

  /** Being shown the door can be undone by being invited back; being vetoed cannot, so it is asked for. */
  private async showOut(conversationId: ConversationId, userId: UserId): Promise<void> {
    const why = window.prompt(`¿Por qué expulsas a ${this.people.nameOf(userId)}?`, "");
    if (why === null) return;
    await this.doing(() => this.client.conversations.remove(conversationId, userId, why));
  }

  private async shutOut(conversationId: ConversationId, userId: UserId): Promise<void> {
    if (!window.confirm(`¿Vetar a ${this.people.nameOf(userId)}? No podrá volver a entrar.`)) return;
    await this.doing(() => this.client.conversations.ban(conversationId, userId));
  }

  private async doing(what: () => Promise<unknown>): Promise<void> {
    try {
      await what();
      await this.paint();
    } catch (error) {
      const where = element("who-wrong");
      where.textContent = error instanceof Error ? error.message : String(error);
      where.hidden = false;
    }
  }
}
