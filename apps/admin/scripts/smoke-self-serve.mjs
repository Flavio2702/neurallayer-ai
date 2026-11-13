#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  "@neuralayer/gateway",
  "@neuralayer/admin",
];

const SMOKE_PROVIDER = "openai";
const SMOKE_PROJECT_SLUG_PREFIX = "smoke-self-serve-";
const PROVIDER_AUDIT_EVENT_TYPES = [
  "provider_account.credentials_updated",
  "provider_account.connection_tested",
];

const logStep = createSmokeLogger("admin:smoke:self-serve");

function loadConfigModule() {
  return requireWorkspace("@neuralayer/config");
}

function loadDbModule() {
  return requireWorkspace("@neuralayer/db");
}

function loadDrizzleModule() {
  return createWorkspaceRequire(requireWorkspace.resolve("@neuralayer/db"))(
    "drizzle-orm",
  );
}

function loadProviderAdaptersModule() {
  return requireWorkspace("@neuralayer/provider-adapters");
}

function loadGatewayRuntimeModules(repoRootDir) {
  const gatewayDistDir = resolve(repoRootDir, "apps/gateway/dist");

  return {
    ...requireWorkspace(resolve(gatewayDistDir, "app.js")),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/auth/context.js")),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/chat/runtime.js")),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/chat/router.js")),
    ...requireWorkspace(
      resolve(gatewayDistDir, "modules/chat/provider-executor.js"),
    ),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/chat/persistence.js")),
  };
}

function createSmokeDatabaseConnection() {
  const { loadDatabaseConfig } = loadConfigModule();
  const { createDbConnection } = loadDbModule();
  const {
    database: { url },
  } = loadDatabaseConfig();

  return createDbConnection(url);
}

