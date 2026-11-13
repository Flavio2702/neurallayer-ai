import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

import { loadProviderCredentialsConfig } from "@neuralayer/config";

const PROVIDER_CREDENTIALS_SECRET_ENV_NAME = "PROVIDER_CREDENTIALS_SECRET";
const PROVIDER_CREDENTIALS_SECRET_MIN_LENGTH = 16;
const PROVIDER_CREDENTIALS_ENVELOPE_VERSION = 1;
const PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM = "aes-256-gcm";
const PROVIDER_CREDENTIALS_ENVELOPE_KDF = "scrypt";
const PROVIDER_CREDENTIALS_SALT_LENGTH = 16;
const PROVIDER_CREDENTIALS_IV_LENGTH = 12;
const PROVIDER_CREDENTIALS_KEY_LENGTH = 32;
const PROVIDER_CREDENTIALS_AUTH_TAG_LENGTH = 16;
const PROVIDER_CREDENTIALS_AAD = Buffer.from(
  "neuralayer.provider_credentials.v1",
  "utf8",
);

export interface ProviderCredentialsPayload {
  [key: string]: unknown;
}

export interface ProviderCredentialsEnvelopeV1 {
  version: typeof PROVIDER_CREDENTIALS_ENVELOPE_VERSION;
  algorithm: typeof PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM;
  kdf: typeof PROVIDER_CREDENTIALS_ENVELOPE_KDF;
  salt: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface ProviderCredentialsCrypto {
  encryptProviderCredentials(payload: ProviderCredentialsPayload): string;
  decryptProviderCredentials<
    TPayload extends ProviderCredentialsPayload = ProviderCredentialsPayload,
  >(serializedEnvelope: string): TPayload;
}

export function createProviderCredentialsCrypto(input: { secret: string }) {
  const secret = normalizeProviderCredentialsSecret(input.secret);

  return {
    encryptProviderCredentials(payload) {
      return encryptWithSecret(secret, payload);
    },
    decryptProviderCredentials(serializedEnvelope) {
      return decryptWithSecret(secret, serializedEnvelope);
    },
  } satisfies ProviderCredentialsCrypto;
}

export function loadProviderCredentialsCrypto(env?: NodeJS.ProcessEnv) {
  const { providerCredentialsSecret } = loadProviderCredentialsConfig(env);

  return createProviderCredentialsCrypto({
    secret: providerCredentialsSecret,
  });
}

export function encryptProviderCredentials(
  payload: ProviderCredentialsPayload,
  env?: NodeJS.ProcessEnv,
) {
  return loadProviderCredentialsCrypto(env).encryptProviderCredentials(payload);
}

export function decryptProviderCredentials<
  TPayload extends ProviderCredentialsPayload = ProviderCredentialsPayload,
>(serializedEnvelope: string, env?: NodeJS.ProcessEnv) {
  return loadProviderCredentialsCrypto(
    env,
  ).decryptProviderCredentials<TPayload>(serializedEnvelope);
}

export function parseProviderCredentialsEnvelope(
  serializedEnvelope: string | null | undefined,
): ProviderCredentialsEnvelopeV1 | null {
  if (typeof serializedEnvelope !== "string") {
    return null;
  }

  try {
    const envelope = parseEnvelope(serializedEnvelope);

    decodeEnvelopeBuffer(envelope.salt, PROVIDER_CREDENTIALS_SALT_LENGTH);
    decodeEnvelopeBuffer(envelope.iv, PROVIDER_CREDENTIALS_IV_LENGTH);
    decodeEnvelopeBuffer(envelope.ciphertext);
    decodeEnvelopeBuffer(
      envelope.authTag,
      PROVIDER_CREDENTIALS_AUTH_TAG_LENGTH,
    );

    return envelope;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderCredentialsSecret(secret: string) {
  const normalizedSecret = secret.trim();

  if (normalizedSecret.length === 0) {
    throw new Error(
      `Missing required secret ${PROVIDER_CREDENTIALS_SECRET_ENV_NAME}.`,
    );
  }

  if (normalizedSecret.length < PROVIDER_CREDENTIALS_SECRET_MIN_LENGTH) {
    throw new Error(
      `${PROVIDER_CREDENTIALS_SECRET_ENV_NAME} must be at least ${PROVIDER_CREDENTIALS_SECRET_MIN_LENGTH} characters.`,
    );
  }

  return normalizedSecret;
}

function serializeProviderCredentialsPayload(
  payload: ProviderCredentialsPayload,
) {
  if (!isRecord(payload)) {
    throw new Error("Provider credentials payload must be a JSON object.");
  }

  try {
    return JSON.stringify(payload);
  } catch {
    throw new Error("Provider credentials payload must be JSON-serializable.");
  }
}

function createMalformedPayloadError() {
  return new Error("Unsupported or malformed provider credentials payload.");
}

function decodeEnvelopeBuffer(value: string, expectedLength?: number): Buffer {
  try {
    const decodedValue = Buffer.from(value, "base64url");

    if (decodedValue.length === 0) {
      throw createMalformedPayloadError();
    }

    if (
      typeof expectedLength === "number" &&
      decodedValue.length !== expectedLength
    ) {
      throw createMalformedPayloadError();
    }

    return decodedValue;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw createMalformedPayloadError();
  }
}

function parseEnvelope(
  serializedEnvelope: string,
): ProviderCredentialsEnvelopeV1 {
  const trimmedEnvelope = serializedEnvelope.trim();

  if (trimmedEnvelope.length === 0) {
    throw createMalformedPayloadError();
  }

  let parsedEnvelope: unknown;

  try {
    parsedEnvelope = JSON.parse(trimmedEnvelope);
  } catch {
    throw createMalformedPayloadError();
  }

  if (!isRecord(parsedEnvelope)) {
    throw createMalformedPayloadError();
  }

  if (parsedEnvelope.version !== PROVIDER_CREDENTIALS_ENVELOPE_VERSION) {
    throw new Error("Unsupported provider credentials payload version.");
  }

  if (parsedEnvelope.algorithm !== PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM) {
    throw new Error("Unsupported provider credentials payload algorithm.");
  }

  if (parsedEnvelope.kdf !== PROVIDER_CREDENTIALS_ENVELOPE_KDF) {
    throw new Error(
      "Unsupported provider credentials payload key derivation function.",
    );
  }

  if (
    typeof parsedEnvelope.salt !== "string" ||
    typeof parsedEnvelope.iv !== "string" ||
    typeof parsedEnvelope.ciphertext !== "string" ||
    typeof parsedEnvelope.authTag !== "string"
  ) {
    throw createMalformedPayloadError();
  }

  return {
    version: PROVIDER_CREDENTIALS_ENVELOPE_VERSION,
    algorithm: PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM,
    kdf: PROVIDER_CREDENTIALS_ENVELOPE_KDF,
    salt: parsedEnvelope.salt,
    iv: parsedEnvelope.iv,
    ciphertext: parsedEnvelope.ciphertext,
    authTag: parsedEnvelope.authTag,
  };
}

function deriveEncryptionKey(secret: string, salt: Buffer) {
  return scryptSync(secret, salt, PROVIDER_CREDENTIALS_KEY_LENGTH);
}

function encryptWithSecret(
  secret: string,
  payload: ProviderCredentialsPayload,
) {
  const serializedPayload = serializeProviderCredentialsPayload(payload);
  const salt = randomBytes(PROVIDER_CREDENTIALS_SALT_LENGTH);
  const iv = randomBytes(PROVIDER_CREDENTIALS_IV_LENGTH);
  const key = deriveEncryptionKey(secret, salt);
  const cipher = createCipheriv(
    PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM,
    key,
    iv,
  );

  cipher.setAAD(PROVIDER_CREDENTIALS_AAD);

  const ciphertext = Buffer.concat([
    cipher.update(serializedPayload, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    version: PROVIDER_CREDENTIALS_ENVELOPE_VERSION,
    algorithm: PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM,
    kdf: PROVIDER_CREDENTIALS_ENVELOPE_KDF,
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: authTag.toString("base64url"),
  } satisfies ProviderCredentialsEnvelopeV1);
}

function decryptWithSecret<
  TPayload extends ProviderCredentialsPayload = ProviderCredentialsPayload,
>(secret: string, serializedEnvelope: string): TPayload {
  const envelope = parseEnvelope(serializedEnvelope);
  const salt = decodeEnvelopeBuffer(
    envelope.salt,
    PROVIDER_CREDENTIALS_SALT_LENGTH,
  );
  const iv = decodeEnvelopeBuffer(envelope.iv, PROVIDER_CREDENTIALS_IV_LENGTH);
  const ciphertext = decodeEnvelopeBuffer(envelope.ciphertext);
  const authTag = decodeEnvelopeBuffer(
    envelope.authTag,
    PROVIDER_CREDENTIALS_AUTH_TAG_LENGTH,
  );
  const key = deriveEncryptionKey(secret, salt);
  const decipher = createDecipheriv(
    PROVIDER_CREDENTIALS_ENVELOPE_ALGORITHM,
    key,
    iv,
  );

  decipher.setAAD(PROVIDER_CREDENTIALS_AAD);
  decipher.setAuthTag(authTag);

  let serializedPayload: string;

  try {
    serializedPayload = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      `Unable to decrypt provider credentials with the configured ${PROVIDER_CREDENTIALS_SECRET_ENV_NAME}.`,
    );
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(serializedPayload);
  } catch {
    throw createMalformedPayloadError();
  }

  if (!isRecord(parsedPayload)) {
    throw createMalformedPayloadError();
  }

  return parsedPayload as TPayload;
}
