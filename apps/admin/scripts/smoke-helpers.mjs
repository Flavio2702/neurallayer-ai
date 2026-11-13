import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import process from "node:process";

export const SERVER_READY_TIMEOUT_MS = 45_000;
export const DEVTOOLS_READY_TIMEOUT_MS = 15_000;
export const PAGE_NAVIGATION_TIMEOUT_MS = 20_000;
export const PAGE_ASSERTION_TIMEOUT_MS = 30_000;
export const PROCESS_EXIT_TIMEOUT_MS = 10_000;
export const LOG_TAIL_LINE_COUNT = 80;

export function createSmokeLogger(commandName) {
  return function logStep(message) {
    console.log(`[${commandName}] ${message}`);
  };
}

export function createWorkspaceRequire(importMetaUrl) {
  return createRequire(importMetaUrl);
}

export function createSmokeError(message, cause) {
  const error = new Error(message);

  if (cause) {
    error.cause = cause;
  }

  return error;
}

export function getCorepackCommand() {
  return process.platform === "win32" ? "corepack.cmd" : "corepack";
}

export function resolveSpawnCommand(command, args) {
  if (process.platform === "win32" && /\.cmd$/i.test(command)) {
    return {
      command: "cmd.exe",
      args: ["/c", command, ...args],
    };
  }

  return {
    command,
    args,
  };
}

export function tailLines(lines, count = LOG_TAIL_LINE_COUNT) {
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

export function pushChunk(lines, chunk) {
  const parts = String(chunk)
    .replace(/\r/g, "")
    .split("\n")
    .filter((part) => part.length > 0);

  lines.push(...parts);

  if (lines.length > LOG_TAIL_LINE_COUNT) {
    lines.splice(0, lines.length - LOG_TAIL_LINE_COUNT);
  }
}

export function formatManagedProcessLogs(processInfo) {
  const stdout = tailLines(processInfo.stdoutLines);
  const stderr = tailLines(processInfo.stderrLines);

  return [
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function waitFor(check, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (lastError instanceof Error) {
    throw createSmokeError(
      `Timed out waiting for ${label}: ${lastError.message}`,
      lastError,
    );
  }

  throw createSmokeError(`Timed out waiting for ${label}.`);
}

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        if (!address || typeof address === "string") {
          reject(createSmokeError("Could not resolve a temporary local port."));
          return;
        }

        resolve(address.port);
      });
    });

    server.on("error", reject);
  });
}

export function resolveBrowserExecutablePath() {
  const explicitPath =
    process.env.ADMIN_SMOKE_BROWSER ??
    process.env.BROWSER_EXECUTABLE_PATH ??
    null;

  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const windowsCandidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const macCandidates = [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const linuxCandidates = [
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  ];

  const candidates =
    process.platform === "win32"
      ? windowsCandidates
      : process.platform === "darwin"
        ? macCandidates
        : linuxCandidates;

  const discoveredPath = candidates.find((candidate) => existsSync(candidate));

  if (discoveredPath) {
    return discoveredPath;
  }

  throw createSmokeError(
    "No Edge/Chrome executable was found. Set ADMIN_SMOKE_BROWSER to a local Chromium-based browser path.",
  );
}

export function createSmokeCommandEnv(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: "production",
    ...overrides,
  };
}

export async function runCheckedCommand(logStep, input) {
  logStep(input.label);
  const spawnCommand = resolveSpawnCommand(input.command, input.args);

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(
        createSmokeError(
          `${input.label} failed before start: ${error.message}`,
          error,
        ),
      );
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        createSmokeError(
          `${input.label} exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

export function startManagedProcess(input) {
  const stdoutLines = [];
  const stderrLines = [];
  const spawnCommand = resolveSpawnCommand(input.command, input.args);
  const child = spawn(spawnCommand.command, spawnCommand.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let startupError = null;

  child.stdout?.on("data", (chunk) => {
    pushChunk(stdoutLines, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    pushChunk(stderrLines, chunk);
  });
  child.on("error", (error) => {
    startupError = error;
    pushChunk(stderrLines, error.message);
  });

  return {
    child,
    label: input.label,
    stdoutLines,
    stderrLines,
    get startupError() {
      return startupError;
    },
  };
}

export function startBrowserProcess(input) {
  const child = spawn(
    input.browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${input.debugPort}`,
      `--user-data-dir=${input.browserProfileDir}`,
      "about:blank",
    ],
    {
      stdio: "ignore",
    },
  );
  let startupError = null;

  child.on("error", (error) => {
    startupError = error;
  });

  return {
    child,
    get startupError() {
      return startupError;
    },
  };
}

