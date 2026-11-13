import { loadDatabaseConfig } from "@neuralayer/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export function createDbConnection(databaseUrl: string) {
  const queryClient = postgres(databaseUrl, {
    prepare: false,
  });

  return {
    db: drizzle(queryClient, { schema }),
    queryClient,
  };
}

export function createConfiguredDbConnection() {
  const {
    database: { url },
  } = loadDatabaseConfig();

  return createDbConnection(url);
}

export type Database = ReturnType<typeof createDbConnection>["db"];
