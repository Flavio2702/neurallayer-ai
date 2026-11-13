import { loadDatabaseConfig } from "@neuralayer/config";
import { and, eq } from "drizzle-orm";

import {
  getInitialModelCatalogEntriesForMode,
  listInitialModelCatalogEntries,
  listSupersededInitialModelCatalogEntries,
} from "./catalog";
import { createConfiguredDbConnection } from "./client";
import {
  DEMO_API_KEY_ID,
  DEMO_API_KEY_RAW,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_NAME,
  DEMO_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
} from "./demo";
import {
  getGatewayApiKeyPrefix,
  hashGatewayApiKey,
} from "./gateway-api-key-service";
import { waitForConfiguredDatabaseReady } from "./readiness";
import {
  gatewayApiKeys,
  memberships,
  modelCatalog,
  policyRules,
  projects,
  providerAccounts,
  routingProfiles,
  users,
  workspaces,
} from "./schema";

export interface SeedRunResult {
  seeded: boolean;
  databaseUrl: string;
  readinessAttempts: number;
  summary: {
    workspaceId: string;
    workspaceSlug: string;
    projectId: string;
    projectSlug: string;
    ownerUserId: string;
    ownerEmail: string;
    routingProfileId: string;
    demoApiKeyId: string;
    demoApiKey: string;
  };
}

const DEMO_WORKSPACE_SLUG = "demo-workspace";
const DEMO_OWNER_USER_ID = "usr_demo_owner";
const DEMO_OWNER_EMAIL = "owner@demo.neuralayer.local";
const DEMO_ROUTING_PROFILE_ID = "rprof_demo_base";
const DEMO_ROUTING_PROFILE_SLUG = "base-demo";
const DEMO_PROJECT_SLUG = "demo-project";
const DEMO_MEMBERSHIP_ID = "mbr_demo_owner";
const DEMO_OPENAI_ACCOUNT_ID = "provacc_demo_openai";
const DEMO_ANTHROPIC_ACCOUNT_ID = "provacc_demo_anthropic";
const DEMO_POLICY_DENY_ID = "pol_demo_budget_deny_premium_openai";
const DEMO_POLICY_PREFERRED_ID = "pol_demo_balanced_prefer_anthropic";
const LEGACY_DEMO_MODEL_IDS = [
  "mdl_demo_openai_gpt5",
  "mdl_demo_anthropic_claude_sonnet_45",
];
const LEGACY_DEMO_POLICY_IDS = ["pol_demo_budget_deny_gpt51"];

const DEMO_API_KEY_PREFIX = getGatewayApiKeyPrefix(DEMO_API_KEY_RAW);
const DEMO_API_KEY_HASH = hashGatewayApiKey(DEMO_API_KEY_RAW);

function buildRoutingCandidatesForMode(
  mode: "max_quality" | "balanced" | "budget",
) {
  return getInitialModelCatalogEntriesForMode(mode).map((entry) => ({
    provider: entry.provider,
    modelId: entry.modelId,
  }));
}

function buildDemoWorkspaceValues() {
  return {
    id: DEMO_WORKSPACE_ID,
    name: DEMO_WORKSPACE_NAME,
    slug: DEMO_WORKSPACE_SLUG,
    status: "active" as const,
    defaultMode: "balanced" as const,
    metadata: {
      isDemo: true,
      seededBy: "runDbSeed",
      version: 1,
    },
  };
}

function buildDemoOwnerUserValues() {
  return {
    id: DEMO_OWNER_USER_ID,
    email: DEMO_OWNER_EMAIL,
    fullName: "Demo Owner",
    status: "active" as const,
  };
}

function buildDemoMembershipValues(workspaceId: string, userId: string) {
  return {
    id: DEMO_MEMBERSHIP_ID,
    workspaceId,
    userId,
    role: "owner" as const,
  };
}

