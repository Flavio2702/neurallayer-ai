import type { Database } from "./client";
import { createConfiguredDbConnection } from "./client";

export async function withDatabase<T>(
  database: Database | undefined,
  callback: (db: Database) => Promise<T>,
): Promise<T> {
  if (database) {
    return callback(database);
  }

  const { db, queryClient } = createConfiguredDbConnection();

  try {
    return await callback(db);
  } finally {
    await queryClient.end({ timeout: 5 });
  }
}
