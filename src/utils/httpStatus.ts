/**
 * Named HTTP status code constants.
 *
 * These are provided as readable aliases to avoid sprinkling magic numbers
 * across route and middleware code. They mirror the standard semantics
 * defined in RFC 9110 §15 and do not change any existing wire-level
 * behaviour.
 */

export const HTTP_OK = 200 as const;
export const HTTP_CREATED = 201 as const;
export const HTTP_NO_CONTENT = 204 as const;

export const HTTP_BAD_REQUEST = 400 as const;
export const HTTP_UNAUTHORIZED = 401 as const;
export const HTTP_FORBIDDEN = 403 as const;
export const HTTP_NOT_FOUND = 404 as const;
export const HTTP_CONFLICT = 409 as const;
export const HTTP_UNPROCESSABLE_ENTITY = 422 as const;
export const HTTP_TOO_MANY_REQUESTS = 429 as const;

export const HTTP_INTERNAL_SERVER_ERROR = 500 as const;
export const HTTP_BAD_GATEWAY = 502 as const;
export const HTTP_SERVICE_UNAVAILABLE = 503 as const;
export const HTTP_GATEWAY_TIMEOUT = 504 as const;