export async function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        {
          stdio: "ignore",
        },
      );

      killer.on("error", () => resolve());
      killer.on("exit", () => resolve());
    });

    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_TIMEOUT_MS)),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

export async function waitForServerReady(input) {
  const readyUrl = `${input.baseUrl}/login`;

  await waitFor(
    async () => {
      if (input.processInfo.startupError) {
        throw createSmokeError(
          `${input.processInfo.label} failed to start: ${input.processInfo.startupError.message}`,
          input.processInfo.startupError,
        );
      }

      if (input.processInfo.child.exitCode !== null) {
        throw createSmokeError(
          `${input.processInfo.label} exited before ${readyUrl} became reachable.\n\n${formatManagedProcessLogs(input.processInfo)}`,
        );
      }

      const response = await fetch(readyUrl);

      return response.ok ? response.status : null;
    },
    SERVER_READY_TIMEOUT_MS,
    `admin server readiness at ${readyUrl}`,
  );
}

export async function waitForDevToolsReady(debugPort, browserProcessInfo) {
  await waitFor(
    async () => {
      if (browserProcessInfo.startupError) {
        throw createSmokeError(
          `Headless browser failed to start: ${browserProcessInfo.startupError.message}`,
          browserProcessInfo.startupError,
        );
      }

      if (browserProcessInfo.child.exitCode !== null) {
        throw createSmokeError(
          "Headless browser exited before DevTools was ready.",
        );
      }

      const response = await fetch(
        `http://127.0.0.1:${debugPort}/json/version`,
      );

      return response.ok ? response.status : null;
    },
    DEVTOOLS_READY_TIMEOUT_MS,
    "browser DevTools endpoint",
  );
}

export async function openBrowserTarget(debugPort) {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?about:blank`,
    {
      method: "PUT",
    },
  );

  if (!response.ok) {
    throw createSmokeError(
      `Could not create a new DevTools target: HTTP ${response.status}.`,
    );
  }

  return response.json();
}

export async function closeBrowserTarget(debugPort, targetId) {
  if (!targetId) {
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${targetId}`, {
      method: "PUT",
    });
  } catch {
    // Best effort cleanup for local smoke state.
  }
}

export async function createPageClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = (event) => {
      reject(
        createSmokeError(
          `Could not open the browser target websocket: ${event.message ?? "unknown error"}.`,
        ),
      );
    };
  });

  let commandId = 0;
  const pending = new Map();

  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));

    if (typeof message.id !== "number") {
      return;
    }

    const entry = pending.get(message.id);

    if (!entry) {
      return;
    }

    pending.delete(message.id);

    if (message.error) {
      entry.reject(
        createSmokeError(message.error.message ?? "A browser command failed."),
      );
      return;
    }

    entry.resolve(message.result);
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw createSmokeError(
        result.exceptionDetails.text ?? "A page evaluation failed.",
      );
    }

    return result.result.value;
  }

  async function navigate(url, expectedPath) {
    await send("Page.navigate", { url });
    await waitFor(
      async () => {
        const state = await evaluate(
          `({ path: location.pathname, href: location.href, ready: document.readyState })`,
        );

        return state.ready === "complete" &&
          (!expectedPath || state.path === expectedPath)
          ? state
          : null;
      },
      PAGE_NAVIGATION_TIMEOUT_MS,
      `navigation to ${url}`,
    );
  }

  return {
    async enable() {
      await send("Runtime.enable");
      await send("Page.enable");
    },
    evaluate,
    navigate,
    async close() {
      socket.close();
    },
  };
}
