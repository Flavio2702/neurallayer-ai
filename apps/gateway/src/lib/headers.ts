export function getHeaderValue(headerValue: string | string[] | undefined) {
  if (typeof headerValue === "string") {
    return headerValue;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return undefined;
}

export function getOptionalHeaderValue(
  headerValue: string | string[] | undefined,
) {
  const normalizedHeaderValue = getHeaderValue(headerValue)?.trim();

  if (!normalizedHeaderValue) {
    return undefined;
  }

  return normalizedHeaderValue;
}
