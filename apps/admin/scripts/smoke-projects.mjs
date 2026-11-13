#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  loadAdminBootstrapEnv,
  resolveAdminBootstrapPaths,
} from "./run-next.mjs";
import {
  closeBrowserTarget,
  createPageClient,
  createSmokeCommandEnv,
  createSmokeError,
  createSmokeLogger,
  createWorkspaceRequire,
  formatManagedProcessLogs,
  getCorepackCommand,
  getFreePort,
  killProcessTree,
  openBrowserTarget,
  PAGE_ASSERTION_TIMEOUT_MS,
  PAGE_NAVIGATION_TIMEOUT_MS,
  resolveBrowserExecutablePath,
  runCheckedCommand,
  startBrowserProcess,
  startManagedProcess,
  waitFor,
  waitForDevToolsReady,
  waitForServerReady,
} from "./smoke-helpers.mjs";

const requireWorkspace = createWorkspaceRequire(import.meta.url);

const BUILD_PACKAGES = [
  "@neuralayer/config",
  "@neuralayer/core",
  "@neuralayer/provider-adapters",
  "@neuralayer/db",
  "@neuralayer/admin",
];
const DEMO_ADMIN_WORKSPACE_ID = "ws_demo";

const logStep = createSmokeLogger("admin:smoke:projects");

function loadConfigModule() {
  return requireWorkspace("@neuralayer/config");
}

function loadDbModule() {
  return requireWorkspace("@neuralayer/db");
}

