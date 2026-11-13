import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  loadAdminBootstrapEnv,
  resolveAdminBootstrapPaths,
} from "./run-next.mjs";

function createFixturePaths(fixtureName) {
  const repoRootDir = join(process.cwd(), fixtureName);
  const importMetaUrl = pathToFileURL(
    join(repoRootDir, "apps", "admin", "scripts", "run-next.mjs"),
  ).href;

  return {
    repoRootDir,
    adminAppDir: join(repoRootDir, "apps", "admin"),
    repoEnvFilePath: join(repoRootDir, ".env"),
    importMetaUrl,
  };
}

test("resolveAdminBootstrapPaths points to the repo root .env from the admin script location", () => {
  const fixture = createFixturePaths(".tmp-run-next-fixture");
  const paths = resolveAdminBootstrapPaths(fixture.importMetaUrl);

  assert.equal(paths.repoRootDir, fixture.repoRootDir);
  assert.equal(paths.adminAppDir, fixture.adminAppDir);
  assert.equal(paths.repoEnvFilePath, fixture.repoEnvFilePath);
});

test("loadAdminBootstrapEnv loads the repo root .env when present", () => {
  const fixture = createFixturePaths(".tmp-run-next-loads-root-env");
  const loadedEnvPaths = [];

  const result = loadAdminBootstrapEnv({
    importMetaUrl: fixture.importMetaUrl,
    processObject: {
      loadEnvFile(envFilePath) {
        loadedEnvPaths.push(envFilePath);
      },
    },
    fileExists(envFilePath) {
      return envFilePath === fixture.repoEnvFilePath;
    },
  });

  assert.deepEqual(loadedEnvPaths, [fixture.repoEnvFilePath]);
  assert.deepEqual(result, {
    envFilePath: fixture.repoEnvFilePath,
    loaded: true,
  });
});

test("loadAdminBootstrapEnv tolerates a missing repo root .env and does not look for apps/admin/.env", () => {
  const fixture = createFixturePaths(".tmp-run-next-missing-root-env");
  const checkedPaths = [];
  let loadCalls = 0;

  const result = loadAdminBootstrapEnv({
    importMetaUrl: fixture.importMetaUrl,
    processObject: {
      loadEnvFile() {
        loadCalls += 1;
      },
    },
    fileExists(envFilePath) {
      checkedPaths.push(envFilePath);
      return false;
    },
  });

  assert.equal(loadCalls, 0);
  assert.deepEqual(checkedPaths, [fixture.repoEnvFilePath]);
  assert.deepEqual(result, {
    envFilePath: fixture.repoEnvFilePath,
    loaded: false,
  });
});
