import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "server/nlp/**",
      "**/*.config.*",
      ".claude/**",
      "apps/desktop/src-tauri/target/**",
      "apps/desktop/src-tauri/gen/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The desktop app's injected bridge script (plain browser JS).
  { files: ["apps/desktop/src-tauri/src/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // The service worker template (built into /sw.js by apps/web/vite.config.ts).
  {
    files: ["apps/web/sw/**/*.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, __VUURTOREN_SW_PRECACHE__: "readonly" },
    },
  },
  // Type-aware rules, on source files only (tests and scripts stay fast and untyped).
  {
    files: ["{apps,packages,tools}/*/src/**/*.{ts,tsx}", "server/api/src/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}", "**/test-setup.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A switch over a union handles every member (or says what the default stands for).
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
);
