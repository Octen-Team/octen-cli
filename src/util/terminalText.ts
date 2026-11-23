/**
 * Make text from a response safe to write to a terminal.
 *
 * Titles, descriptions and code come from somebody else's page. Written as
 * they are, an escape sequence in them drives the terminal — clears the
 * screen, rewrites a line already printed, retitles the window — and a
 * carriage return lets one line overwrite the one before it. These show the
 * character instead of sending it. `--json` output is not touched: there the
 * same characters are already escaped by JSON.
 */

// Every C0 control but tab and line feed, DEL, the C1 controls (a lone 0x9b is
// a whole CSI introducer on terminals that honour them), and the bidirectional
// overrides, which reorder what is displayed without changing what is there.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

function shown(c: string): string {
  const code = c.charCodeAt(0);
  return code <= 0xff
    ? `\\x${code.toString(16).padStart(2, "0")}`
    : `\\u${code.toString(16).padStart(4, "0")}`;
}

/** For text that may run over several lines, such as code. Tabs and line breaks are kept. */
export function printable(s: string): string {
  // A carriage return is meant as a line break, so it becomes one.
  return s.replace(/\r\n?/g, "\n").replace(UNSAFE, shown);
}

/** For a value that belongs on one line, such as a title or a URL. */
export function printableLine(s: string): string {
  return printable(s).replace(/[\t\n]+/g, " ");
}
