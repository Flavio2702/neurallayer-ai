import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createConfiguredDbConnection } from "./client";
import { waitForConfiguredDatabaseReady } from "./readiness";

export interface MigrationRunResult {
  applied: boolean;
  migrationsFolder: string;
  skippedReason?: string;
  readinessAttempts?: number;
}

export async function runDbMigrations(): Promise<MigrationRunResult> {
  const migrationsFolder = resolve(process.cwd(), "drizzle");

  if (!existsSync(migrationsFolder)) {
    return {
      applied: false,
      migrationsFolder,
      skippedReason: "No generated Drizzle migrations found.",
    };
  }

  const readiness = await waitForConfiguredDatabaseReady();
  const { db, queryClient } = createConfiguredDbConnection();

  try {
    await migrate(db, { migrationsFolder });

    return {
      applied: true,
      migrationsFolder,
      readinessAttempts: readiness.attempts,
    };
  } finally {
    await queryClient.end({ timeout: 5 });
  }
}

if (require.main === module) {
  runDbMigrations()
    .then((result) => {
      if (result.applied) {
        console.log(
          `Migrations applied from ${result.migrationsFolder} after ${result.readinessAttempts ?? 1} readiness check(s).`,
        );
        return;
      }

      console.log(
        `Migration skipped: ${result.skippedReason ?? "No migration work was performed."}`,
      );
    })
    .catch((error: unknown) => {
      console.error("Migration run failed.", error);
      process.exitCode = 1;
    });
}