function buildDemoRoutingProfileValues(workspaceId: string) {
  return {
    id: DEMO_ROUTING_PROFILE_ID,
    workspaceId,
    name: "Base Demo Routing Profile",
    slug: DEMO_ROUTING_PROFILE_SLUG,
    description: "Default routing order for the local demo workspace.",
    status: "active" as const,
    rulesJson: {
      version: 1,
      candidatesByMode: {
        max_quality: buildRoutingCandidatesForMode("max_quality"),
        balanced: buildRoutingCandidatesForMode("balanced"),
        budget: buildRoutingCandidatesForMode("budget"),
      },
    },
  };
}

function buildDemoProjectValues(workspaceId: string, routingProfileId: string) {
  return {
    id: DEMO_PROJECT_ID,
    workspaceId,
    name: DEMO_PROJECT_NAME,
    slug: DEMO_PROJECT_SLUG,
    description: "Minimal demo project for local NeuralLayer development.",
    status: "active" as const,
    defaultMode: "balanced" as const,
    routingProfileId,
    metadata: {
      isDemo: true,
      seededBy: "runDbSeed",
    },
  };
}

function buildDemoProviderAccountValues(workspaceId: string) {
  return [
    {
      id: DEMO_OPENAI_ACCOUNT_ID,
      workspaceId,
      provider: "openai" as const,
      displayName: "OpenAI Demo Account",
      status: "active" as const,
      encryptedCredentials: "demo-placeholder-openai-no-real-credentials",
      testStatus: "demo-placeholder",
      metadata: {
        isDemo: true,
        providerKeyLabel: "OPENAI_API_KEY",
      },
    },
    {
      id: DEMO_ANTHROPIC_ACCOUNT_ID,
      workspaceId,
      provider: "anthropic" as const,
      displayName: "Anthropic Demo Account",
      status: "active" as const,
      encryptedCredentials: "demo-placeholder-anthropic-no-real-credentials",
      testStatus: "demo-placeholder",
      metadata: {
        isDemo: true,
        providerKeyLabel: "ANTHROPIC_API_KEY",
      },
    },
  ] as const;
}

function buildDemoApiKeyValues(
  workspaceId: string,
  projectId: string,
  createdByUserId: string,
) {
  return {
    id: DEMO_API_KEY_ID,
    workspaceId,
    projectId,
    name: "Local Demo API Key",
    keyPrefix: DEMO_API_KEY_PREFIX,
    keyHash: DEMO_API_KEY_HASH,
    status: "active" as const,
    createdByUserId,
  };
}

function buildDemoPolicyRuleValues(workspaceId: string, projectId: string) {
  const [premiumOpenAIDefault] =
    getInitialModelCatalogEntriesForMode("max_quality");

  if (!premiumOpenAIDefault) {
    throw new Error("Initial max_quality model catalog pool is empty.");
  }

  return [
    {
      id: DEMO_POLICY_DENY_ID,
      workspaceId,
      projectId,
      name: "Budget mode blocks the premium OpenAI default",
      ruleType: "deny_model" as const,
      status: "active" as const,
      enforcementMode: "hard_block" as const,
      conditionsJson: {
        version: 1,
        when: {
          modes: ["budget"],
        },
        models: [premiumOpenAIDefault.modelId],
        reason:
          "Budget mode demo policy keeps the low-cost path deterministic by excluding the premium OpenAI default.",
      },
    },
    {
      id: DEMO_POLICY_PREFERRED_ID,
      workspaceId,
      projectId,
      name: "Balanced mode prefers Anthropic",
      ruleType: "preferred_provider" as const,
      status: "active" as const,
      enforcementMode: "soft_warn" as const,
      conditionsJson: {
        version: 1,
        when: {
          modes: ["balanced"],
        },
        provider: "anthropic",
        reason:
          "Balanced mode demo policy prefers Anthropic as the first candidate.",
      },
    },
  ] as const;
}

function buildDemoModelCatalogValues() {
  return listInitialModelCatalogEntries().map((entry) => ({
    ...entry,
    metadata: {
      ...(entry.metadata ?? {}),
      isDemo: true,
      seededBy: "runDbSeed",
    },
  }));
}

