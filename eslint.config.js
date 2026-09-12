import js from "@eslint/js";
import typescript from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Nothing here warns. A warning is a thing nobody fixes and everybody scrolls past, so what matters is an
 * error and what does not is not a rule at all: `npm run lint` passes with zero of both.
 *
 * Formatting is not argued about here either — that is Prettier's job, and `eslint-config-prettier` turns
 * off every rule the two of them would disagree about.
 */
/**
 * An underscore is somebody saying "I know, and I do not want it": a field dropped on the way past, an
 * argument a signature demands. Naming it that way is the intent, so it is not a mistake to report. Written
 * once and used everywhere, because the rule meaning one thing in `src` and another in `tests` is how a
 * codebase ends up with two habits.
 */
const unusedVars = [
  "error",
  {
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
    destructuredArrayIgnorePattern: "^_",
    ignoreRestSiblings: true
  }
];

export default typescript.config(
  { ignores: ["**/dist/**", "node_modules/**", "infrastructure/**"] },
  js.configs.recommended,
  ...typescript.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      // TypeScript refuses to compile a name that is not there, and it knows the browser and node types this
      // project declares. Asking ESLint to work the same thing out again only produces noise.
      "no-undef": "off",
      // The reason this project exists is that an application never meets a Matrix type. A cast is how one
      // escapes, so these are errors and not preferences.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": unusedVars,
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      "no-var": "error"
    }
  },
  {
    // Tests and the smoke checks are plain JavaScript that node runs. There is nothing to type-check.
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "*.js"],
    ...typescript.configs.disableTypeChecked,
    // Browser names as well as node's: the storage tests run IndexedDB under a stand-in for it.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "@typescript-eslint/no-unused-vars": unusedVars }
  },
  {
    // The Electron checks are loaded by Electron itself, the old way.
    files: ["scripts/**/*.cjs"],
    ...typescript.configs.disableTypeChecked,
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": unusedVars
    }
  },
  {
    // The examples are their own applications with their own build, and they run in a page as well as in
    // node. They are read for their mistakes, not for their types.
    files: ["examples/**/*.{ts,js,cjs,mjs}"],
    ...typescript.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": unusedVars
    }
  },
  prettier
);