async function startFakeOpenAiProviderServer(input) {
  const requestLog = [];
  const server = createServer(async (request, response) => {
    if (
      request.method !== "POST" ||
      !request.url ||
      !request.url.startsWith("/v1/chat/completions")
    ) {
      response.writeHead(404, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const chunks = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body = {};

    try {
      body = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }

    const promptText = Array.isArray(body.messages)
      ? body.messages
          .map((message) =>
            typeof message?.content === "string" ? message.content : null,
          )
          .filter((message) => typeof message === "string")
          .join(" | ")
      : "";
    const promptPreview =
      promptText.length > 120 ? `${promptText.slice(0, 120)}...` : promptText;

    requestLog.push({
      path: request.url,
      model: typeof body.model === "string" ? body.model : null,
      promptPreview,
      requestId:
        typeof request.headers["x-client-request-id"] === "string"
          ? request.headers["x-client-request-id"]
          : null,
    });

    const assistantText = promptText.includes("Reply with the single word ok.")
      ? "ok"
      : `Self-serve smoke response for ${typeof body.model === "string" ? body.model : "unknown-model"}.`;

    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id":
        typeof request.headers["x-client-request-id"] === "string"
          ? request.headers["x-client-request-id"]
          : `openai_self_serve_${input.smokeId}`,
    });
    response.end(
      JSON.stringify({
        id: `chatcmpl_self_serve_${input.smokeId}_${requestLog.length}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: typeof body.model === "string" ? body.model : "gpt-5-mini",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: assistantText,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 24,
          completion_tokens: 10,
          total_tokens: 34,
        },
      }),
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", () => resolve());
  });

  return {
    server,
    requestLog,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function startLocalGatewayServer(input) {
  const dbModule = loadDbModule();
  const providerAdaptersModule = loadProviderAdaptersModule();
  const gatewayRuntimeModules = loadGatewayRuntimeModules(input.repoRootDir);
  const {
    createGatewayApp,
    createDatabaseGatewayAuthService,
    createChatCompletionsRuntime,
    createDatabaseChatRouter,
    createDatabaseChatProviderExecutor,
    createDatabaseChatPersistence,
  } = gatewayRuntimeModules;
  const {
    getWorkspaceRecordedCostForPeriod,
    listActiveChatModelCatalogWithLatestBenchmarks,
    listActiveScopedPolicyRules,
    listActiveWorkspaceProviderAccounts,
    resolveProviderAccountExecutionConfig,
    resolveRoutingProfileForProject,
    updateProviderAccountRuntimePosture,
  } = dbModule;
  const { createOpenAIAdapter } = providerAdaptersModule;
  const authService = createDatabaseGatewayAuthService();
  const runtime = createChatCompletionsRuntime({
    authService,
    router: createDatabaseChatRouter({
      loadProviderAccounts: listActiveWorkspaceProviderAccounts,
      loadPolicyRules: listActiveScopedPolicyRules,
      loadRoutingProfile: resolveRoutingProfileForProject,
      loadCatalogWithBenchmarks: listActiveChatModelCatalogWithLatestBenchmarks,
      loadRecordedCostForPeriod: getWorkspaceRecordedCostForPeriod,
    }),
    providerExecutor: createDatabaseChatProviderExecutor({
      getAdapter(provider) {
        if (provider !== "openai") {
          throw createSmokeError(
            `Unsupported provider ${provider} in self-serve smoke.`,
          );
        }

        return createOpenAIAdapter({
          baseUrl: input.providerBaseUrl,
        });
      },
      loadProviderConfig: resolveProviderAccountExecutionConfig,
      updateProviderPosture: updateProviderAccountRuntimePosture,
    }),
    persistence: createDatabaseChatPersistence(),
  });
  const app = createGatewayApp({
    authService,
    chatRuntime: runtime,
    logger: false,
  });

  await app.listen({
    host: "127.0.0.1",
    port: input.port,
  });
  await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${input.port}/health`);

      return response.ok ? response.status : null;
    },
    10_000,
    "local gateway readiness",
  );

  return {
    app,
    baseUrl: `http://127.0.0.1:${input.port}`,
    async close() {
      await app.close();
    },
  };
}

async function loginToAdmin(input) {
  await input.page.enable();
  await input.page.navigate(`${input.baseUrl}/login`, "/login");

  const loginHeading = await input.page.evaluate(
    "document.querySelector('h1')?.textContent?.trim() ?? null",
  );

  if (!loginHeading?.includes("Temporary admin login")) {
    throw createSmokeError(
      "The login page heading did not match the admin gate.",
    );
  }

  await input.page.evaluate(`(() => {
    const passwordInput = document.querySelector('input[name="password"]');

    if (!(passwordInput instanceof HTMLInputElement)) {
      throw new Error("password input missing");
    }

    passwordInput.focus();
    passwordInput.value = ${JSON.stringify(input.password)};
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));

    const form = passwordInput.form;

    if (!form) {
      throw new Error("login form missing");
    }

    form.requestSubmit();
    return true;
  })()`);

  await waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({ path: location.pathname, ready: document.readyState })`,
      );

      return state.path === "/" && state.ready === "complete" ? state : null;
    },
    PAGE_NAVIGATION_TIMEOUT_MS,
    "post-login redirect",
  );
}

async function waitForBodyText(input) {
  return waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({
        path: location.pathname,
        search: location.search,
        ready: document.readyState,
        text: document.body.innerText
      })`,
      );

      const pathMatches =
        !input.expectedPath || state.path === input.expectedPath;
      const hasAllText = input.includes.every((value) =>
        state.text.includes(value),
      );
      const hasNoExcludedText = (input.excludes ?? []).every(
        (value) => !state.text.includes(value),
      );

      return state.ready === "complete" &&
        pathMatches &&
        hasAllText &&
        hasNoExcludedText
        ? state
        : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    input.label,
  );
}

