import type { KeyStanding } from "@relaykit/web";

/** What the banner says, and which ways out it offers. No DOM: this is the decision, not the drawing. */
export interface WayOut {
  readonly title: string;
  readonly under: string;
  readonly act: string;
  readonly canAskAnotherSession: boolean;
}

/**
 * What a device that cannot read what was said before it can actually do about it.
 *
 * Two ways out, and which of them exist depends on the account rather than on the screen. A session of this
 * account that already holds the keys can hand them over — comparing emoji, nothing to type. Otherwise the
 * recovery key is the only thing that opens the copy on the server, and it is the one shown once when the
 * messages were protected: nobody else has it, and it cannot be shown again.
 *
 * Offering the other session when there is no other session is offering a door onto a wall, and saying "a copy
 * of your keys" without saying which key it wants is how somebody ends up pressing a button three times asking
 * what it means.
 */
export function whatOpensThese(standing: KeyStanding, account: { readonly otherSessions: number }): WayOut {
  if (standing === "never-protected") {
    return {
      title: "Tus mensajes cifrados no están protegidos",
      under: "Sin una clave de recuperación, lo que se diga aquí se pierde al cambiar de dispositivo.",
      act: "Proteger mis mensajes",
      canAskAnotherSession: false
    };
  }
  const title = "Este dispositivo no puede leer los mensajes anteriores";
  const act = "Introducir clave";
  if (account.otherSessions > 0) {
    return {
      title,
      under:
        "Ábrelos desde otra sesión tuya que ya los lea, o con la clave de recuperación que guardaste al " +
        "proteger tus mensajes.",
      act,
      canAskAnotherSession: true
    };
  }
  return {
    title,
    under:
      "La clave de recuperación que guardaste al proteger tus mensajes es la única forma de abrirlos: no " +
      "hay ninguna otra sesión tuya a la que pedírselas.",
    act,
    canAskAnotherSession: false
  };
}
