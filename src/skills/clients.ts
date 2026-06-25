import { join } from "node:path";

export interface SkillClient {
  id: "claude-code" | "cursor" | "codex" | "openclaw" | "hermes";
  label: string;
  supportsProject: boolean;
  dirFor(scope: "user" | "project", home: string, cwd: string): string;
}

export const SKILL_CLIENTS: SkillClient[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    supportsProject: true,
    dirFor(scope, home, cwd) {
      return scope === "project"
        ? join(cwd, ".claude/skills")
        : join(home, ".claude/skills");
    },
  },
  {
    id: "cursor",
    label: "Cursor",
    supportsProject: true,
    dirFor(scope, home, cwd) {
      return scope === "project"
        ? join(cwd, ".cursor/skills")
        : join(home, ".cursor/skills");
    },
  },
  {
    id: "codex",
    label: "Codex",
    supportsProject: false,
    dirFor(_scope, home, _cwd) {
      return join(home, ".codex/skills");
    },
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    supportsProject: false,
    dirFor(_scope, home, _cwd) {
      return join(home, ".openclaw/skills");
    },
  },
  {
    id: "hermes",
    label: "Hermes",
    supportsProject: false,
    dirFor(_scope, home, _cwd) {
      return join(home, ".hermes/skills");
    },
  },
];
