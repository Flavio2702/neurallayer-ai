import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveGatewayBootstrapPaths(importMetaUrl = import.meta.url) {
  const scriptPath = fileURLToPath(importMetaUrl);
  const scriptsDir = dirname(scriptPath);
  const gatewayAppDir = resolve(scriptsDir, "..");
  const repoRootDir = resolve(scriptsDir, "../../..");

  return {
    gatewayAppDir,
    repoRootDir,
    repoEnvFilePath: resolve(repoRootDir, ".env"),
  };
}

export function loadGatewayBootstrapEnv({
  importMetaUrl = import.meta.url,
  processObject = process,
  fileExists = existsSync,
} = {}) {
  const { repoEnvFilePath } = resolveGatewayBootstrapPaths(importMetaUrl);

  if (!fileExists(repoEnvFilePath)) {
    return {
      envFilePath: repoEnvFilePath,
      loaded: false,
    };
  }

  processObject.loadEnvFile(repoEnvFilePath);

  return {
    envFilePath: repoEnvFilePath,
    loaded: true,
  };
}

function createGatewayBootstrapRequire(importMetaUrl = import.meta.url) {
  return createRequire(importMetaUrl);
}

function resolveGatewaySpawnConfig({
  importMetaUrl = import.meta.url,
  mode,
  processObject = process,
  requireFn = createGatewayBootstrapRequire(importMetaUrl),
}) {
  const command = processObject.execPath ?? process.execPath;
  const { gatewayAppDir } = resolveGatewayBootstrapPaths(importMetaUrl);

  switch (mode) {
    case "dev":
      return {
        command,
        args: [requireFn.resolve("tsx/cli"), "watch", "src/server.ts"],
        cwd: gatewayAppDir,
      };
    case "start":
      return {
        command,
        args: ["dist/server.js"],
        cwd: gatewayAppDir,
      };
    default:
      throw new Error(
        `Unsupported gateway bootstrap mode "${mode}". Expected "dev" or "start".`,
      );
  }
}

function resolveGatewayExitCode(code, signal) {
  if (typeof code === "number") {
    return code;
  }

  if (signal) {
    return 1;
  }

  return 0;
}

export function runGatewayServer({
  importMetaUrl = import.meta.url,
  argv = process.argv,
  processObject = process,
  fileExists = existsSync,
  requireFn = createGatewayBootstrapRequire(importMetaUrl),
  spawnFn = spawn,
} = {}) {
  loadGatewayBootstrapEnv({
    importMetaUrl,
    processObject,
    fileExists,
  });

  const mode = argv[2] ?? "dev";
  const spawnConfig = resolveGatewaySpawnConfig({
    importMetaUrl,
    mode,
    processObject,
    requireFn,
  });
  const child = spawnFn(spawnConfig.command, spawnConfig.args, {
    cwd: spawnConfig.cwd,
    stdio: "inherit",
    env: {
      ...(processObject.env ?? {}),
    },
  });

  child.on("exit", (code, signal) => {
    processObject.exit(resolveGatewayExitCode(code, signal));
  });

  return child;
}

function isExecutedDirectly(
  importMetaUrl = import.meta.url,
  argv = process.argv,
) {
  const entryPoint = argv[1];

  if (!entryPoint) {
    return false;
  }

  return fileURLToPath(importMetaUrl) === resolve(entryPoint);
}

if (isExecutedDirectly()) {
  runGatewayServer();
}
