import { createConfiguredDbConnection, type Database } from "@neuralayer/db";

export type OptionalDatabaseResult<T> =
  | {
      available: true;
      value: T;
    }
  | {
      available: false;
    };

export async function tryWithDatabase<T>(
  operation: (database: Database) => Promise<T>,
): Promise<OptionalDatabaseResult<T>> {
  const { db, queryClient } = createConfiguredDbConnection();

  try {
    return {
      available: true,
      value: await operation(db),
    };
  } catch {
    return {
      available: false,
    };
  } finally {
    await queryClient.end({ timeout: 5 }).catch(() => undefined);
  }
}
