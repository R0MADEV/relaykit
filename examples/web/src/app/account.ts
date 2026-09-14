import type { Device, MessagingClient, UserId } from "@relaykit/web";
import { dialog, element, input, onClick, pressedIn, safe } from "./dom.js";
import { chosenIn } from "./settings.js";
import { face, type People } from "./people.js";

/**
 * Your account: the sessions that can read what is said to you, and the way out.
 *
 * A session you do not recognise is a session reading your conversations, so this is the one screen where
 * being able to see the list at all is the point. Signing one out is asked for by the homeserver with the
 * account password, which is why it is asked for here and nowhere else.
 */
export class Account {
  private connection = "";

  constructor(
    private readonly client: MessagingClient,
    private readonly people: People,
    private readonly me: UserId,
    private readonly signedOut: () => void
  ) {}

  wire(): void {
    onClick("me", () => void this.open());
    onClick("sign-out", () => void this.signOut());
    onClick("my-picture", () => input("my-file").click());
    onClick("my-save", () => void this.saveMyName());
    input("my-file").addEventListener("change", () => void this.changeMyPicture());
    element("sessions").addEventListener("click", event => {
      const deviceId = pressedIn(event, "revokes");
      if (deviceId) void this.revoke(deviceId);
    });
    // Whether there is a homeserver to talk to at all belongs beside who you are: both are about this session.
    this.client.on("connection.changed", status => {
      this.connection = status === "connected" ? "" : whatIsWrong(status);
      element("me-connection").textContent = this.connection;
    });
  }

  paintWhoYouAre(): void {
    // Painted whole rather than piece by piece: a face is a picture or two letters, which are not the same
    // element. The listener lives on the button around it, so repainting the inside costs nothing.
    element("me").innerHTML =
      `${face(this.people, this.me)}` +
      `<span class="me-name">${safe(this.people.nameOf(this.me))}</span>` +
      `<span class="mono faint" id="me-connection">${safe(this.connection)}</span>`;
    element("account-who").textContent = this.me;
  }

  private async saveMyName(): Promise<void> {
    const name = input("my-name").value.trim();
    if (!name) return;
    try {
      await this.client.users.setDisplayName(name);
      this.people.forget(this.me);
      this.paintWhoYouAre();
    } catch (error) {
      this.show(error);
    }
  }

  private async changeMyPicture(): Promise<void> {
    const picture = await chosenIn("my-file");
    if (!picture) return;
    try {
      await this.client.users.setAvatar(picture);
      this.people.forget(this.me);
      this.paintWhoYouAre();
    } catch (error) {
      this.show(error);
    }
  }

  private async open(): Promise<void> {
    element("account-wrong").hidden = true;
    input("my-name").value = this.people.nameOf(this.me);
    element("sessions").innerHTML = "";
    dialog("account").showModal();
    await this.paintSessions();
  }

  private async paintSessions(): Promise<void> {
    const devices = await this.client.devices.list().catch(error => this.show(error));
    if (!devices) return;
    const trusted = await Promise.all(
      devices.map(device => this.client.devices.verification(this.me, device.id).catch(() => undefined))
    );
    element("sessions").innerHTML = devices
      .map((device, at) => this.row(device, trusted[at]?.verified === true))
      .join("");
  }

  private row(device: Device, verified: boolean): string {
    const here = device.isCurrent ? '<span class="tag">Esta sesión</span>' : "";
    const mark = verified
      ? '<span class="tag">Verificada</span>'
      : '<span class="tag danger">Sin verificar</span>';
    const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString("es") : "nunca vista";
    const out = device.isCurrent
      ? ""
      : `<button class="button" data-revokes="${safe(device.id)}" type="button">Cerrar</button>`;
    return `<li>
      <div>
        <strong>${safe(device.displayName ?? device.id)}</strong>
        <p class="mono faint">${safe(device.id)} · ${safe(seen)}</p>
      </div>
      <div class="spacer"></div>
      ${here}${mark}${out}
    </li>`;
  }

  /** Closing another session is the homeserver asking who you are again, so it asks for the password. */
  private async revoke(deviceId: string): Promise<void> {
    const password = window.prompt("Tu contraseña, para cerrar esa sesión");
    if (!password) return;
    try {
      await this.client.devices.signOut([deviceId], { password });
      await this.paintSessions();
    } catch (error) {
      this.show(error);
    }
  }

  private async signOut(): Promise<void> {
    await this.client.stop().catch(() => undefined);
    this.signedOut();
  }

  private show(error: unknown): undefined {
    const where = element("account-wrong");
    where.textContent = error instanceof Error ? error.message : String(error);
    where.hidden = false;
    return undefined;
  }
}

/** What a connection that is not connected means to somebody looking at the screen. */
function whatIsWrong(status: string): string {
  return status === "connecting" ? "conectando…" : "sin conexión";
}
