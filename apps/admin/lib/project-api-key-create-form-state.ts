import type { ProjectGatewayApiKeySummary } from "@neuralayer/db";

export interface ProjectApiKeyCreateFormState {
  status: "idle" | "success" | "error";
  message: string | null;
  rawKey: string | null;
  curlSnippet: string | null;
  apiKey: ProjectGatewayApiKeySummary | null;
}

export const initialProjectApiKeyCreateFormState: ProjectApiKeyCreateFormState =
  {
    status: "idle",
    message: null,
    rawKey: null,
    curlSnippet: null,
    apiKey: null,
  };
