import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Keep tests that reach Devin away from a developer's real config directory.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], exclude: ["test/e2e/**"], environment: "node", env: { XDG_CONFIG_HOME: "", APPDATA: join(tmpdir(), "octen-test-appdata") } } });
