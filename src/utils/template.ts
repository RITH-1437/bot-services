export interface TemplateVars {
  /** Ready-to-use mention for the target parse mode. */
  mention: string;
  /** Display name, escaped for the target parse mode. */
  name: string;
  /** "@username" or empty string. */
  username: string;
  /** Group title, escaped for the target parse mode. */
  group: string;
  /** Group public @username, or empty string. */
  groupUsername: string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const TEMPLATE_VARIABLES = [
  "mention",
  "name",
  "username",
  "group",
  "groupUsername",
] as const;

/**
 * Renders a welcome template. Values must already be escaped for the output
 * format. Unknown placeholders are left untouched and reported, so a typo is
 * visible in the logs instead of silently producing an empty gap.
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
  onUnknownVariable?: (name: string) => void,
): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    if (name in vars) {
      const value = vars[name as keyof TemplateVars];
      return value ?? "";
    }
    onUnknownVariable?.(name);
    return match;
  });
}
