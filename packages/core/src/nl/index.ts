/**
 * The Dutch rules the device applies itself, in one place (RL0): what a word means here
 * (contextGloss), the line about its form (formLine), and how a sentence is built
 * (sentenceFrame). The language server's rules are in server/nlp (rules/nl and the modules
 * algorithms.md lists); docs/dev/algorithms.md has the index of both.
 */
export * from "./contextGloss.js";
export * from "./formLine.js";
export * from "./sentenceFrame.js";