async function saveProviderCredentialViaUi(input) {
  await input.page.navigate(`${input.baseUrl}/providers`, "/providers");

  await input.page.evaluate(`(() => {
    const form = Array.from(document.querySelectorAll("form")).find((entry) => {
      const providerInput = entry.querySelector('input[name="provider"][value="${input.provider}"]');
      const apiKeyInput = entry.querySelector('#api-key-${input.provider}');

      return providerInput instanceof HTMLInputElement && apiKeyInput instanceof HTMLInputElement;
    });

    if (!(form instanceof HTMLFormElement)) {
      throw new Error("provider save form missing");
    }

    const apiKeyInput = form.querySelector('#api-key-${input.provider}');

    if (!(apiKeyInput instanceof HTMLInputElement)) {
      throw new Error("provider api key input missing");
    }

    apiKeyInput.focus();
    apiKeyInput.value = ${JSON.stringify(input.apiKey)};
    apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);

  return waitForBodyText({
    page: input.page,
    expectedPath: "/providers",
    includes: [
      "Saved the OpenAI credential. Run Test connection before routing real traffic.",
      "Saved key ****",
    ],
    label: "provider credential save notice",
  });
}

async function testProviderConnectionViaUi(input) {
  await input.page.evaluate(`(() => {
    const form = Array.from(document.querySelectorAll("form")).find((entry) => {
      const providerInput = entry.querySelector('input[name="provider"][value="${input.provider}"]');
      const button = Array.from(entry.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === "Test connection",
      );

      return providerInput instanceof HTMLInputElement && button instanceof HTMLButtonElement;
    });

    if (!(form instanceof HTMLFormElement)) {
      throw new Error("provider test form missing");
    }

    form.requestSubmit();
    return true;
  })()`);

  return waitForBodyText({
    page: input.page,
    expectedPath: "/providers",
    includes: [
      "Connection test passed for OpenAI. This provider is ready for routing.",
      "Latest explicit test used",
    ],
    label: "provider connection test success notice",
  });
}

async function assertOverviewProgress(input) {
  await input.page.navigate(`${input.baseUrl}/`, "/");

  return waitForBodyText({
    page: input.page,
    expectedPath: "/",
    includes: [
      "Setup progress",
      `${input.completedStepCount}/${input.totalStepCount}`,
      ...(input.includes ?? []),
    ],
    label: input.label,
  });
}

async function createProjectViaUi(input) {
  await input.page.navigate(`${input.baseUrl}/projects`, "/projects");

  await input.page.evaluate(`(() => {
    const projectNameInput = document.querySelector('#project-name');

    if (!(projectNameInput instanceof HTMLInputElement)) {
      throw new Error("project name input missing");
    }

    projectNameInput.focus();
    projectNameInput.value = ${JSON.stringify(input.projectName)};
    projectNameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const form = projectNameInput.form;

    if (!form) {
      throw new Error("project create form missing");
    }

    form.requestSubmit();
    return true;
  })()`);

  return waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
      );

      return state.path.startsWith("/projects/") &&
        state.ready === "complete" &&
        state.text.includes(input.projectName) &&
        state.text.includes(
          "Project created. Finish the basics here and generate the first project key when you're ready.",
        )
        ? state
        : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    "project creation",
  );
}

async function generateProjectKeyViaUi(input) {
  await waitFor(
    async () => {
      const readyState = await input.page.evaluate(`(() => {
      const marker = document.querySelector('[data-project-api-key-create-ready]');

      return marker instanceof HTMLElement
        ? marker.getAttribute('data-project-api-key-create-ready')
        : null;
    })()`);

      return readyState === "true" ? readyState : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    "project api key form hydration",
  );

  await input.page.evaluate(`(() => {
    const keyNameInput = document.querySelector('#project-api-key-name');

    if (!(keyNameInput instanceof HTMLInputElement)) {
      throw new Error("project api key name input missing");
    }

    keyNameInput.focus();
    keyNameInput.value = ${JSON.stringify(input.apiKeyName)};
    keyNameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const button = Array.from(document.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "Generate project key",
    );

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("generate project key button missing");
    }

    button.click();
    return true;
  })()`);

  return waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
      );
      const rawKeyMatch = Array.from(state.text.matchAll(/nl_[A-Za-z0-9_-]+/g))
        .map((entry) => entry[0])
        .sort((left, right) => right.length - left.length)[0];

      return state.ready === "complete" &&
        state.path === input.detailPath &&
        state.text.toLowerCase().includes("raw key shown once") &&
        state.text.includes(input.apiKeyName) &&
        rawKeyMatch
        ? {
            ...state,
            rawKey: rawKeyMatch,
          }
        : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    "project api key generation",
  );
}

async function assertRawOnceClearedOnReload(input) {
  await input.page.navigate(
    `${input.baseUrl}${input.detailPath}`,
    input.detailPath,
  );

  return waitForBodyText({
    page: input.page,
    expectedPath: input.detailPath,
    includes: [input.apiKeyName, input.keyPrefix, "<paste-project-api-key>"],
    excludes: [input.rawKey],
    label: "raw-once key cleared on detail reload",
  });
}

async function runPlaygroundRequestViaUi(input) {
  await input.page.navigate(`${input.baseUrl}/playground`, "/playground");

  await waitFor(
    async () => {
      const readyState = await input.page.evaluate(`(() => {
      const marker = document.querySelector('[data-playground-ready]');

      return marker instanceof HTMLElement
        ? marker.getAttribute('data-playground-ready')
        : null;
    })()`);

      return readyState === "true" ? readyState : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    "playground hydration",
  );

  await input.page.evaluate(`(() => {
    const setControlValue = (element, value) => {
      const prototype =
        element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : element instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : null;

      const valueDescriptor = prototype
        ? Object.getOwnPropertyDescriptor(prototype, "value")
        : null;

      if (!valueDescriptor?.set) {
        throw new Error("controlled input setter missing");
      }

      valueDescriptor.set.call(element, value);
    };

    const projectSelect = document.querySelector('#playground-project');
    const userPromptInput = document.querySelector('#playground-user-prompt');
    const rawKeyInput = document.querySelector('#playground-raw-project-api-key');

    if (!(projectSelect instanceof HTMLSelectElement)) {
      throw new Error("playground project select missing");
    }

    if (!(userPromptInput instanceof HTMLTextAreaElement)) {
      throw new Error("playground user prompt missing");
    }

    if (!(rawKeyInput instanceof HTMLInputElement)) {
      throw new Error("playground raw key input missing");
    }

    setControlValue(projectSelect, ${JSON.stringify(input.projectId)});
    projectSelect.dispatchEvent(new Event("change", { bubbles: true }));
    setControlValue(userPromptInput, ${JSON.stringify(input.userPrompt)});
    userPromptInput.dispatchEvent(new Event("input", { bubbles: true }));
    setControlValue(rawKeyInput, ${JSON.stringify(input.rawKey)});
    rawKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    rawKeyInput.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);

  await input.page.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );

  await input.page.evaluate(`(() => {
    const submitButton = Array.from(document.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "Send one-shot request",
    );

    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error("playground submit button missing");
    }

    submitButton.click();
    return true;
  })()`);

  return waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
      );
      const requestIdMatch = state.text.match(
        /Request id:\s*([A-Za-z0-9_-]{8,}|[0-9a-f-]{36})/,
      );
      const resultState = state.text.includes(
        "Gateway returned a one-shot response.",
      )
        ? "success"
        : state.text.includes("Structured gateway error")
          ? "gateway_error"
          : state.text.includes(
                "Playground could not complete the gateway round-trip",
              )
            ? "transport_error"
            : state.text.includes("Playground validation stopped this submit")
              ? "validation_error"
              : null;

      return state.path === "/playground" &&
        state.ready === "complete" &&
        state.text.includes("Latest one-shot attempt") &&
        resultState
        ? {
            ...state,
            resultState,
            requestId: requestIdMatch?.[1] ?? null,
          }
        : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    "playground one-shot success",
  );
}

