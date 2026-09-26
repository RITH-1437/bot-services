import { escapeHtml } from "./html";

/** Minimal shape of a Telegram user, so tests can pass plain objects. */
export interface UserLike {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export type MentionStyle = "html" | "text";

/** "First Last", falling back to something readable when Telegram sends no name. */
export function displayName(user: UserLike): string {
  const parts = [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim());
  return parts.length > 0 ? parts.join(" ") : "friend";
}

/** "@username" when available, otherwise a clickable mention that hides the numeric id. */
export function buildMention(user: UserLike, style: MentionStyle): string {
  const username = (user.username ?? "").trim();

  if (username !== "") {
    return `@${username}`;
  }

  const name = displayName(user);
  if (style === "text") {
    return name;
  }
  return `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
}

/** "@username" or an empty string, for templates that only want the handle. */
export function buildUsername(user: UserLike): string {
  const username = (user.username ?? "").trim();
  return username === "" ? "" : `@${username}`;
}
