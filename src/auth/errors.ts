export function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
