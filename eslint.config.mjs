import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // lib/site/ was carried over unchanged from a previous version and is
    // kept that way deliberately; `next` is never reassigned but its
    // properties are mutated throughout applyOps, so prefer-const doesn't fit.
    files: ["lib/site/ops.ts"],
    rules: {
      "prefer-const": "off",
    },
  },
]);

export default eslintConfig;
