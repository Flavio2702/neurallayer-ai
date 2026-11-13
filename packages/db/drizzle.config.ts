import { loadDatabaseConfig } from "@neuralayer/config";
import type { Config } from "drizzle-kit";

const {
  database: { url: databaseUrl },
} = loadDatabaseConfig();

export default {
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
