/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime", // For new JSX transform
    "plugin:react-hooks/recommended",
    "prettier", // Turns off rules that conflict with Prettier
  ],
  plugins: [
    "@typescript-eslint",
    "react",
    "react-hooks",
    "prettier", // Runs Prettier as an ESLint rule
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: "detect", // Automatically detect React version
    },
  },
  rules: {
    "prettier/prettier": "warn", // Show Prettier issues as warnings
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_" },
    ],
    // Add any project-specific rules here
  },
  overrides: [
    {
      // Disable node-specific rules for React files
      files: ['packages/ui/**/*'],
      env: {
        node: false,
        browser: true
      }
    }
  ],
  ignorePatterns: [
    "node_modules/",
    "dist/",
    ".eslintrc.js", // Don't lint itself if we use this format
    "*.config.js", // Ignore other config files by default
  ],
}; 