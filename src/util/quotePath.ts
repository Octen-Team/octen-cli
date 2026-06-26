/**
 * Make a filesystem path safe to copy-paste into a shell command.
 *
 * macOS config paths often contain spaces (e.g. "Application Support"), and a
 * bare path printed to the console breaks when pasted into `cat <path>`. If the
 * path contains whitespace or shell-special characters, wrap it in single
 * quotes (escaping any embedded single quote); otherwise return it unchanged.
 */
export function quotePath(p: string): string {
  if (!/[\s'"$`\\!*?(){}\[\]|&;<>~#]/.test(p)) return p;
  return `'${p.replace(/'/g, "'\\''")}'`;
}
