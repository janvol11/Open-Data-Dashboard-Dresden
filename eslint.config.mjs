import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next/**", "next-env.d.ts"]),
  {
    extends: [...next, ...coreWebVitals, ...typescript],
    rules: {
      // _foo darf ungenutzt bleiben
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
