import type { Call, ConversationId, MessagingClient, UserId } from "@relaykit/web";
import { element, input, onClick } from "./dom.js";
import { face, type People } from "./people.js";
import { paintGrid } from "./room.js";
import { runningFor } from "./when.js";
import { show, showing } from "./views.js";

/**
 * Everything about a call: the room itself, the strip above the rest of the application while one is going
 * on, the widget it shrinks to, and the lobby a room waits in until somebody else arrives.
 *
 * They are one thing because they are four faces of the same question — is there a call, and am I on it —
 * and answering that in four places is how a screen ends up saying you are in a call you already left.
 */
export class CallScreen {
  private on: Call | undefined;
  private going: readonly Call[] = [];
  private minimised = false;

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly me: UserId,
    /** Told when the call ends or is put away, so whoever owns the rest of the screen can take it back. */
    private readonly backToChat: () => void
  ) {
    window.setInterval(() => this.tick(), 1000);
    // Apart from call.changed on purpose: this arrives several times a second, and lighting up one border
    // must not repaint every face.
    this.client.on("call.speaking", ({ callId, userIds }) => {
      if (callId !== this.on?.id) return;
      for (const seat of element("grid").querySelectorAll(".seat")) {
        const whose = seat instanceof HTMLElement ? (seat.dataset.seat ?? "").split("/")[0] : undefined;
        seat.toggleAttribute("data-speaking", Boolean(whose && userIds.includes(whose)));
      }
    });
  }

  wire(): void {
    onClick(
      "mute-microphone",
      () => void this.during(call => this.client.calls.muteMicrophone(call.id, !call.isMicrophoneMuted))
    );
    onClick(
      "mute-camera",
      () => void this.during(call => this.client.calls.muteCamera(call.id, !call.isCameraMuted))
    );
    onClick(
      "share-screen",
      () => void this.during(call => this.client.calls.shareScreen(call.id, !call.isSharingScreen))
    );
    onClick("hang-up", () => void this.during(call => this.client.calls.hangUp(call.id)));
    onClick("mini-leave", () => void this.during(call => this.client.calls.hangUp(call.id)));
    onClick(
      "mini-mute",
      () => void this.during(call => this.client.calls.muteMicrophone(call.id, !call.isMicrophoneMuted))
    );
    onClick("back-to-chat", () => this.putAway());
    onClick("minimise", () => this.putAway());
    onClick("call-bar-leave", () => void this.during(call => this.client.calls.hangUp(call.id)));
    onClick("mini-open", () => this.bringBack());
    onClick("call-bar-back", () => this.bringBack());
    onClick("lobby-enter", () => this.bringBack());
    onClick("copy-link", () => void navigator.clipboard?.writeText(input("invite-link").value));
  }

  /** The conversations with a call going on in them, for the sidebar to mark. */
  liveIn(): ReadonlySet<ConversationId> {
    return new Set(this.going.map(call => call.conversationId));
  }

  onACallIn(conversationId: ConversationId): boolean {
    return this.on?.conversationId === conversationId;
  }

  goingIn(conversationId: ConversationId): Call | undefined {
    return this.going.find(call => call.conversationId === conversationId);
  }

  /** Opening the room of a conversation: joining the call going on there, or starting one where there is none. */
  async open(conversationId: ConversationId): Promise<void> {
    this.minimised = false;
    const already = this.goingIn(conversationId);
    await (already
      ? this.client.calls.join(conversationId, { video: true })
      : this.client.calls.place(conversationId, { video: true }));
    await this.heard();
  }

  /** Reads what is going on and draws all four of its faces from that, rather than from what it did last. */
  async heard(): Promise<void> {
    this.going = await this.client.calls.list().catch(() => []);
    const before = this.on;
    this.on = this.going.find(call => call.participants.some(person => person.userId === this.me));
    if (before && !this.on) {
      // The call ended, or somebody hung it up elsewhere. Whatever was on screen for it goes with it.
      this.minimised = false;
      this.backToChat();
    }
    this.paint();
  }

  private paint(): void {
    const call = this.on;
    element("call-bar").hidden = !call || showing() === "rooms";
    element("mini").hidden = !call || !this.minimised;
    if (!call) return;
    this.people.learn(call.participants.map(person => person.userId));
    const alone = call.participants.length <= 1;
    // Alone on a call is a room waiting for somebody, which is a different screen from a room with people in.
    if (showing() === "lobby" && !alone) show("rooms");
    paintGrid(element("grid"), call, this.people, this.me);
    this.say(call, alone);
    this.mark("mute-microphone", call.isMicrophoneMuted, "Hablar", "Silenciar");
    this.mark("mute-camera", call.isCameraMuted, "Encender", "Cámara");
    this.mark("share-screen", call.isSharingScreen, "Dejar de compartir", "Compartir");
  }

  private say(call: Call, alone: boolean): void {
    const others = call.participants.filter(person => person.userId !== this.me);
    const names = others.map(person => this.people.nameOf(person.userId)).join(", ");
    const title = alone ? "Sala · esperando invitados" : `Sala · ${names}`;
    element("call-bar-title").textContent = title;
    element("room-title").textContent = title;
    element("mini-title").textContent = names || "Sala";
    element("lobby-title").textContent = `Sala de ${this.people.nameOf(this.me)}`;
    element("lobby-tags").innerHTML =
      `<span class="tag">${call.isEncrypted ? "Cifrada" : "Sin cifrar"}</span>`;
    element("lobby-in-room").innerHTML = call.participants
      .map(person => `<li>${face(this.people, person.userId)} ${this.people.nameOf(person.userId)}</li>`)
      .join("");
    element("lobby-foot").textContent = alone
      ? "Abierta ahora · solo tú dentro"
      : `${call.participants.length} dentro`;
  }

  /** A button has to say what pressing it will do, or nobody can tell whether it is already pressed. */
  private mark(id: string, pressed: boolean, whenPressed: string, whenNot: string): void {
    const button = element(id);
    button.toggleAttribute("data-pressed", pressed);
    const label = button.querySelector("small");
    if (label) label.textContent = pressed ? whenPressed : whenNot;
  }

  private tick(): void {
    if (!this.on) return;
    const going = runningFor(Date.now() - this.on.startedAt);
    element("call-bar-time").textContent = going;
    const inside = this.on.participants.length;
    element("mini-under").textContent = `${going} · ${inside} en sala`;
    void this.howItIsGoing();
  }

  /** How the call is actually travelling, said in words rather than in numbers nobody reads. */
  private async howItIsGoing(): Promise<void> {
    const call = this.on;
    if (!call) return;
    const quality = await this.client.calls.quality(call.id).catch(() => undefined);
    const trip = quality?.roundTripMs;
    element("call-bar-quality").textContent = trip === undefined ? "" : howItTravels(trip);
  }

  /** The room a call is in, once there is one to show. Alone in it is the lobby. */
  bringBack(): void {
    this.minimised = false;
    show(this.on && this.on.participants.length <= 1 ? "lobby" : "rooms");
    this.paint();
  }

  private putAway(): void {
    this.minimised = Boolean(this.on);
    this.backToChat();
    this.paint();
  }

  /**
   * The call is asked for again rather than taken from what was last drawn. These buttons decide what to ask
   * for from how the call stands — silence it if it is speaking — and deciding that from a copy a moment out
   * of date asks for the wrong thing, which reads as a button that undoes itself.
   */
  private async during(what: (call: Call) => Promise<void>): Promise<void> {
    const id = this.on?.id;
    if (!id) return;
    const going = (await this.client.calls.list()).find(call => call.id === id);
    if (!going) return;
    await what(going).catch(() => undefined);
    await this.heard();
  }
}

/** A round trip somebody would notice, said as what they would notice rather than as a number. */
function howItTravels(roundTripMs: number): string {
  if (roundTripMs < 150) return "buena";
  if (roundTripMs < 400) return "regular";
  return "mala";
}
