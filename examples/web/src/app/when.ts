/** Times, as somebody reading them wants them: the clock for today, the day for anything older. */

export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

/** The heading between one day of talk and the next. */
export function dayOf(at: number): string {
  const then = new Date(at);
  const today = new Date();
  if (then.toDateString() === today.toDateString()) return "Hoy";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return "Ayer";
  return then.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

/** How long a call lasted, said the way somebody would say it out loud. */
export function lastedFor(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** A call going on, counted up on a clock. */
export function runningFor(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