async function assertRequestsPageForProject(input) {
  const requestsPath = `/requests?project=${encodeURIComponent(input.projectId)}`;

  await input.page.navigate(`${input.baseUrl}${requestsPath}`, "/requests");

  return waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({ path: location.pathname, ready: document.readyState, text: document.body.innerText })`,
      );

      if (
        state.path !== "/requests" ||
        state.ready !== "complete" ||
        !state.text.includes("Operational request feed")
      ) {
        return null;
      }

      const hasRequestId = state.text.includes(input.requestId);
      const hasProjectName = state.text.includes(input.projectName);
      const hasWhyThisHappened = state.text.includes("Why this happened");
      const resultState =
        hasRequestId && hasProjectName
          ? "success"
          : state.text.includes("No requests match the current filters")
            ? "empty"
            : "mismatch";

      return {
        ...state,
        hasProjectName,
        hasRequestId,
        hasWhyThisHappened,
        resultState,
      };
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    "requests page feed for smoke project",
  );
}

async function captureProviderAccountSnapshot(input) {
  return input.db.query.providerAccounts.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.workspaceId, input.workspaceId),
        eq(table.provider, input.provider),
      ),
    orderBy: (table, { asc }) => [asc(table.displayName), asc(table.id)],
  });
}

async function cleanupProjectArtifacts(input) {
  const requestRows = await input.db.query.requests.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.workspaceId, input.workspaceId),
        eq(table.projectId, input.projectId),
      ),
  });
  const requestIds = requestRows.map((row) => row.id);

  if (requestIds.length > 0) {
    await input.db
      .delete(input.tables.requestAttempts)
      .where(
        input.drizzle.inArray(
          input.tables.requestAttempts.requestId,
          requestIds,
        ),
      );
    await input.db
      .delete(input.tables.usageRecords)
      .where(
        input.drizzle.inArray(input.tables.usageRecords.requestId, requestIds),
      );
  }

  await input.db
    .delete(input.tables.auditEvents)
    .where(
      input.drizzle.and(
        input.drizzle.eq(
          input.tables.auditEvents.workspaceId,
          input.workspaceId,
        ),
        input.drizzle.eq(input.tables.auditEvents.projectId, input.projectId),
      ),
    );
  await input.db
    .delete(input.tables.requests)
    .where(
      input.drizzle.and(
        input.drizzle.eq(input.tables.requests.workspaceId, input.workspaceId),
        input.drizzle.eq(input.tables.requests.projectId, input.projectId),
      ),
    );
  await input.db
    .delete(input.tables.gatewayApiKeys)
    .where(
      input.drizzle.and(
        input.drizzle.eq(
          input.tables.gatewayApiKeys.workspaceId,
          input.workspaceId,
        ),
        input.drizzle.eq(
          input.tables.gatewayApiKeys.projectId,
          input.projectId,
        ),
      ),
    );
  await input.db
    .delete(input.tables.projects)
    .where(
      input.drizzle.and(
        input.drizzle.eq(input.tables.projects.workspaceId, input.workspaceId),
        input.drizzle.eq(input.tables.projects.id, input.projectId),
      ),
    );
}

async function createSmokeWorkspace(input) {
  const workspaceId = `ws_admin_smoke_self_serve_${input.smokeId}`;
  const workspaceSlug = `admin-smoke-self-serve-${input.smokeId}`;
  const workspaceName = `Admin Smoke Self Serve ${input.smokeId}`;

  await input.db.insert(input.tables.workspaces).values({
    id: workspaceId,
    name: workspaceName,
    slug: workspaceSlug,
    status: "active",
    defaultMode: "balanced",
  });

  return {
    id: workspaceId,
    slug: workspaceSlug,
    name: workspaceName,
  };
}

async function cleanupSmokeWorkspace(input) {
  await input.db
    .delete(input.tables.auditEvents)
    .where(
      input.drizzle.eq(input.tables.auditEvents.workspaceId, input.workspaceId),
    );
  await input.db
    .delete(input.tables.usageRecords)
    .where(
      input.drizzle.eq(
        input.tables.usageRecords.workspaceId,
        input.workspaceId,
      ),
    );
  await input.db
    .delete(input.tables.requestAttempts)
    .where(
      input.drizzle.eq(
        input.tables.requestAttempts.workspaceId,
        input.workspaceId,
      ),
    );
  await input.db
    .delete(input.tables.requests)
    .where(
      input.drizzle.eq(input.tables.requests.workspaceId, input.workspaceId),
    );
  await input.db
    .delete(input.tables.gatewayApiKeys)
    .where(
      input.drizzle.eq(
        input.tables.gatewayApiKeys.workspaceId,
        input.workspaceId,
      ),
    );
  await input.db
    .delete(input.tables.providerAccounts)
    .where(
      input.drizzle.eq(
        input.tables.providerAccounts.workspaceId,
        input.workspaceId,
      ),
    );
  await input.db
    .delete(input.tables.projects)
    .where(
      input.drizzle.eq(input.tables.projects.workspaceId, input.workspaceId),
    );
  await input.db
    .delete(input.tables.workspaces)
    .where(input.drizzle.eq(input.tables.workspaces.id, input.workspaceId));

  return {
    workspaceRemoved: true,
    workspaceId: input.workspaceId,
  };
}

async function cleanupSelfServeProjects(input) {
  const { listProjects } = loadDbModule();
  const workspaceProjects = await listProjects(input.workspaceId, input.db);
  const smokeProjects = workspaceProjects.filter((project) =>
    project.slug.startsWith(SMOKE_PROJECT_SLUG_PREFIX),
  );

  for (const project of smokeProjects) {
    await cleanupProjectArtifacts({
      ...input,
      projectId: project.id,
    });
  }

  return smokeProjects.length;
}

async function restoreProviderAccounts(input) {
  const currentRows = await captureProviderAccountSnapshot({
    db: input.db,
    workspaceId: input.workspaceId,
    provider: input.provider,
  });
  const currentIds = currentRows.map((row) => row.id);
  const snapshotIds = input.snapshot.map((row) => row.id);
  const extraIds = currentIds.filter((id) => !snapshotIds.includes(id));
  const providerAccountIdsForAuditCleanup = [
    ...new Set([...currentIds, ...snapshotIds]),
  ];

  for (const row of input.snapshot) {
    await input.db
      .update(input.tables.providerAccounts)
      .set({
        displayName: row.displayName,
        status: row.status,
        encryptedCredentials: row.encryptedCredentials,
        testStatus: row.testStatus,
        lastTestedAt: row.lastTestedAt,
        metadata: row.metadata,
        updatedAt: row.updatedAt,
      })
      .where(input.drizzle.eq(input.tables.providerAccounts.id, row.id));
  }

  if (extraIds.length > 0) {
    await input.db
      .delete(input.tables.providerAccounts)
      .where(input.drizzle.inArray(input.tables.providerAccounts.id, extraIds));
  }

  if (providerAccountIdsForAuditCleanup.length > 0) {
    await input.db
      .delete(input.tables.auditEvents)
      .where(
        input.drizzle.and(
          input.drizzle.eq(
            input.tables.auditEvents.workspaceId,
            input.workspaceId,
          ),
          input.drizzle.inArray(
            input.tables.auditEvents.eventType,
            PROVIDER_AUDIT_EVENT_TYPES,
          ),
          input.drizzle.inArray(
            input.tables.auditEvents.entityId,
            providerAccountIdsForAuditCleanup,
          ),
          input.drizzle.gte(
            input.tables.auditEvents.createdAt,
            input.startedAt,
          ),
        ),
      );
  }

  return {
    restoredRows: input.snapshot.length,
    removedExtraRows: extraIds.length,
  };
}

async function main() {
  loadAdminBootstrapEnv({
    importMetaUrl: import.meta.url,
  });

  const { repoRootDir } = resolveAdminBootstrapPaths(import.meta.url);
  const corepackCommand = getCorepackCommand();
  const adminPort = await getFreePort();
  const gatewayPort = await getFreePort();
  const providerPort = await getFreePort();
  const debugPort = await getFreePort();
  const browserPath = resolveBrowserExecutablePath();
  const browserProfileDir = join(
    tmpdir(),
    `nl-admin-smoke-self-serve-${Date.now()}`,
  );
  const smokeId = String(Date.now());
  const smokeStartedAt = new Date();
  const smokeWorkspaceId = `ws_admin_smoke_self_serve_${smokeId}`;
  const projectName = `Smoke Self Serve ${smokeId}`;
  const expectedProjectSlug = `${SMOKE_PROJECT_SLUG_PREFIX}${smokeId}`;
  const projectApiKeyName = `Smoke Self Serve Key ${smokeId}`;
  const providerApiKey = `test-provider-openai-self-serve-${smokeId}`;
  const playgroundUserPrompt = "Run the Sprint 2 self-serve smoke request.";
  const password = `smoke-${randomBytes(6).toString("hex")}`;
  const sessionSecret = randomBytes(24).toString("hex");
  const providerCredentialsSecret =
    typeof process.env.PROVIDER_CREDENTIALS_SECRET === "string" &&
    process.env.PROVIDER_CREDENTIALS_SECRET.trim().length >= 16
      ? process.env.PROVIDER_CREDENTIALS_SECRET.trim()
      : randomBytes(24).toString("hex");
  const adminBaseUrl = `http://127.0.0.1:${adminPort}`;
  const providerBaseUrl = `http://127.0.0.1:${providerPort}/v1`;

  process.env.PROVIDER_CREDENTIALS_SECRET = providerCredentialsSecret;
  mkdirSync(browserProfileDir, { recursive: true });

  let dbConnection = null;
  let fakeProviderServer = null;
  let localGatewayServer = null;
  let adminServer = null;
  let browserProcess = null;
  let cleanupSummary = null;
  let workspaceId = null;

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

    dbConnection = createSmokeDatabaseConnection();

    const dbModule = loadDbModule();
    const drizzle = loadDrizzleModule();
    const smokeWorkspace = await createSmokeWorkspace({
      db: dbConnection.db,
      tables: dbModule,
      smokeId,
    });
    workspaceId = smokeWorkspace.id;

    const initialProgress = await dbModule.getWorkspaceSetupProgress(
      workspaceId,
      dbConnection.db,
    );

    if (initialProgress.completedStepCount !== 0) {
      throw createSmokeError(
        `Expected the smoke workspace to start at 0/5 setup progress, received ${initialProgress.completedStepCount}/5.`,
      );
    }

    fakeProviderServer = await startFakeOpenAiProviderServer({
      port: providerPort,
      smokeId,
    });
    logStep(`Started fake OpenAI provider on ${providerBaseUrl}`);

    localGatewayServer = await startLocalGatewayServer({
      repoRootDir,
      port: gatewayPort,
      providerBaseUrl,
    });
    logStep(`Started local gateway on ${localGatewayServer.baseUrl}`);

    adminServer = startManagedProcess({
      label: "Admin production server",
      command: corepackCommand,
      args: ["pnpm", "--filter", "@neuralayer/admin", "start"],
      cwd: repoRootDir,
      env: createSmokeCommandEnv({
        ADMIN_ACCESS_PASSWORD: password,
        ADMIN_SESSION_SECRET: sessionSecret,
        ADMIN_PORT: String(adminPort),
        NEXT_PUBLIC_GATEWAY_URL: localGatewayServer.baseUrl,
        PROVIDER_CREDENTIALS_SECRET: providerCredentialsSecret,
        ADMIN_SMOKE_PROVIDER_TEST_OPENAI_BASE_URL: providerBaseUrl,
        ADMIN_SMOKE_WORKSPACE_ID: smokeWorkspaceId,
      }),
    });

    logStep(`Starting admin server on ${adminBaseUrl}`);
    await waitForServerReady({
      baseUrl: adminBaseUrl,
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

    const target = await openBrowserTarget(debugPort);
    const page = await createPageClient(target.webSocketDebuggerUrl);

    try {
      await loginToAdmin({
        page,
        baseUrl: adminBaseUrl,
        password,
      });

      await assertOverviewProgress({
        page,
        baseUrl: adminBaseUrl,
        completedStepCount: 0,
        totalStepCount: 5,
        includes: ["Provider configured"],
        label: "overview initial setup progress",
      });

      const providerSaveState = await saveProviderCredentialViaUi({
        page,
        baseUrl: adminBaseUrl,
        provider: SMOKE_PROVIDER,
        apiKey: providerApiKey,
      });
      const providerTestState = await testProviderConnectionViaUi({
        page,
        provider: SMOKE_PROVIDER,
      });

      const progressAfterProvider = await dbModule.getWorkspaceSetupProgress(
        workspaceId,
        dbConnection.db,
      );

      if (progressAfterProvider.completedStepCount !== 2) {
        throw createSmokeError(
          `Expected setup progress to reach 2/5 after provider setup, received ${progressAfterProvider.completedStepCount}/5.`,
        );
      }

      await assertOverviewProgress({
        page,
        baseUrl: adminBaseUrl,
        completedStepCount: 2,
        totalStepCount: 5,
        includes: ["Project created"],
        label: "overview setup progress after provider setup",
      });

      const createdProjectState = await createProjectViaUi({
        page,
        baseUrl: adminBaseUrl,
        projectName,
      });
      const projectSlug = decodeURIComponent(
        createdProjectState.path.replace(/^\/projects\//, ""),
      );

      if (projectSlug !== expectedProjectSlug) {
        throw createSmokeError(
          `Expected project slug ${expectedProjectSlug}, received ${projectSlug}.`,
        );
      }

      const project = await dbModule.getProjectBySlug(
        {
          workspaceId,
          slug: projectSlug,
        },
        dbConnection.db,
      );
      const generatedApiKeyState = await generateProjectKeyViaUi({
        page,
        detailPath: createdProjectState.path,
        apiKeyName: projectApiKeyName,
      });
      const rawProjectApiKey = generatedApiKeyState.rawKey;
      const keyPrefix = rawProjectApiKey.slice(0, 12);

      await assertRawOnceClearedOnReload({
        page,
        baseUrl: adminBaseUrl,
        detailPath: createdProjectState.path,
        apiKeyName: projectApiKeyName,
        rawKey: rawProjectApiKey,
        keyPrefix,
      });

      const playgroundState = await runPlaygroundRequestViaUi({
        page,
        baseUrl: adminBaseUrl,
        projectId: project.id,
        rawKey: rawProjectApiKey,
        userPrompt: playgroundUserPrompt,
      });

      if (playgroundState.resultState !== "success") {
        throw createSmokeError(
          `Playground ended in ${playgroundState.resultState}: ${playgroundState.text.slice(0, 1200)}`,
        );
      }

      const requestsPageData = await dbModule.getRequestsPageData(
        {
          workspaceId,
          projectId: project.id,
          limit: 5,
          blockedLimit: 2,
          auditLimit: 5,
        },
        dbConnection.db,
      );
      const latestRequest = requestsPageData.feed[0];

      if (!latestRequest || latestRequest.status !== "succeeded") {
        throw createSmokeError(
          `Expected one succeeded request for ${project.name}, received ${JSON.stringify(
            requestsPageData.feed.map((item) => ({
              requestId: item.requestId,
              status: item.status,
            })),
          )}`,
        );
      }

      const requestsPageState = await assertRequestsPageForProject({
        page,
        baseUrl: adminBaseUrl,
        projectId: project.id,
        projectName: project.name,
        requestId: latestRequest.requestId,
      });

      if (requestsPageState.resultState !== "success") {
        throw createSmokeError(
          `Requests page ended in ${requestsPageState.resultState} (search=${requestsPageState.search}, hasProjectName=${requestsPageState.hasProjectName}, hasRequestId=${requestsPageState.hasRequestId}, hasWhyThisHappened=${requestsPageState.hasWhyThisHappened}): ${requestsPageState.text.slice(0, 1400)}`,
        );
      }

      const progressAfterFirstRequest =
        await dbModule.getWorkspaceSetupProgress(workspaceId, dbConnection.db);

      if (progressAfterFirstRequest.completedStepCount !== 5) {
        throw createSmokeError(
          `Expected setup progress to close at 5/5 after the first request, received ${progressAfterFirstRequest.completedStepCount}/5.`,
        );
      }

      await assertOverviewProgress({
        page,
        baseUrl: adminBaseUrl,
        completedStepCount: 5,
        totalStepCount: 5,
        includes: ["First-run closed"],
        label: "overview setup progress after first request",
      });

      const fakeProviderPrompts = fakeProviderServer.requestLog.map(
        (entry) => entry.promptPreview,
      );

      if (
        !fakeProviderPrompts.some((value) =>
          value.includes("Reply with the single word ok."),
        )
      ) {
        throw createSmokeError(
          "The fake provider did not observe the admin connection test request.",
        );
      }

      if (
        !fakeProviderPrompts.some((value) =>
          value.includes(playgroundUserPrompt),
        )
      ) {
        throw createSmokeError(
          "The fake provider did not observe the playground runtime request.",
        );
      }

      cleanupSummary = await cleanupSmokeWorkspace({
        db: dbConnection.db,
        drizzle,
        tables: dbModule,
        workspaceId,
      });

      console.log(
        JSON.stringify(
          {
            provider: {
              provider: SMOKE_PROVIDER,
              savedNoticeVisible: providerSaveState.text.includes(
                "Saved the OpenAI credential. Run Test connection before routing real traffic.",
              ),
              connectionTestVisible: providerTestState.text.includes(
                "Connection test passed for OpenAI. This provider is ready for routing.",
              ),
            },
            setupProgress: {
              initial: initialProgress.completedStepCount,
              afterProvider: progressAfterProvider.completedStepCount,
              afterFirstRequest: progressAfterFirstRequest.completedStepCount,
            },
            project: {
              id: project.id,
              name: project.name,
              slug: project.slug,
              detailPath: createdProjectState.path,
            },
            apiKey: {
              name: projectApiKeyName,
              keyPrefix,
              rawOnceClearedOnReload: true,
            },
            playground: {
              requestId: playgroundState.requestId,
              latestRequestId: latestRequest.requestId,
              providerVisible: playgroundState.text.includes("OpenAI"),
            },
            requests: {
              requestId: latestRequest.requestId,
              status: latestRequest.status,
              projectVisible: true,
            },
            fakeProvider: {
              observedRequestCount: fakeProviderServer.requestLog.length,
              prompts: fakeProviderPrompts,
            },
            cleanup: cleanupSummary,
          },
          null,
          2,
        ),
      );
    } finally {
      await page.close();
      await closeBrowserTarget(debugPort, target.id);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown self-serve smoke failure.";

    console.error(`[admin:smoke:self-serve] ${errorMessage}`);

    if (adminServer) {
      const processLogs = formatManagedProcessLogs(adminServer);

      if (processLogs) {
        console.error(processLogs);
      }
    }

    if (dbConnection && !cleanupSummary) {
      try {
        const dbModule = loadDbModule();
        const drizzle = loadDrizzleModule();
        if (workspaceId) {
          await cleanupSmokeWorkspace({
            db: dbConnection.db,
            drizzle,
            tables: dbModule,
            workspaceId,
          });
        }
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : "Unknown cleanup failure.";
        console.error(
          `[admin:smoke:self-serve] Cleanup warning: ${cleanupMessage}`,
        );
      }
    }

    process.exitCode = 1;
  } finally {
    await killProcessTree(browserProcess?.child);

    if (adminServer) {
      await killProcessTree(adminServer.child);
    }

    if (localGatewayServer) {
      await localGatewayServer.close().catch(() => undefined);
    }

    if (fakeProviderServer) {
      await fakeProviderServer.close().catch(() => undefined);
    }

    if (dbConnection) {
      await dbConnection.queryClient.end({ timeout: 5 }).catch(() => undefined);
    }

    rmSync(browserProfileDir, {
      recursive: true,
      force: true,
    });
  }
}

main().catch((error) => {
  console.error(
    `[admin:smoke:self-serve] Fatal error: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exit(1);
});