async function runProjectsSmoke(input) {
  const target = await openBrowserTarget(input.debugPort);
  const page = await createPageClient(target.webSocketDebuggerUrl);
  const passwordLiteral = JSON.stringify(input.password);
  const projectNameLiteral = JSON.stringify(input.projectName);
  const renamedProjectNameLiteral = JSON.stringify(input.renamedProjectName);
  const updatedProjectSlugLiteral = JSON.stringify(input.updatedProjectSlug);
  const projectApiKeyNameLiteral = JSON.stringify(input.projectApiKeyName);
  const finalProjectPath = `/projects/${input.updatedProjectSlug}`;
  const createSuccessNotice =
    "Project created. Finish the basics here and generate the first project key when you're ready.";
  const renameSuccessNotice = "Project name saved.";
  const slugSuccessNotice = "Project link saved.";
  const apiKeyRevokedNotice =
    "Project API key revoked. The raw value remains unavailable and the key can no longer authenticate requests.";
  const deactivateSuccessNotice =
    "Project deactivated. New project-scoped keys and request routing now stay paused.";
  const activateSuccessNotice =
    "Project activated and ready for routing again.";

  try {
    await page.enable();
    await page.navigate(`${input.baseUrl}/login`, "/login");

    const loginHeading = await page.evaluate(
      "document.querySelector('h1')?.textContent?.trim() ?? null",
    );

    if (!loginHeading?.includes("Temporary admin login")) {
      throw createSmokeError(
        "The login page heading did not match the admin gate.",
      );
    }

    await page.evaluate(`(() => {
      const input = document.querySelector('input[name="password"]');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error("password input missing");
      }

      input.focus();
      input.value = ${passwordLiteral};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const form = input.form;

      if (!form) {
        throw new Error("login form missing");
      }

      form.requestSubmit();
      return true;
    })()`);

    await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, href: location.href, ready: document.readyState })`,
        );

        return state.path === "/" && state.ready === "complete" ? state : null;
      },
      PAGE_NAVIGATION_TIMEOUT_MS,
      "post-login redirect",
    );

    await page.navigate(`${input.baseUrl}/projects`, "/projects");

    const initialText = await page.evaluate("document.body.innerText");

    if (!initialText.includes("Create project")) {
      throw createSmokeError("The Projects create panel did not render.");
    }

    if (!initialText.includes("Projects")) {
      throw createSmokeError("The Projects list panel did not render.");
    }

    await page.evaluate(`(() => {
      const input = document.querySelector('#project-name');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error("project name input missing");
      }

      input.focus();
      input.value = ${projectNameLiteral};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const form = input.form;

      if (!form) {
        throw new Error("project form missing");
      }

      form.requestSubmit();
      return true;
    })()`);

    const createdState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path.startsWith("/projects/") &&
          state.ready === "complete" &&
          state.text.includes(input.projectName) &&
          state.text.includes(createSuccessNotice)
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "created project detail",
    );

    await page.evaluate(`(() => {
      const input = document.querySelector('#project-detail-name');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error("project detail name input missing");
      }

      input.focus();
      input.value = ${renamedProjectNameLiteral};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const form = input.form;

      if (!form) {
        throw new Error("project detail name form missing");
      }

      form.requestSubmit();
      return true;
    })()`);

    const renamedState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path === createdState.path &&
          state.ready === "complete" &&
          state.text.includes(input.renamedProjectName) &&
          state.text.includes(renameSuccessNotice)
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "renamed project detail",
    );

    await page.evaluate(`(() => {
      const input = document.querySelector('#project-detail-slug');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error("project detail slug input missing");
      }

      input.focus();
      input.value = ${updatedProjectSlugLiteral};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const form = input.form;

      if (!form) {
        throw new Error("project detail slug form missing");
      }

      form.requestSubmit();
      return true;
    })()`);

    const slugState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path === finalProjectPath &&
          state.ready === "complete" &&
          state.text.includes(slugSuccessNotice)
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "slug-updated project detail",
    );

    await waitFor(
      async () => {
        const state = await page.evaluate(`(() => {
        const marker = document.querySelector('[data-project-api-key-create-ready]');

        return marker instanceof HTMLElement
          ? marker.getAttribute('data-project-api-key-create-ready')
          : null;
      })()`);

        return state === "true" ? state : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "project api key form hydration",
    );

    await page.evaluate(`(() => {
      const input = document.querySelector('#project-api-key-name');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error("project api key name input missing");
      }

      input.focus();
      input.value = ${projectApiKeyNameLiteral};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const button = Array.from(document.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === "Generate project key",
      );

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("generate project key button missing");
      }

      button.click();
      return true;
    })()`);

    let latestApiKeyPageState = null;
    let createdApiKeyState;

    try {
      createdApiKeyState = await waitFor(
        async () => {
          const state = await page.evaluate(
            `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
          );

          latestApiKeyPageState = state;

          const rawKeyMatch = Array.from(
            state.text.matchAll(/nl_[A-Za-z0-9_-]+/g),
          )
            .map((entry) => entry[0])
            .sort((left, right) => right.length - left.length)[0];
          const normalizedText = state.text.toLowerCase();

          if (
            state.path === finalProjectPath &&
            state.ready === "complete" &&
            normalizedText.includes("raw key shown once") &&
            state.text.includes(input.projectApiKeyName) &&
            rawKeyMatch
          ) {
            return {
              ...state,
              rawKey: rawKeyMatch,
            };
          }

          return null;
        },
        PAGE_ASSERTION_TIMEOUT_MS,
        "project api key generation",
      );
    } catch (error) {
      throw createSmokeError(
        `Project API key generation did not reach the expected raw-once state.\n\nLast observed page state:\n${JSON.stringify(
          latestApiKeyPageState,
          null,
          2,
        )}`,
        error,
      );
    }

    const createdKeyPrefix = createdApiKeyState.rawKey.slice(0, 12);

    await page.navigate(
      `${input.baseUrl}${finalProjectPath}`,
      finalProjectPath,
    );

    const reloadedApiKeyState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path === finalProjectPath &&
          state.ready === "complete" &&
          state.text.includes(input.projectApiKeyName) &&
          state.text.includes(createdKeyPrefix) &&
          state.text.includes("<paste-project-api-key>") &&
          !state.text.includes(createdApiKeyState.rawKey)
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "raw-once api key reload",
    );

    await page.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === "Revoke key",
      );

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("revoke key button missing");
      }

      const form = button.form;

      if (!form) {
        throw new Error("revoke key form missing");
      }

      form.requestSubmit(button);
      return true;
    })()`);

    const revokedApiKeyState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path === finalProjectPath &&
          state.ready === "complete" &&
          state.text.includes(apiKeyRevokedNotice) &&
          state.text.includes(input.projectApiKeyName) &&
          state.text.includes("revoked") &&
          !state.text.includes(createdApiKeyState.rawKey)
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "revoked project api key detail",
    );

    await page.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === "Deactivate project",
      );

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("deactivate project button missing");
      }

      const form = button.form;

      if (!form) {
        throw new Error("deactivate project form missing");
      }

      form.requestSubmit(button);
      return true;
    })()`);

    const deactivatedState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path === finalProjectPath &&
          state.ready === "complete" &&
          state.text.includes(deactivateSuccessNotice) &&
          state.text.includes("Activate project")
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "deactivated project detail",
    );

    await page.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === "Activate project",
      );

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("activate project button missing");
      }

      const form = button.form;

      if (!form) {
        throw new Error("activate project form missing");
      }

      form.requestSubmit(button);
      return true;
    })()`);

    const activatedState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
        );

        return state.path === finalProjectPath &&
          state.ready === "complete" &&
          state.text.includes(activateSuccessNotice) &&
          state.text.includes("Deactivate project")
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "reactivated project detail",
    );

    return {
      loginHeading,
      createDetailPath: createdState.path,
      renamedDetailPath: renamedState.path,
      finalDetailPath: activatedState.path,
      createPanelPresent: initialText.includes("Create project"),
      listPanelPresent: initialText.includes("Projects"),
      createdSuccessBannerPresent:
        createdState.text.includes(createSuccessNotice),
      renameSuccessBannerPresent:
        renamedState.text.includes(renameSuccessNotice),
      slugSuccessBannerPresent: slugState.text.includes(slugSuccessNotice),
      projectApiKeyCreated: createdApiKeyState.text
        .toLowerCase()
        .includes("raw key shown once"),
      projectApiKeyRawOnceClearedOnReload: reloadedApiKeyState.text.includes(
        "<paste-project-api-key>",
      ),
      projectApiKeyRevokedNoticePresent:
        revokedApiKeyState.text.includes(apiKeyRevokedNotice),
      projectApiKeyName: input.projectApiKeyName,
      projectApiKeyPrefix: createdKeyPrefix,
      deactivateSuccessBannerPresent: deactivatedState.text.includes(
        deactivateSuccessNotice,
      ),
      activateSuccessBannerPresent: activatedState.text.includes(
        activateSuccessNotice,
      ),
      createdProjectPresent: createdState.text.includes(input.projectName),
      renamedProjectPresent: activatedState.text.includes(
        input.renamedProjectName,
      ),
      createdProjectName: input.projectName,
      renamedProjectName: input.renamedProjectName,
      finalProjectSlug: input.updatedProjectSlug,
    };
  } finally {
    await page.close();
    await closeBrowserTarget(input.debugPort, target.id);
  }
}

async function cleanupCreatedProject(input) {
  const { loadDatabaseConfig } = loadConfigModule();
  const {
    listProjects,
    createDbConnection,
    auditEvents,
    gatewayApiKeys,
    projects,
    and,
    eq,
  } = loadDbModule();
  const workspaceProjects = await listProjects(input.workspaceId);
  const project =
    workspaceProjects.find((entry) => entry.slug === input.projectSlug) ??
    workspaceProjects.find((entry) => entry.name === input.projectName);

  if (!project) {
    return {
      cleaned: false,
      reason: "The smoke project was not found during cleanup.",
    };
  }

  const {
    database: { url },
  } = loadDatabaseConfig();
  const { db, queryClient } = createDbConnection(url);

  try {
    await db.delete(auditEvents).where(eq(auditEvents.projectId, project.id));
    await db
      .delete(gatewayApiKeys)
      .where(eq(gatewayApiKeys.projectId, project.id));
    await db
      .delete(projects)
      .where(
        and(
          eq(projects.id, project.id),
          eq(projects.workspaceId, project.workspaceId),
        ),
      );

    return {
      cleaned: true,
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
    };
  } finally {
    await queryClient.end({ timeout: 5 });
  }
}

async function main() {
  loadAdminBootstrapEnv({
    importMetaUrl: import.meta.url,
  });

  const { repoRootDir } = resolveAdminBootstrapPaths(import.meta.url);
  const corepackCommand = getCorepackCommand();
  const serverPort = await getFreePort();
  const debugPort = await getFreePort();
  const browserPath = resolveBrowserExecutablePath();
  const browserProfileDir = join(
    tmpdir(),
    `nl-admin-smoke-projects-${Date.now()}`,
  );
  const smokeTimestamp = Date.now();
  const projectName = `Smoke Project ${smokeTimestamp}`;
  const renamedProjectName = `Smoke Project Renamed ${smokeTimestamp}`;
  const updatedProjectSlug = `smoke-project-${smokeTimestamp}-detail`;
  const projectApiKeyName = `Smoke Project Key ${smokeTimestamp}`;
  const password = `smoke-${randomBytes(6).toString("hex")}`;
  const sessionSecret = randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  mkdirSync(browserProfileDir, { recursive: true });

  let adminServer = null;
  let browserProcess = null;
  let cleanupSummary = null;

  try {
    for (const packageName of BUILD_PACKAGES) {
      await runCheckedCommand(logStep, {
        label: `Building ${packageName}`,
        command: corepackCommand,
        args: ["pnpm", "--filter", packageName, "build"],
        cwd: repoRootDir,
        env: createSmokeCommandEnv(),
      });
    }

    adminServer = startManagedProcess({
      label: "Admin production server",
      command: corepackCommand,
      args: ["pnpm", "--filter", "@neuralayer/admin", "start"],
      cwd: repoRootDir,
      env: createSmokeCommandEnv({
        ADMIN_ACCESS_PASSWORD: password,
        ADMIN_SESSION_SECRET: sessionSecret,
        ADMIN_PORT: String(serverPort),
        ADMIN_WORKSPACE_ID: DEMO_ADMIN_WORKSPACE_ID,
      }),
    });

    logStep(`Starting admin server on ${baseUrl}`);
    await waitForServerReady({
      baseUrl,
      processInfo: adminServer,
    });

    browserProcess = startBrowserProcess({
      browserPath,
      browserProfileDir,
      debugPort,
    });

    logStep(
      `Starting headless browser ${browserPath} on DevTools port ${debugPort}`,
    );
    await waitForDevToolsReady(debugPort, browserProcess);

    logStep("Running browser-driven Projects smoke");
    const summary = await runProjectsSmoke({
      baseUrl,
      debugPort,
      password,
      projectName,
      renamedProjectName,
      updatedProjectSlug,
      projectApiKeyName,
    });

    cleanupSummary = await cleanupCreatedProject({
      workspaceId: DEMO_ADMIN_WORKSPACE_ID,
      projectName: renamedProjectName,
      projectSlug: updatedProjectSlug,
    });

    console.log(
      JSON.stringify(
        {
          ...summary,
          cleanup: cleanupSummary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown smoke failure.";

    console.error(`[admin:smoke:projects] ${errorMessage}`);

    if (adminServer) {
      const processLogs = formatManagedProcessLogs(adminServer);

      if (processLogs) {
        console.error(processLogs);
      }
    }

    if (!cleanupSummary) {
      try {
        cleanupSummary = await cleanupCreatedProject({
          workspaceId: DEMO_ADMIN_WORKSPACE_ID,
          projectName: renamedProjectName,
          projectSlug: updatedProjectSlug,
        });
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : "Unknown cleanup failure.";
        console.error(
          `[admin:smoke:projects] Cleanup warning: ${cleanupMessage}`,
        );
      }
    }

    process.exitCode = 1;
  } finally {
    await killProcessTree(browserProcess?.child);
    await killProcessTree(adminServer?.child);
    rmSync(browserProfileDir, {
      recursive: true,
      force: true,
    });
  }
}

main().catch((error) => {
  console.error(
    `[admin:smoke:projects] Fatal error: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exit(1);
});
