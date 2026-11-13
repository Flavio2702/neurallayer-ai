import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveAdminBootstrapPaths(importMetaUrl = import.meta.url) {
  const scriptPath = fileURLToPath(importMetaUrl);
  const scriptsDir = dirname(scriptPath);
  const adminAppDir = resolve(scriptsDir, "..");
  const repoRootDir = resolve(scriptsDir, "../../..");

  return {
    adminAppDir,
    repoRootDir,
    repoEnvFilePath: resolve(repoRootDir, ".env"),
  };
}

export function loadAdminBootstrapEnv({
  importMetaUrl = import.meta.url,
  processObject = process,
  fileExists = existsSync,
} = {}) {
  const { repoEnvFilePath } = resolveAdminBootstrapPaths(importMetaUrl);

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

function createAdminBootstrapRequire(importMetaUrl = import.meta.url) {
  return createRequire(importMetaUrl);
}

export function runAdminNext({
  importMetaUrl = import.meta.url,
  argv = process.argv,
  processObject = process,
  requireFn = createAdminBootstrapRequire(importMetaUrl),
  spawnFn = spawn,
} = {}) {
  loadAdminBootstrapEnv({
    importMetaUrl,
    processObject,
  });

  const { loadAdminAccessGateConfig, loadAdminConfig, loadAdminSessionConfig } =
    requireFn("@neuralayer/config");
  const nextBin = requireFn.resolve("next/dist/bin/next");
  const command = processObject.execPath ?? process.execPath;
  const mode = argv[2] ?? "dev";

  loadAdminAccessGateConfig();
  loadAdminSessionConfig();

  const config = loadAdminConfig();
  const adminPort = String(config.admin.port);
  const { adminAppDir } = resolveAdminBootstrapPaths(importMetaUrl);
  const child = spawnFn(command, [nextBin, mode, "-p", adminPort], {
    cwd: adminAppDir,
    stdio: "inherit",
    env: {
      ...processObject.env,
      ADMIN_PORT: adminPort,
      NEXT_PUBLIC_GATEWAY_URL: config.public.gatewayUrl,
    },
  });

  child.on("exit", (code) => {
    processObject.exit(code ?? 0);
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
  runAdminNext();
}
