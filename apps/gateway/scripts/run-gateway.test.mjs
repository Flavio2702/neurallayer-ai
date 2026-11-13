import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  loadGatewayBootstrapEnv,
  resolveGatewayBootstrapPaths,
  runGatewayServer,
} from "./run-gateway.mjs";

function createFixturePaths(fixtureName) {
  const repoRootDir = join(process.cwd(), fixtureName);
  const importMetaUrl = pathToFileURL(
    join(repoRootDir, "apps", "gateway", "scripts", "run-gateway.mjs"),
  ).href;

  return {
    repoRootDir,
    gatewayAppDir: join(repoRootDir, "apps", "gateway"),
    repoEnvFilePath: join(repoRootDir, ".env"),
    importMetaUrl,
  };
}

test("resolveGatewayBootstrapPaths points to the repo root .env from the gateway script location", () => {
  const fixture = createFixturePaths(".tmp-run-gateway-fixture");
  const paths = resolveGatewayBootstrapPaths(fixture.importMetaUrl);

  assert.equal(paths.repoRootDir, fixture.repoRootDir);
  assert.equal(paths.gatewayAppDir, fixture.gatewayAppDir);
  assert.equal(paths.repoEnvFilePath, fixture.repoEnvFilePath);
});

test("loadGatewayBootstrapEnv loads the repo root .env when present", () => {
  const fixture = createFixturePaths(".tmp-run-gateway-loads-root-env");
  const loadedEnvPaths = [];

  const result = loadGatewayBootstrapEnv({
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

test("loadGatewayBootstrapEnv tolerates a missing repo root .env and does not look for apps/gateway/.env", () => {
  const fixture = createFixturePaths(".tmp-run-gateway-missing-root-env");
  const checkedPaths = [];
  let loadCalls = 0;

  const result = loadGatewayBootstrapEnv({
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

test("runGatewayServer launches tsx watch with the root env loaded in dev mode", () => {
  const fixture = createFixturePaths(".tmp-run-gateway-dev");
  const loadedEnvPaths = [];
  const exitCodes = [];
  const childHandlers = {};
  const spawnCalls = [];
  const child = {
    on(eventName, handler) {
      childHandlers[eventName] = handler;
    },
  };
  const processObject = {
    argv: ["node", "run-gateway.mjs", "dev"],
    env: {
      EXISTING_ENV: "preserved",
    },
    execPath: "node.exe",
    loadEnvFile(envFilePath) {
      loadedEnvPaths.push(envFilePath);
    },
    exit(code) {
      exitCodes.push(code);
    },
  };

  const returnedChild = runGatewayServer({
    importMetaUrl: fixture.importMetaUrl,
    argv: processObject.argv,
    processObject,
    fileExists(envFilePath) {
      return envFilePath === fixture.repoEnvFilePath;
    },
    requireFn: {
      resolve(specifier) {
        assert.equal(specifier, "tsx/cli");
        return "C:/tooling/tsx-cli.mjs";
      },
    },
    spawnFn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  assert.equal(returnedChild, child);
  assert.deepEqual(loadedEnvPaths, [fixture.repoEnvFilePath]);
  assert.deepEqual(spawnCalls, [
    {
      command: "node.exe",
      args: ["C:/tooling/tsx-cli.mjs", "watch", "src/server.ts"],
      options: {
        cwd: fixture.gatewayAppDir,
        stdio: "inherit",
        env: {
          EXISTING_ENV: "preserved",
        },
      },
    },
  ]);

  childHandlers.exit?.(7);
  assert.deepEqual(exitCodes, [7]);
});

test("runGatewayServer launches the compiled gateway server in start mode", () => {
  const fixture = createFixturePaths(".tmp-run-gateway-start");
  const processObject = {
    argv: ["node", "run-gateway.mjs", "start"],
    env: {
      EXISTING_ENV: "preserved",
    },
    execPath: "node.exe",
    loadEnvFile() {},
    exit() {},
  };
  const spawnCalls = [];

  runGatewayServer({
    importMetaUrl: fixture.importMetaUrl,
    argv: processObject.argv,
    processObject,
    spawnFn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return {
        on() {},
      };
    },
  });

  assert.deepEqual(spawnCalls, [
    {
      command: "node.exe",
      args: ["dist/server.js"],
      options: {
        cwd: fixture.gatewayAppDir,
        stdio: "inherit",
        env: {
          EXISTING_ENV: "preserved",
        },
      },
    },
  ]);
});

test("runGatewayServer exits non-zero when the child terminates due to a signal", () => {
  const fixture = createFixturePaths(".tmp-run-gateway-signal");
  const exitCodes = [];
  let exitHandler;
  const processObject = {
    argv: ["node", "run-gateway.mjs", "start"],
    env: {},
    execPath: "node.exe",
    loadEnvFile() {},
    exit(code) {
      exitCodes.push(code);
    },
  };

  runGatewayServer({
    importMetaUrl: fixture.importMetaUrl,
    argv: processObject.argv,
    processObject,
    spawnFn() {
      return {
        on(eventName, handler) {
          if (eventName === "exit") {
            exitHandler = handler;
          }
        },
      };
    },
  });

  exitHandler?.(null, "SIGTERM");
  assert.deepEqual(exitCodes, [1]);
});
