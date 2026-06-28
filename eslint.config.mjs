import next from "eslint-config-next";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "drizzle/**"] },
  ...next,
  {
    rules: {
      // New, aggressive heuristic in eslint-config-next 16 that mis-flags the
      // legitimate fetch/poll-on-mount and reset-derived-state effect patterns
      // used across the client pages — the very cases React's own docs allow.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
