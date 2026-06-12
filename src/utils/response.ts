import type { Response } from 'express';

/**
 * Standardized API response envelope.
 *
 * Every JSON response emitted by the API follows this shape so clients can
 * branch on the presence of `error` rather than parsing free-form payloads.
 * Exactly one of `data` / `error` is expected to be non-null at a time.
 */
export interface ApiResponse<T = unknown> {
    /** Successful payload, or `null` when an error is present. */
    data: T | null;
    /** Human-readable error message, or `null` on success. */
    error: string | null;
}

/**
 * Sends a successful response with the unified envelope format.
 * 
 * @param res The Express response object
 * @param data The payload to send
 * @param statusCode The HTTP status code (defaults to 200)
 */
export const ok = <T>(res: Response, data: T, statusCode = 200): Response => {
    const payload: ApiResponse<T> = {
        data,
        error: null,
    };
    return res.status(statusCode).json(payload);
};

/**
 * Sends a failure response with the unified envelope format.
 * Prevents internal details from leaking by forcing generic messages for 500 errors
 * unless a specific string message is provided.
 * 
 * @param res The Express response object
 * @param error The original error or error message
 * @param statusCode The HTTP status code (defaults to 500)
 */
export const fail = (res: Response, error: unknown, statusCode = 500): Response => {
    let errorMessage = 'Internal server error';

    if (statusCode < 500) {
        // For client errors (4xx), it's generally safe to send the message
        if (typeof error === 'string') {
            errorMessage = error;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = 'Bad request';
        }
    } else {
        // For server errors (5xx), we strictly limit what we send
        if (typeof error === 'string') {
            errorMessage = error; // Only explicit strings are allowed to be sent for 5xx
        }
        // Note: We deliberately drop standard Error objects for 500 to avoid leaking internals like stack traces or SQL errors
    }

    const payload: ApiResponse<null> = {
        data: null,
        error: errorMessage,
    };

    return res.status(statusCode).json(payload);
};
