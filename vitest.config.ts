import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@referral/core": pkg("core"),
      "@referral/access": pkg("access"),
      "@referral/ingest": pkg("ingest"),
      "@referral/bundle": pkg("bundle"),
      "@referral/signals": pkg("signals"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "tools/**/*.test.ts"],
    environment: "node",
  },
});
