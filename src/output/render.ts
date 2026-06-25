export type OutputMode = "pretty" | "json";

export function chooseMode(opts: { json?: boolean; pretty?: boolean }, isTty: boolean): OutputMode {
  if (opts.json) return "json";
  if (opts.pretty) return "pretty";
  return isTty ? "pretty" : "json";
}

export function emit(data: unknown, mode: OutputMode, prettyFn: (d: any) => string): void {
  if (mode === "json") process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(prettyFn(data) + "\n");
}
