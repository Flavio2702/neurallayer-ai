const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ADMIN_SESSION_VERSION = 1;

export const ADMIN_SESSION_SCOPE = "neuralayer-admin";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_SECONDS = ADMIN_SESSION_TTL_MS / 1000;

export interface AdminSessionClaims {
  version: typeof ADMIN_SESSION_VERSION;
  scope: typeof ADMIN_SESSION_SCOPE;
  exp: number;
}

interface SignAdminSessionTokenInput {
  claims: AdminSessionClaims;
  sessionSecret: string;
}

interface VerifyAdminSessionTokenInput {
  token: string;
  sessionSecret: string;
  nowMs?: number;
}

interface IssueAdminSessionTokenInput {
  sessionSecret: string;
  nowMs?: number;
}

function getSubtleCrypto() {
  const subtleCrypto = globalThis.crypto?.subtle;

  if (!subtleCrypto) {
    throw new Error("Web Crypto API is required for admin session signing.");
  }

  return subtleCrypto;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddedValue = normalizedValue.padEnd(
    Math.ceil(normalizedValue.length / 4) * 4,
    "=",
  );
  const binary = atob(paddedValue);
  const bytes = new Uint8Array(binary.length);

  for (const [index, character] of Array.from(binary).entries()) {
    bytes[index] = character.charCodeAt(0);
  }

  return bytes;
}

function parseAdminSessionClaims(payloadBytes: Uint8Array) {
  const payload = JSON.parse(decoder.decode(payloadBytes));

  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.version !== ADMIN_SESSION_VERSION ||
    payload.scope !== ADMIN_SESSION_SCOPE ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }

  return payload as AdminSessionClaims;
}

async function importHmacKey(sessionSecret: string) {
  return getSubtleCrypto().importKey(
    "raw",
    encoder.encode(sessionSecret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
}

export function createAdminSessionClaims(
  nowMs = Date.now(),
): AdminSessionClaims {
  return {
    version: ADMIN_SESSION_VERSION,
    scope: ADMIN_SESSION_SCOPE,
    exp: Math.floor((nowMs + ADMIN_SESSION_TTL_MS) / 1000),
  };
}

export async function signAdminSessionToken({
  claims,
  sessionSecret,
}: SignAdminSessionTokenInput) {
  const payloadBytes = encoder.encode(JSON.stringify(claims));
  const signatureBuffer = await getSubtleCrypto().sign(
    "HMAC",
    await importHmacKey(sessionSecret),
    payloadBytes,
  );
  const signatureBytes = new Uint8Array(signatureBuffer);

  return `${toBase64Url(payloadBytes)}.${toBase64Url(signatureBytes)}`;
}

export async function issueAdminSessionToken({
  sessionSecret,
  nowMs = Date.now(),
}: IssueAdminSessionTokenInput) {
  const claims = createAdminSessionClaims(nowMs);
  const token = await signAdminSessionToken({
    claims,
    sessionSecret,
  });

  return {
    claims,
    token,
  };
}

export async function verifyAdminSessionToken({
  token,
  sessionSecret,
  nowMs = Date.now(),
}: VerifyAdminSessionTokenInput): Promise<AdminSessionClaims | null> {
  const tokenParts = token.split(".");

  if (tokenParts.length !== 2) {
    return null;
  }

  const [encodedPayload, encodedSignature] = tokenParts;

  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  try {
    const payloadBytes = fromBase64Url(encodedPayload);
    const signatureBytes = fromBase64Url(encodedSignature);
    const claims = parseAdminSessionClaims(payloadBytes);

    if (!claims) {
      return null;
    }

    const isSignatureValid = await getSubtleCrypto().verify(
      "HMAC",
      await importHmacKey(sessionSecret),
      signatureBytes,
      payloadBytes,
    );

    if (!isSignatureValid) {
      return null;
    }

    if (claims.exp <= Math.floor(nowMs / 1000)) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
