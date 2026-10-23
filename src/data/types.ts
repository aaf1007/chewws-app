export type UserId = string & { readonly __brand: 'UserId' };

export type Profile = {
  id: UserId;
  username: string | null;
  createdAt: string;
};

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; userId: UserId };

export type IdTokenProvider = 'apple' | 'google';

export class DataError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataError';
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUserId(raw: string): UserId {
  if (!UUID.test(raw)) {
    throw new DataError('invalid_user_id', `Not a user id: ${raw}`);
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one brand constructor
  return raw as UserId;
}
