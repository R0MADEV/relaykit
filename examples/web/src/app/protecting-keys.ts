import type { KeyStanding, MessagingClient, UserId, VerificationSession } from "@relaykit/web";
import { dialog, element, input, onClick, safe } from "./dom.js";

/**
 * What this device can do with what was said before it existed, and the two ways out when the answer is
 * nothing: a recovery key, or another session of this account vouching for it.
 *
 * All of it together because it is one question with one answer at a time. Split across screens, an
 * application ends up offering to make a recovery key to somebody who already has one, which replaces the
 * backup their other devices depend on.
 */
export class ProtectingKeys {
  private standing: KeyStanding = "ready";
  private verifying: VerificationSession | undefined;

  constructor(
    private readonly client: MessagingClient,
    private readonly me: UserId,
    private readonly wentWrong: (error: unknown) => void
  ) {}

  wire(): void {
    onClick("keys-act", () => this.act());
    onClick("keys-verify", () => void this.askAnotherSession());
    onClick("recovery-go", () => void this.recoveryPressed());
    element("recovery-kept").addEventListener("change", () => this.sayWhatTheKeyButtonDoes());
    onClick("verifying-yes", () => void this.verifyingPressed(true));
    onClick("verifying-no", () => void this.verifyingPressed(false));
    // Another session asking to prove itself arrives on its own, whether or not anybody pressed anything here.
    this.client.on("verification.requested", session => this.showVerification(session));
    this.client.on("verification.changed", session => this.showVerification(session));
  }

  /**
   * Asked on the way in, and again whenever something might have changed it.
   *
   * Where it cannot be asked at all, nothing is offered — but the reason is said out loud rather than read
   * as good news. A screen that answers "everything is fine" because the question failed is worse than one
   * that says nothing.
   */
  async look(): Promise<void> {
    try {
      this.standing = await this.client.crypto.standing();
    } catch (error) {
      this.standing = "ready";
      this.wentWrong(error);
    }
    this.paint();
  }

  private paint(): void {
    const banner = element("keys");
    banner.hidden = this.standing === "ready";
    element("keys-verify").hidden = this.standing !== "locked";
    if (this.standing === "never-protected") {
      element("keys-title").textContent = "Tus mensajes cifrados no están protegidos";
      element("keys-under").textContent =
        "Sin una clave de recuperación, lo que se diga aquí se pierde al cambiar de dispositivo.";
      element("keys-act").textContent = "Proteger mis mensajes";
      return;
    }
    element("keys-title").textContent = "Este dispositivo no puede leer los mensajes anteriores";
    element("keys-under").textContent =
      "Hay una copia de tus claves que este dispositivo todavía no ha abierto.";
    element("keys-act").textContent = "Introducir clave";
  }

  // --- the key ---------------------------------------------------------------

  private act(): void {
    const making = this.standing === "never-protected";
    element("recovery-made").hidden = true;
    element("recovery-asking").hidden = making;
    element("recovery-wrong").hidden = true;
    element("recovery-said").textContent = "";
    input("recovery-given").value = "";
    input("recovery-kept").checked = false;
    element("recovery-title").textContent = making ? "Proteger mis mensajes" : "Introducir clave";
    element("recovery-under").textContent = making
      ? "Se creará una clave que solo tú tendrás"
      : "La que guardaste al proteger tus mensajes";
    element("recovery-go").textContent = making ? "Crear clave" : "Desbloquear";
    dialog("recovery").showModal();
  }

  private async recoveryPressed(): Promise<void> {
    if (this.standing === "never-protected") return this.makeTheKey();
    return this.useTheKey();
  }

  private async makeTheKey(): Promise<void> {
    // Already made and shown: the button now only closes it, and only once they say they kept it.
    if (!element("recovery-made").hidden) {
      dialog("recovery").close();
      await this.look();
      return;
    }
    try {
      const made = await this.client.crypto.setupRecovery();
      input("recovery-key").value = made.recoveryKey;
      element("recovery-made").hidden = false;
      element("recovery-asking").hidden = true;
      this.sayWhatTheKeyButtonDoes();
    } catch (error) {
      this.show(error);
    }
  }

