import { z } from "zod";

const NODE_ENV_VALUES = ["development", "test", "production"] as const;
const LOG_LEVEL_VALUES = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;
const CONFIG_ERROR_PREFIX = "[@neuralayer/config]";

const optionalTrimmedEnvString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}, z.string().trim().min(1).optional());

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENV_VALUES).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVEL_VALUES).default("info"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://postgres:postgres@localhost:5432/neurallayer"),
  ARTIFICIAL_ANALYSIS_API_KEY: optionalTrimmedEnvString,
  GATEWAY_HOST: z.string().min(1).default("0.0.0.0"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(4000),
  ADMIN_PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_WORKSPACE_ID: optionalTrimmedEnvString,
  ADMIN_SMOKE_WORKSPACE_ID: optionalTrimmedEnvString,
  NEXT_PUBLIC_GATEWAY_URL: z.string().url().default("http://localhost:4000"),
  ADMIN_ACCESS_PASSWORD: optionalTrimmedEnvString,
  ADMIN_SESSION_SECRET: optionalTrimmedEnvString,
  PROVIDER_CREDENTIALS_SECRET: optionalTrimmedEnvString,
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
export type LogLevel = RuntimeEnv["LOG_LEVEL"];

export interface GatewayConfig {
  nodeEnv: RuntimeEnv["NODE_ENV"];
  logLevel: LogLevel;
  gateway: {
    host: string;
    port: number;
  };
}

export interface AdminConfig {
  nodeEnv: RuntimeEnv["NODE_ENV"];
  admin: {
    port: number;
    workspaceId?: string;
    smokeWorkspaceId?: string;
  };
  public: {
    gatewayUrl: string;
  };
}

export interface DatabaseConfig {
  nodeEnv: RuntimeEnv["NODE_ENV"];
  database: {
    url: string;
  };
  artificialAnalysis: {
    apiKey?: string;
  };
}

export interface AdminAccessGateConfig {
  accessPassword: string;
}

export interface AdminSessionConfig {
  sessionSecret: string;
}

export interface ProviderCredentialsConfig {
  providerCredentialsSecret: string;
}

function formatEnvSchemaErrors(error: z.ZodError) {
  return error.issues.map((issue) => {
    const issuePath =
      issue.path.length > 0 ? issue.path.join(".") : "environment";

    return `- ${issuePath}: ${issue.message}`;
  });
}

function createConfigValidationError(context: string, error: z.ZodError) {
  return new Error(
    [
      `${CONFIG_ERROR_PREFIX} Invalid ${context}.`,
      ...formatEnvSchemaErrors(error),
    ].join("\n"),
  );
}

function requireConfiguredEnv(
  value: string | undefined,
  envName:
    | "ADMIN_ACCESS_PASSWORD"
    | "ADMIN_SESSION_SECRET"
    | "PROVIDER_CREDENTIALS_SECRET",
  reason: string,
) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(
    `${CONFIG_ERROR_PREFIX} Missing required env var ${envName}: ${reason}.`,
  );
}

export function parseRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  const result = runtimeEnvSchema.safeParse(env);

  if (!result.success) {
    throw createConfigValidationError("runtime environment", result.error);
  }

  return result.data;
}

export function loadGatewayConfig(env?: NodeJS.ProcessEnv): GatewayConfig {
  const runtimeEnv = parseRuntimeEnv(env);

  return {
    nodeEnv: runtimeEnv.NODE_ENV,
    logLevel: runtimeEnv.LOG_LEVEL,
    gateway: {
      host: runtimeEnv.GATEWAY_HOST,
      port: runtimeEnv.GATEWAY_PORT,
    },
  };
}

export function loadAdminConfig(env?: NodeJS.ProcessEnv): AdminConfig {
  const runtimeEnv = parseRuntimeEnv(env);

  return {
    nodeEnv: runtimeEnv.NODE_ENV,
    admin: {
      port: runtimeEnv.ADMIN_PORT,
      workspaceId: runtimeEnv.ADMIN_WORKSPACE_ID,
      smokeWorkspaceId: runtimeEnv.ADMIN_SMOKE_WORKSPACE_ID,
    },
    public: {
      gatewayUrl: runtimeEnv.NEXT_PUBLIC_GATEWAY_URL,
    },
  };
}

export function loadDatabaseConfig(env?: NodeJS.ProcessEnv): DatabaseConfig {
  const runtimeEnv = parseRuntimeEnv(env);

  return {
    nodeEnv: runtimeEnv.NODE_ENV,
    database: {
      url: runtimeEnv.DATABASE_URL,
    },
    artificialAnalysis: {
      apiKey: runtimeEnv.ARTIFICIAL_ANALYSIS_API_KEY,
    },
  };
}

export function loadAdminAccessGateConfig(
  env?: NodeJS.ProcessEnv,
): AdminAccessGateConfig {
  const runtimeEnv = parseRuntimeEnv(env);

  return {
    accessPassword: requireConfiguredEnv(
      runtimeEnv.ADMIN_ACCESS_PASSWORD,
      "ADMIN_ACCESS_PASSWORD",
      "required for the admin access gate",
    ),
  };
}

export function loadAdminSessionConfig(
  env?: NodeJS.ProcessEnv,
): AdminSessionConfig {
  const runtimeEnv = parseRuntimeEnv(env);

  return {
    sessionSecret: requireConfiguredEnv(
      runtimeEnv.ADMIN_SESSION_SECRET,
      "ADMIN_SESSION_SECRET",
      "required for admin session signing",
    ),
  };
}

export function loadProviderCredentialsConfig(
  env?: NodeJS.ProcessEnv,
): ProviderCredentialsConfig {
  const runtimeEnv = parseRuntimeEnv(env);

  return {
    providerCredentialsSecret: requireConfiguredEnv(
      runtimeEnv.PROVIDER_CREDENTIALS_SECRET,
      "PROVIDER_CREDENTIALS_SECRET",
      "required for provider credential encryption/decryption",
    ),
  };
}
