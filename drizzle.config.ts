import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/modules/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "data/db.sqlite",
  },
  strict: true,
  verbose: true,
});
