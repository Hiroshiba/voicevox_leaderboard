import eslint from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import typescriptEslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: typescriptEslint.parser,
        extraFileExtensions: [".vue"],
      },
    },
  },
  {
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        MouseEvent: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      eqeqeq: ["error", "always", { null: "never" }],
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression",
          message: "型アサーションは使わず、型または処理構造を修正してください。",
        },
        {
          selector: "TSNonNullExpression",
          message: "non-null assertion は使わず assertNonNullable を使用してください。",
        },
      ],
      "vue/multi-word-component-names": "off",
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["error", "warn", "log"] }],
    },
  },
];
