import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/modules/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_FILE_NAME!,
  },
  strict: true,
  verbose: true,
});
