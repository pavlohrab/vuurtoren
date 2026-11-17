/**
 * Pull one JSON object out of a model reply. Models sometimes wrap JSON in code fences or add a
 * sentence around it, so this tries the whole text, a fenced block, then the outermost braces.
 * @returns the parsed value, or undefined when nothing parses to an object
 */
export function extractJson(text: string): Record<string, unknown> | undefined {
  const candidates: string[] = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v: unknown = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}
