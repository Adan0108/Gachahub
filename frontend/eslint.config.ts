import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([".next", "dist", "node_modules"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: [
      "app/**/*.tsx",
      "components/**/*.{ts,tsx}",
      "hooks/*.ts",
      "hooks/admin/*.ts",
      // Keep lint coverage for every migrated JS hook. Other chat hooks were already TS.
      "hooks/chat/useChatSocket.ts",
      "hooks/chat/useConversationActions.ts",
      "hooks/chat/useConversationMute.ts",
      "hooks/chat/useConversationPreviews.ts",
      "hooks/chat/useLinkPreviewDraft.ts",
      "hooks/chat/useMarkChatRead.ts",
      "hooks/chat/useMessageEdit.ts",
      "hooks/chat/useModalFocusTrap.ts",
      "hooks/chat/useReadWhenSeen.ts",
      "hooks/chat/useReceiptDisplay.ts",
      "hooks/chat/useSidebarMessageSearch.ts",
      "hooks/chat/useStickToBottom.ts",
      "hooks/chat/useThreadMessageSearch.ts",
      "hooks/chat/useTypingNames.ts",
      "lib/*.ts",
      "lib/chat/**/*.ts",
      "lib/admin/**/*.ts",
      "lib/notifications/**/*.ts",
      "lib/socket/**/*.ts",
      "tests/**/*.{ts,tsx}",
      "vitest*.ts",
      "eslint.config.ts",
    ],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      parser: tseslint.parser,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
