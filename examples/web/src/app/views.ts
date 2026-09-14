import { element } from "./dom.js";

/** Which of the three things the middle of the screen is showing. */
export type View = "chat" | "rooms" | "lobby";

export function show(view: View): void {
  element("chat-view").hidden = view !== "chat";
  element("rooms-view").hidden = view !== "rooms";
  element("lobby-view").hidden = view !== "lobby";
  // A thread belongs beside the conversation it hangs from. With a room on screen there is no conversation
  // beside it, and leaving the panel up squeezes the room into whatever is left.
  if (view !== "chat") element("thread").hidden = true;
}

export function showing(): View {
  if (!element("rooms-view").hidden) return "rooms";
  if (!element("lobby-view").hidden) return "lobby";
  return "chat";
}
