// Activity codes: MasterFormat-style work codes ("03-11-00-00") with an optional place suffix
// ("-P", "-C-8"). What a suffix means is the project's own: the office names them once on the
// start page and they arrive with Labour Detail (master.places). Nothing here knows a suffix.

const PAIR = /^\d\d$/;

/** "03-11-00-00-C-8" -> "C-8"; "03-44-13-15-05-A" -> "A"; null without one (as the server does). */
export function placeSuffix(code: string): string | null {
  const parts = code.trim().split("-");
  if (parts.length < 5 || !parts.slice(0, 4).every((p) => PAIR.test(p))) return null;
  let rest = parts.slice(4);
  while (rest.length && /^\d+$/.test(rest[0])) rest = rest.slice(1);
  return rest.length ? rest.join("-") : null;
}

/** The place name of a code, if the office named its suffix. */
export function placeName(code: string, places: Record<string, string> | undefined): string | null {
  const suffix = placeSuffix(code);
  return (suffix && places?.[suffix]) || null;
}
