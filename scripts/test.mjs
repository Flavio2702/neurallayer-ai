import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pnpm = fileURLToPath(
  new URL("../node_modules/pnpm/bin/pnpm.cjs", import.meta.url),
);
// Integration fixtures use this synthetic encryption secret; never a user's real secret.
const result = spawnSync(
  process.execPath,
  [pnpm, "-r", "--workspace-concurrency=1", "--if-present", "test"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PROVIDER_CREDENTIALS_SECRET: "provider-credentials-secret-123",
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
