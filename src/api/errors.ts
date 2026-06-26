export class OctenError extends Error {}
export class OctenAuthError extends OctenError {}
export class OctenValidationError extends OctenError {}
export class OctenTimeoutError extends OctenError {}
export class OctenNetworkError extends OctenError {}
export class OctenAPIError extends OctenError {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof OctenAuthError || err instanceof OctenValidationError) return 2;
  return 1;
}
