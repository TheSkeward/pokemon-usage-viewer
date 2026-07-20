import stylistic from "@stylistic/eslint-plugin";

/**
 * Google JS Style Guide, the enforceable subset (jsguide sections 4–6):
 * 2-space indent, single quotes, required semicolons, brace style, camelCase
 * with CONSTANT_CASE for module constants, const/let only, === with the
 * `== null` idiom allowed. 80-column limit reported as a warning: rewrapping
 * is manual and land-as-touched.
 */
export default [
  {
    files: ["src/**/*.js", "scripts/**/*.mjs", "test/**/*.mjs"],
    ignores: ["src/generated/**"],
    plugins: { "@stylistic": stylistic },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { __BUILD_ID__: "readonly" },
    },
    rules: {
      "@stylistic/indent": ["error", 2],
      "@stylistic/quotes": ["error", "single", { avoidEscape: true, allowTemplateLiterals: "always" }],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/brace-style": ["error", "1tbs"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      // 80 columns per jsguide 4.4, with its listed exceptions: module
      // import/export statements, URLs, and string/template literals that
      // cannot reasonably be split (the view HTML templates).
      "@stylistic/max-len": ["error", {
        code: 80,
        ignoreUrls: true,
        ignorePattern: "^\\s*(import[\\s\\{]|export\\s.*from|\\} from)",
        ignoreTemplateLiterals: true,
        ignoreStrings: true,
        ignoreRegExpLiterals: true,
      }],
      "no-var": "error",
      "prefer-const": "error",
      camelcase: ["error", { properties: "never" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
];
