import { relations } from "drizzle-orm";

import { auditEvents } from "./audit-events";
import { externalModelBenchmarks } from "./external-model-benchmarks";
import { gatewayApiKeys } from "./gateway-api-keys";
import { memberships } from "./memberships";
import { modelCatalog } from "./model-catalog";
import { policyRules } from "./policy-rules";
import { projects } from "./projects";
import { providerAccounts } from "./provider-accounts";
import { requestAttempts } from "./request-attempts";
import { requests } from "./requests";
import { routingProfiles } from "./routing-profiles";
import { usageRecords } from "./usage-records";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  memberships: many(memberships),
  projects: many(projects),
  gatewayApiKeys: many(gatewayApiKeys),
  providerAccounts: many(providerAccounts),
  routingProfiles: many(routingProfiles, {
    relationName: "workspaceRoutingProfiles",
  }),
  defaultRoutingProfile: one(routingProfiles, {
    fields: [workspaces.defaultRoutingProfileId],
    references: [routingProfiles.id],
    relationName: "workspaceDefaultRoutingProfile",
  }),
  policyRules: many(policyRules),
  requests: many(requests),
  requestAttempts: many(requestAttempts),
  usageRecords: many(usageRecords),
  auditEvents: many(auditEvents),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  createdGatewayApiKeys: many(gatewayApiKeys),
  auditEvents: many(auditEvents),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [memberships.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  routingProfile: one(routingProfiles, {
    fields: [projects.routingProfileId],
    references: [routingProfiles.id],
  }),
  gatewayApiKeys: many(gatewayApiKeys),
  policyRules: many(policyRules),
  requests: many(requests),
  requestAttempts: many(requestAttempts),
  usageRecords: many(usageRecords),
  auditEvents: many(auditEvents),
}));

export const gatewayApiKeysRelations = relations(
  gatewayApiKeys,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [gatewayApiKeys.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [gatewayApiKeys.projectId],
      references: [projects.id],
    }),
    createdByUser: one(users, {
      fields: [gatewayApiKeys.createdByUserId],
      references: [users.id],
    }),
    requests: many(requests),
    auditEvents: many(auditEvents),
  }),
);

export const providerAccountsRelations = relations(
  providerAccounts,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [providerAccounts.workspaceId],
      references: [workspaces.id],
    }),
    requestAttempts: many(requestAttempts),
  }),
);

export const modelCatalogRelations = relations(modelCatalog, ({ many }) => ({
  externalModelBenchmarks: many(externalModelBenchmarks),
  requestAttempts: many(requestAttempts),
}));

export const externalModelBenchmarksRelations = relations(
  externalModelBenchmarks,
  ({ one }) => ({
    modelCatalogEntry: one(modelCatalog, {
      fields: [externalModelBenchmarks.modelCatalogId],
      references: [modelCatalog.id],
    }),
  }),
);

export const routingProfilesRelations = relations(
  routingProfiles,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [routingProfiles.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceRoutingProfiles",
    }),
    projects: many(projects),
    defaultForWorkspaces: many(workspaces, {
      relationName: "workspaceDefaultRoutingProfile",
    }),
  }),
);

export const policyRulesRelations = relations(policyRules, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [policyRules.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [policyRules.projectId],
    references: [projects.id],
  }),
}));

export const requestsRelations = relations(requests, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [requests.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [requests.projectId],
    references: [projects.id],
  }),
  apiKey: one(gatewayApiKeys, {
    fields: [requests.apiKeyId],
    references: [gatewayApiKeys.id],
  }),
  attempts: many(requestAttempts),
  usageRecords: many(usageRecords),
}));

export const requestAttemptsRelations = relations(
  requestAttempts,
  ({ many, one }) => ({
    request: one(requests, {
      fields: [requestAttempts.requestId],
      references: [requests.id],
    }),
    workspace: one(workspaces, {
      fields: [requestAttempts.workspaceId],
      references: [workspaces.id],
    }),
    project: one(projects, {
      fields: [requestAttempts.projectId],
      references: [projects.id],
    }),
    providerAccount: one(providerAccounts, {
      fields: [requestAttempts.providerAccountId],
      references: [providerAccounts.id],
    }),
    modelCatalogEntry: one(modelCatalog, {
      fields: [requestAttempts.modelCatalogId],
      references: [modelCatalog.id],
    }),
    usageRecords: many(usageRecords),
  }),
);

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [usageRecords.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [usageRecords.projectId],
    references: [projects.id],
  }),
  request: one(requests, {
    fields: [usageRecords.requestId],
    references: [requests.id],
  }),
  attempt: one(requestAttempts, {
    fields: [usageRecords.attemptId],
    references: [requestAttempts.id],
  }),
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [auditEvents.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [auditEvents.projectId],
    references: [projects.id],
  }),
  actorUser: one(users, {
    fields: [auditEvents.actorUserId],
    references: [users.id],
  }),
  actorApiKey: one(gatewayApiKeys, {
    fields: [auditEvents.actorApiKeyId],
    references: [gatewayApiKeys.id],
  }),
}));
