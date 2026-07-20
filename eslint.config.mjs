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
      "@stylistic/quotes": ["error", "single", { avoidEscape: true, allowTemplateLiterals: true }],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/brace-style": ["error", "1tbs"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/max-len": ["warn", { code: 80, ignoreUrls: true, ignoreTemplateLiterals: true, ignoreStrings: true }],
      "no-var": "error",
      "prefer-const": "error",
      // SCORING.md's quantile-feature notation (damage_q, bulk_q, ...) is the
      // scoring contract's own language; the code keeps it verbatim.
      camelcase: ["error", { properties: "never", allow: ["^[a-z][a-zA-Z]*(_[a-z]+)*_q$"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
];
