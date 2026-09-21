import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// Die Basiskonfiguration von eslint-config-next enthält keine Regel gegen
// ungenutzte Bezeichner. Erst "typescript" schaltet
// @typescript-eslint/no-unused-vars scharf, "core-web-vitals" stuft die
// Next.js-Performance-Hinweise von Warnung auf Fehler hoch.
export default defineConfig([
  globalIgnores([".next/**", "next-env.d.ts"]),
  {
    extends: [...next, ...coreWebVitals, ...typescript],
    rules: {
      // Bewusst ungenutzte Bezeichner lassen sich mit einem führenden
      // Unterstrich kennzeichnen, etwa nicht benötigte Fehlerobjekte.
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
