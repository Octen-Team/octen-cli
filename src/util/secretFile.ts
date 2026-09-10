import { writeFileSync, chmodSync } from "node:fs";

/**
 * Write a file that contains an API key, restricted to 0600.
 *
 * Two callers need this and they must not drift: `mcp/write.ts` (the MCP
 * client configs) and `skills/setkey.ts` (the per-client env files). Both used
 * to call `writeFileSync(path, data, "utf8")` with no mode, i.e. 0644 under the
 * default umask.
 *
 * That was tolerable while the only key that could reach them was one the user
 * had already exposed in argv (`--api-key`) or the environment
 * (`OCTEN_API_KEY`). It stopped being tolerable once credential resolution
 * learned to read `~/.octen/credentials.json`: a key that exists nowhere but a
 * 0600 file now flows into these files, and writing it 0644 undoes the store's
 * whole point.
 *
 * The explicit `chmodSync` is load-bearing, not belt-and-braces: `writeFileSync`
 * applies `mode` only when it *creates* the file, and these functions merge into
 * configs that almost always already exist — an existing 0644 file would keep
 * its mode without it.
 *
 * chmod is a no-op on Windows. That is the same limitation the credential store
 * already has, and it is a platform property, not something this can fix.
 */
export function writeSecretFile(filePath: string, data: string): void {
  writeFileSync(filePath, data, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort. A filesystem that refuses chmod must not fail the install —
    // the content itself was written successfully, and failing here would leave
    // the user with a half-configured client and no way forward.
  }
}