  /** It cannot be shown again, so the way out of this dialog is saying it was kept. */
  private sayWhatTheKeyButtonDoes(): void {
    const kept = input("recovery-kept").checked;
    element("recovery-go").textContent = "Hecho";
    element("recovery-go").toggleAttribute("disabled", !kept);
  }

  private async useTheKey(): Promise<void> {
    const key = input("recovery-given").value.trim();
    if (!key) return;
    try {
      const restored = await this.client.crypto.recover(key);
      element("recovery-said").textContent = `${restored.imported} de ${restored.total} claves restauradas`;
      dialog("recovery").close();
      await this.look();
    } catch (error) {
      this.show(error);
    }
  }

  private show(error: unknown): void {
    const where = element("recovery-wrong");
    where.textContent = error instanceof Error ? error.message : String(error);
    where.hidden = false;
  }

  // --- the other session -----------------------------------------------------

  /** Asking this account's other sessions to vouch for this one. Any of them can answer. */
  private async askAnotherSession(): Promise<void> {
    try {
      this.showVerification(await this.client.verification.request(this.me));
    } catch (error) {
      this.wentWrong(error);
    }
  }

  private showVerification(session: VerificationSession): void {
    this.verifying = session;
    const emoji = element("verifying-emoji");
    const yes = element("verifying-yes");
    const no = element("verifying-no");
    emoji.hidden = session.phase !== "sas";
    yes.hidden = false;
    no.hidden = false;
    element("verifying-title").textContent = "Verificar sesión";
    element("verifying-under").textContent = whatIsHappening(session);
    if (session.sas) {
      emoji.innerHTML = session.sas.emoji
        .map(one => `<li><span class="symbol">${safe(one.symbol)}</span>${safe(one.name)}</li>`)
        .join("");
    }
    // What the two buttons mean depends on where this has got to, so they are named from that and not left
    // saying "yes" to something they no longer do.
    if (session.phase === "requested" && !session.initiatedByMe) {
      yes.textContent = "Aceptar";
      no.textContent = "Rechazar";
    } else if (session.phase === "sas") {
      yes.textContent = "Coinciden";
      no.textContent = "No coinciden";
    } else {
      yes.hidden = true;
      no.textContent = "Cerrar";
    }
    if (!dialog("verifying").open) dialog("verifying").showModal();
    if (session.phase === "done") void this.look();
  }

  private async verifyingPressed(agreed: boolean): Promise<void> {
    const session = this.verifying;
    if (!session) return;
    if (session.phase === "done" || session.phase === "cancelled") {
      dialog("verifying").close();
      return;
    }
    try {
      if (!agreed) {
        await this.client.verification[session.phase === "sas" ? "reject" : "cancel"](session.id);
        dialog("verifying").close();
        return;
      }
      const moved =
        session.phase === "sas"
          ? await this.client.verification.confirm(session.id)
          : await this.client.verification.accept(session.id);
      this.showVerification(moved);
    } catch (error) {
      this.wentWrong(error);
    }
  }
}

/** Where the back and forth has got to, said to whoever is looking at it rather than named as a phase. */
function whatIsHappening(session: VerificationSession): string {
  if (session.phase === "requested") {
    return session.initiatedByMe
      ? "Esperando a que lo aceptes en tu otra sesión"
      : "Otra sesión quiere verificarse contigo";
  }
  if (session.phase === "ready" || session.phase === "started") return "Preparando la comparación…";
  if (session.phase === "sas") return "Comprueba que tu otra sesión muestra lo mismo";
  if (session.phase === "done") return "Sesión verificada";
  return session.cancellationReason ?? "La verificación se canceló";
}
