// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // SDK 57 pulled in eslint-plugin-react-hooks v7, whose `recommended`
      // config ships React Compiler rules as errors. The codebase predates
      // them (the fetch-on-mount pattern in every hook trips
      // set-state-in-effect); the compiler degrades gracefully — uncompliant
      // components just skip memoization, nothing breaks at runtime.
      // Re-promote to "error" per-file when deliberately adopting them.
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
    },
  },
  {
    // Node scripts (seed/reset) run in CommonJS outside the Expo runtime.
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
      },
    },
  },
]);
