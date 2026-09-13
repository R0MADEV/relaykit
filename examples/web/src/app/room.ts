import type { Call, CallParticipant, UserId } from "@relaykit/web";
import type { People } from "./people.js";

/**
 * One box per person on the call, this side included.
 *
 * The boxes are kept between repaints and only what changed is touched: handing a `<video>` the same stream
 * again restarts it, and a call repaints every time anybody so much as unmutes.
 */
export function paintGrid(into: HTMLElement, call: Call, people: People, me: UserId): void {
  const still = new Set<string>();
  for (const person of call.participants) {
    const key = `${person.userId}/${person.deviceId}`;
    still.add(key);
    fill(seatFor(into, key, person.userId === me), person, call, people, me);
  }
  for (const seat of into.querySelectorAll(".seat")) {
    if (seat instanceof HTMLElement && !still.has(seat.dataset.seat ?? "")) seat.remove();
  }
}

function seatFor(into: HTMLElement, key: string, isMe: boolean): HTMLElement {
  const already = into.querySelector(`[data-seat="${CSS.escape(key)}"]`);
  if (already instanceof HTMLElement) return already;
  const seat = document.createElement("div");
  seat.className = "seat";
  seat.dataset.seat = key;
  const picture = document.createElement("video");
  picture.autoplay = true;
  picture.playsInline = true;
  // Your own voice played back to you is an echo, not information.
  picture.muted = isMe;
  const badge = document.createElement("span");
  badge.className = "seat-sharing";
  badge.textContent = "Pantalla";
  const face = document.createElement("span");
  face.className = "avatar";
  const name = document.createElement("span");
  name.className = "seat-name";
  seat.append(badge, picture, face, name);
  into.append(seat);
  return seat;
}

function fill(seat: HTMLElement, person: CallParticipant, call: Call, people: People, me: UserId): void {
  // A shared screen is the thing worth looking at, so it takes the box and the face falls back to initials.
  const showing = person.screen ?? person.media;
  const picture = seat.querySelector("video");
  if (picture instanceof HTMLVideoElement && picture.srcObject !== (showing ?? null)) {
    picture.srcObject = showing ?? null;
  }
  const hasPicture = (showing?.getVideoTracks().length ?? 0) > 0;
  if (picture instanceof HTMLVideoElement) picture.hidden = !hasPicture;
  set(seat, ".avatar", people.initialsOf(person.userId));
  const face = seat.querySelector(".avatar");
  if (face instanceof HTMLElement) face.hidden = hasPicture;
  const mine = person.userId === me ? " (tú)" : "";
  const silenced = person.isMicrophoneMuted ? " 🔇" : "";
  const locked = call.isEncrypted ? " 🔒" : "";
  set(seat, ".seat-name", `${people.nameOf(person.userId)}${mine}${silenced}${locked}`);
  const sharing = Boolean(person.screen);
  seat.toggleAttribute("data-sharing", sharing);
  const badge = seat.querySelector(".seat-sharing");
  if (badge instanceof HTMLElement) badge.hidden = !sharing;
}

function set(seat: HTMLElement, selector: string, text: string): void {
  const found = seat.querySelector(selector);
  if (found instanceof HTMLElement && found.textContent !== text) found.textContent = text;
}
