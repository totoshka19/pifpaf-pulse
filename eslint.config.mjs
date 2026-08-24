import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // `eslint-config-next/typescript` включает `@typescript-eslint/no-unused-vars`
  // без опций — дефолтный `args: 'after-used'` не гасит последний неиспользуемый
  // позиционный аргумент, даже если он назван с `_` (соглашение уже используется
  // в проекте: `_request: Request` в обработчиках маршрутов). Точечный override
  // делает соглашение рабочим на самом правиле, а не только по договорённости.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
