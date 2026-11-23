import { describe, it, expect } from "vitest";
import { printable, printableLine } from "../../src/util/terminalText.js";

const ESC = "\u001b";

describe("printable", () => {
  it("leaves ordinary text alone, including text outside ASCII", () => {
    const s = "Café — pricing \u{1F600} <div class=\"a\">";
    expect(printable(s)).toBe(s);
  });

  it("keeps tabs and line breaks", () => {
    expect(printable("a\tb\nc")).toBe("a\tb\nc");
  });

  it("shows an escape sequence instead of sending it to the terminal", () => {
    expect(printable(`before${ESC}[2J${ESC}[Hafter`)).toBe("before\\x1b[2J\\x1b[Hafter");
  });

  it("shows the other control characters too", () => {
    expect(printable("a\u0007b\u0000c\u0008d\u007fe")).toBe("a\\x07b\\x00c\\x08d\\x7fe");
  });

  // A lone 0x9b is a whole CSI introducer on terminals that honour C1 codes.
  it("shows the C1 control characters", () => {
    expect(printable("a\u009b2Jb\u0085c")).toBe("a\\x9b2Jb\\x85c");
  });

  // A carriage return is how a line overwrites the one before it.
  it("turns a carriage return into a line break", () => {
    expect(printable("visible\rhidden")).toBe("visible\nhidden");
    expect(printable("a\r\nb")).toBe("a\nb");
  });

  // These reorder what is displayed without changing what is there.
  it("shows the bidirectional overrides", () => {
    expect(printable("a\u202eb\u2066c\u2069d")).toBe("a\\u202eb\\u2066c\\u2069d");
  });
});

describe("printableLine", () => {
  it("keeps a value on one line", () => {
    expect(printableLine("a\nb\tc\r\nd")).toBe("a b c d");
  });

  it("escapes what printable escapes", () => {
    expect(printableLine(`t${ESC}[31m`)).toBe("t\\x1b[31m");
  });
});