export async function runDbSeed(): Promise<SeedRunResult> {
  const {
    database: { url },
  } = loadDatabaseConfig();
  const readiness = await waitForConfiguredDatabaseReady();
  const { db, queryClient } = createConfiguredDbConnection();

  try {
    const summary = await db.transaction(async (tx) => {
      const workspaceValues = buildDemoWorkspaceValues();
      const workspace = await tx
        .insert(workspaces)
        .values(workspaceValues)
        .onConflictDoUpdate({
          target: workspaces.id,
          set: {
            name: workspaceValues.name,
            slug: workspaceValues.slug,
            status: workspaceValues.status,
            defaultMode: workspaceValues.defaultMode,
            metadata: workspaceValues.metadata,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: workspaces.id,
          slug: workspaces.slug,
        });

      const workspaceRow = workspace[0];

      if (!workspaceRow) {
        throw new Error("Workspace seed failed.");
      }

      const ownerUserValues = buildDemoOwnerUserValues();
      const ownerUser = await tx
        .insert(users)
        .values(ownerUserValues)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: ownerUserValues.email,
            fullName: ownerUserValues.fullName,
            status: ownerUserValues.status,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: users.id,
          email: users.email,
        });

      const ownerUserRow = ownerUser[0];

      if (!ownerUserRow) {
        throw new Error("Owner user seed failed.");
      }

      const membershipValues = buildDemoMembershipValues(
        workspaceRow.id,
        ownerUserRow.id,
      );
      await tx
        .insert(memberships)
        .values(membershipValues)
        .onConflictDoUpdate({
          target: memberships.id,
          set: {
            workspaceId: membershipValues.workspaceId,
            userId: membershipValues.userId,
            role: membershipValues.role,
            updatedAt: new Date(),
          },
        });

      const routingProfileValues = buildDemoRoutingProfileValues(
        workspaceRow.id,
      );
      const routingProfile = await tx
        .insert(routingProfiles)
        .values(routingProfileValues)
        .onConflictDoUpdate({
          target: routingProfiles.id,
          set: {
            workspaceId: routingProfileValues.workspaceId,
            name: routingProfileValues.name,
            slug: routingProfileValues.slug,
            description: routingProfileValues.description,
            status: routingProfileValues.status,
            rulesJson: routingProfileValues.rulesJson,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: routingProfiles.id,
        });

      const routingProfileRow = routingProfile[0];

      if (!routingProfileRow) {
        throw new Error("Routing profile seed failed.");
      }

      const projectValues = buildDemoProjectValues(
        workspaceRow.id,
        routingProfileRow.id,
      );
      const project = await tx
        .insert(projects)
        .values(projectValues)
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            workspaceId: projectValues.workspaceId,
            name: projectValues.name,
            slug: projectValues.slug,
            description: projectValues.description,
            status: projectValues.status,
            defaultMode: projectValues.defaultMode,
            routingProfileId: projectValues.routingProfileId,
            metadata: projectValues.metadata,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: projects.id,
          slug: projects.slug,
        });

      const projectRow = project[0];

      if (!projectRow) {
        throw new Error("Project seed failed.");
      }

      for (const providerAccountValues of buildDemoProviderAccountValues(
        workspaceRow.id,
      )) {
        await tx
          .insert(providerAccounts)
          .values(providerAccountValues)
          .onConflictDoUpdate({
            target: providerAccounts.id,
            set: {
              workspaceId: providerAccountValues.workspaceId,
              provider: providerAccountValues.provider,
              displayName: providerAccountValues.displayName,
              status: providerAccountValues.status,
              encryptedCredentials: providerAccountValues.encryptedCredentials,
              testStatus: providerAccountValues.testStatus,
              metadata: providerAccountValues.metadata,
              updatedAt: new Date(),
            },
          });
      }

      for (const legacyModelId of LEGACY_DEMO_MODEL_IDS) {
        await tx.delete(modelCatalog).where(eq(modelCatalog.id, legacyModelId));
      }

      for (const legacyPolicyId of LEGACY_DEMO_POLICY_IDS) {
        await tx.delete(policyRules).where(eq(policyRules.id, legacyPolicyId));
      }

      for (const supersededCatalogEntry of listSupersededInitialModelCatalogEntries()) {
        await tx
          .update(modelCatalog)
          .set({
            label: supersededCatalogEntry.label,
            status: "deprecated",
            isActive: false,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(modelCatalog.provider, supersededCatalogEntry.provider),
              eq(modelCatalog.modelId, supersededCatalogEntry.modelId),
            ),
          );
      }

      for (const catalogEntry of buildDemoModelCatalogValues()) {
        await tx
          .insert(modelCatalog)
          .values(catalogEntry)
          .onConflictDoUpdate({
            target: [modelCatalog.provider, modelCatalog.modelId],
            set: {
              provider: catalogEntry.provider,
              modelId: catalogEntry.modelId,
              label: catalogEntry.label,
              status: catalogEntry.status,
              isActive: catalogEntry.isActive,
              supportsChat: catalogEntry.supportsChat,
              supportsStreaming: catalogEntry.supportsStreaming,
              capabilityClasses: catalogEntry.capabilityClasses,
              costTier: catalogEntry.costTier,
              latencyTier: catalogEntry.latencyTier,
              metadata: catalogEntry.metadata ?? null,
              updatedAt: new Date(),
            },
          });
      }

      const apiKeyValues = buildDemoApiKeyValues(
        workspaceRow.id,
        projectRow.id,
        ownerUserRow.id,
      );
      await tx
        .insert(gatewayApiKeys)
        .values(apiKeyValues)
        .onConflictDoUpdate({
          target: gatewayApiKeys.id,
          set: {
            workspaceId: apiKeyValues.workspaceId,
            projectId: apiKeyValues.projectId,
            name: apiKeyValues.name,
            keyPrefix: apiKeyValues.keyPrefix,
            keyHash: apiKeyValues.keyHash,
            status: apiKeyValues.status,
            createdByUserId: apiKeyValues.createdByUserId,
            updatedAt: new Date(),
          },
        });

      for (const policyRuleValues of buildDemoPolicyRuleValues(
        workspaceRow.id,
        projectRow.id,
      )) {
        await tx
          .insert(policyRules)
          .values(policyRuleValues)
          .onConflictDoUpdate({
            target: policyRules.id,
            set: {
              workspaceId: policyRuleValues.workspaceId,
              projectId: policyRuleValues.projectId,
              name: policyRuleValues.name,
              ruleType: policyRuleValues.ruleType,
              status: policyRuleValues.status,
              enforcementMode: policyRuleValues.enforcementMode,
              conditionsJson: policyRuleValues.conditionsJson,
              updatedAt: new Date(),
            },
          });
      }

      await tx
        .update(workspaces)
        .set({
          defaultRoutingProfileId: routingProfileRow.id,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspaceRow.id));

      await tx
        .update(projects)
        .set({
          routingProfileId: routingProfileRow.id,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectRow.id));

      return {
        workspaceId: workspaceRow.id,
        workspaceSlug: workspaceRow.slug,
        projectId: projectRow.id,
        projectSlug: projectRow.slug,
        ownerUserId: ownerUserRow.id,
        ownerEmail: ownerUserRow.email,
        routingProfileId: routingProfileRow.id,
        demoApiKeyId: DEMO_API_KEY_ID,
        demoApiKey: DEMO_API_KEY_RAW,
      };
    });

    return {
      seeded: true,
      databaseUrl: url,
      readinessAttempts: readiness.attempts,
      summary,
    };
  } finally {
    await queryClient.end({ timeout: 5 });
  }
}

if (require.main === module) {
  runDbSeed()
    .then((result) => {
      console.log(
        `Seed completed after ${result.readinessAttempts} readiness check(s).`,
      );
      console.log("Target database: configured DATABASE_URL (redacted).");
      console.log(`Workspace: ${result.summary.workspaceSlug}`);
      console.log(`Project: ${result.summary.projectSlug}`);
      console.log(`Owner: ${result.summary.ownerEmail}`);
      console.log(`Demo API key: ${result.summary.demoApiKey}`);
    })
    .catch((error: unknown) => {
      console.error("Seed run failed.", error);
      process.exitCode = 1;
    });
}
