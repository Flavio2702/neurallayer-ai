import type { Message, Mode } from "@neuralayer/core";

export const PROJECT_GATEWAY_API_KEY_PLACEHOLDER = "<paste-project-api-key>";

interface BuildGatewayChatCompletionsCurlSnippetInput {
  apiKey?: string | null;
  gatewayUrl: string;
  projectId: string;
  mode?: Mode;
  messages?: Message[];
}

function buildDefaultMessages(): Message[] {
  return [
    {
      role: "user",
      content: "Summarize the latest gateway outcome.",
    },
  ];
}

function escapeSingleQuotedShellString(value: string) {
  return value.replaceAll("'", `'"'"'`);
}

export function resolveGatewayCurlApiKey(apiKey?: string | null) {
  const normalizedApiKey = apiKey?.trim();

  return normalizedApiKey && normalizedApiKey.length > 0
    ? normalizedApiKey
    : PROJECT_GATEWAY_API_KEY_PLACEHOLDER;
}

export function buildGatewayChatCompletionsCurlSnippet(
  input: BuildGatewayChatCompletionsCurlSnippetInput,
) {
  const payload = JSON.stringify(
    {
      messages:
        input.messages && input.messages.length > 0
          ? input.messages
          : buildDefaultMessages(),
      project_id: input.projectId,
      mode: input.mode ?? "balanced",
      stream: false,
    },
    null,
    2,
  );
  const url = new URL("/v1/chat/completions", input.gatewayUrl).toString();

  return [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer ${resolveGatewayCurlApiKey(input.apiKey)}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  --data-raw '${escapeSingleQuotedShellString(payload)}'`,
  ].join("\n");
}
