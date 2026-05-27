import { defineConfig } from "drizzle-kit";

// DATABASE_URL is required for push/pull/studio commands (live DB access).
// For generate and check commands it is not needed — a placeholder is used.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
