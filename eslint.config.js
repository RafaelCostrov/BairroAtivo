import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/.expo/**", "**/dist/**"] },
  {
    files: ["server/**/*.ts", "shared/**/*.ts", "mobile/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
);
