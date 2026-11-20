/**
 * Reader presentation mode. Undefined honours the plan as-is. "side" is side by side: each
 * sentence with its English, rendered by `SideBySide` rather than `Reader`.
 */
export type ReaderMode = "read" | "cloze" | "gloss" | "side";
