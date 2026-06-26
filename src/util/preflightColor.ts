// Honor --no-color before picocolors is imported anywhere (it reads NO_COLOR at module-eval time).
export function applyNoColor(argv: string[], env: NodeJS.ProcessEnv): void {
  if (argv.includes("--no-color")) {
    env.NO_COLOR = "1";
  }
}

applyNoColor(process.argv, process.env);
