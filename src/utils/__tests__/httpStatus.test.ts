import { describe, it, expect } from 'vitest';
import {
    HTTP_OK,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_BAD_REQUEST,
    HTTP_UNAUTHORIZED,
    HTTP_FORBIDDEN,
    HTTP_NOT_FOUND,
    HTTP_CONFLICT,
    HTTP_UNPROCESSABLE_ENTITY,
    HTTP_TOO_MANY_REQUESTS,
    HTTP_INTERNAL_SERVER_ERROR,
    HTTP_BAD_GATEWAY,
    HTTP_SERVICE_UNAVAILABLE,
    HTTP_GATEWAY_TIMEOUT,
} from '../httpStatus.js';

describe('HTTP status constants', () => {
    it('matches the standard 2xx codes', () => {
        expect(HTTP_OK).toBe(200);
        expect(HTTP_CREATED).toBe(201);
        expect(HTTP_NO_CONTENT).toBe(204);
    });

    it('matches the standard 4xx codes', () => {
        expect(HTTP_BAD_REQUEST).toBe(400);
        expect(HTTP_UNAUTHORIZED).toBe(401);
        expect(HTTP_FORBIDDEN).toBe(403);
        expect(HTTP_NOT_FOUND).toBe(404);
        expect(HTTP_CONFLICT).toBe(409);
        expect(HTTP_UNPROCESSABLE_ENTITY).toBe(422);
        expect(HTTP_TOO_MANY_REQUESTS).toBe(429);
    });

    it('matches the standard 5xx codes', () => {
        expect(HTTP_INTERNAL_SERVER_ERROR).toBe(500);
        expect(HTTP_BAD_GATEWAY).toBe(502);
        expect(HTTP_SERVICE_UNAVAILABLE).toBe(503);
        expect(HTTP_GATEWAY_TIMEOUT).toBe(504);
    });
});
