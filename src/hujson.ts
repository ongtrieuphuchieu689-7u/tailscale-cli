function findDelimiterEnd(
  text: string,
  openIndex: number,
  open: "{" | "[",
  close: "}" | "]",
): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function indentOf(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const match = /^[\t ]*/.exec(text.slice(lineStart, index));
  return match ? match[0] : "";
}

export type HuJsonSectionShape = "object" | "array";

/**
 * Merge `items` into the `key` section (`{...}` object or `[...]` array) of a
 * HuJSON document while preserving existing comments, formatting and trailing
 * commas. Each item is a pre-rendered line, e.g. `"tag:ci": ["tag:admin"]` or
 * `{ "target": ["tag:ci"], "attr": ["funnel"] }`. Returns the original text
 * unchanged when the target cannot be located.
 */
export function ensureHuJsonSection(
  raw: string,
  key: string,
  items: string[],
  shape: HuJsonSectionShape = "object",
): string {
  const nonEmpty = items.map((item) => item.trim()).filter(Boolean);
  if (!nonEmpty.length) return raw;
  const openChar = shape === "array" ? "[" : "{";
  const closeChar = shape === "array" ? "]" : "}";
  const render = (indent: string): string =>
    nonEmpty.map((line) => `${indent}${line}`).join(",\n");

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyMatch = new RegExp(`"${escapedKey}"\\s*:[\\s]*([{[])`).exec(raw);

  if (keyMatch) {
    const open = keyMatch.index + keyMatch[0].lastIndexOf(openChar);
    if (open === -1) return raw;
    const close = findDelimiterEnd(raw, open, openChar, closeChar);
    if (close === -1) return raw;
    const body = raw.slice(open + 1, close);
    const closingIndent = indentOf(raw, close);
    if (!body.trim()) {
      const innerIndent = `${closingIndent}  `;
      const replacement = `${openChar}\n${render(innerIndent)}\n${closingIndent}${closeChar}`;
      return `${raw.slice(0, open)}${replacement}${raw.slice(close + 1)}`;
    }
    const insert = nonEmpty
      .map((line) => `${closingIndent}${line},`)
      .join("\n");
    return `${raw.slice(0, close)}${body.endsWith("\n") ? "" : "\n"}${insert}\n${raw.slice(close)}`;
  }

  const firstOpen = raw.indexOf("{");
  if (firstOpen === -1) return raw;
  const outerIndent = indentOf(raw, firstOpen);
  const inner = `${outerIndent}  `;
  const deeper = `${inner}  `;
  const block = `${openChar}\n${render(deeper)}\n${inner}${closeChar}`;
  return `${raw.slice(0, firstOpen + 1)}\n${inner}"${key}": ${block},\n${raw.slice(firstOpen + 1)}`;
}

export function ensureHuJsonKey(
  raw: string,
  key: string,
  entries: Record<string, string[]>,
): string {
  return ensureHuJsonSection(
    raw,
    key,
    Object.entries(entries).map(
      ([name, value]) => `"${name}": ${JSON.stringify(value)}`,
    ),
    "object",
  );
}

export function ensureHuJsonArrayItem(
  raw: string,
  key: string,
  item: unknown,
): string {
  return ensureHuJsonSection(raw, key, [JSON.stringify(item)], "array");
}
