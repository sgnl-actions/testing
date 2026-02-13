import { jest } from '@jest/globals';
import { parseFixture, parseFixtureString } from '../src/parse-fixture.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseFixtureString', () => {
  test('parses a simple 200 response with JSON body', () => {
    const raw = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      '{"id":"usr123","status":"SUSPENDED"}'
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      'Content-Type': 'application/json'
    });
    expect(result.body).toBe('{"id":"usr123","status":"SUSPENDED"}');
  });

  test('parses multiple headers', () => {
    const raw = [
      'HTTP/1.1 429 Too Many Requests',
      'Content-Type: application/json',
      'X-Rate-Limit-Remaining: 0',
      'Retry-After: 30',
      '',
      '{"errorCode":"E0000047","errorSummary":"Rate limit exceeded"}'
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(429);
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Rate-Limit-Remaining': '0',
      'Retry-After': '30'
    });
    expect(result.body).toBe('{"errorCode":"E0000047","errorSummary":"Rate limit exceeded"}');
  });

  test('parses response with no body', () => {
    const raw = [
      'HTTP/1.1 204 No Content',
      'X-Request-Id: abc123',
      '',
      ''
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(204);
    expect(result.headers).toEqual({ 'X-Request-Id': 'abc123' });
    expect(result.body).toBe('');
  });

  test('parses response with multi-line body', () => {
    const body = JSON.stringify({ id: 'usr123', nested: { key: 'value' } }, null, 2);
    const raw = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      body
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(body);
  });

  test('parses HTTP/2 status line', () => {
    const raw = [
      'HTTP/2 503 Service Unavailable',
      'Content-Type: text/plain',
      '',
      'Service temporarily unavailable'
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(503);
    expect(result.body).toBe('Service temporarily unavailable');
  });

  test('handles LF line endings (no CR)', () => {
    const raw = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      '{"ok":true}'
    ].join('\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"ok":true}');
  });

  test('parses response with no headers', () => {
    const raw = [
      'HTTP/1.1 200 OK',
      '',
      '{"ok":true}'
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({});
    expect(result.body).toBe('{"ok":true}');
  });

  test('throws on invalid input (no status line)', () => {
    expect(() => parseFixtureString('')).toThrow('Invalid HTTP fixture');
    expect(() => parseFixtureString('not http')).toThrow('Invalid HTTP fixture');
  });

  test('handles header values with colons', () => {
    const raw = [
      'HTTP/1.1 200 OK',
      'Location: https://example.com/api/v1/users/123',
      '',
      ''
    ].join('\r\n');

    const result = parseFixtureString(raw);

    expect(result.headers).toEqual({
      'Location': 'https://example.com/api/v1/users/123'
    });
  });
});

describe('parseFixture', () => {
  const fixtureDir = join(tmpdir(), `sgnl-testing-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(fixtureDir, { recursive: true });
  });

  test('reads and parses a fixture file', () => {
    const fixturePath = join(fixtureDir, '200-ok.http');
    writeFileSync(fixturePath, [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      '{"status":"success"}'
    ].join('\r\n'));

    const result = parseFixture(fixturePath);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"status":"success"}');
  });

  test('resolves relative paths from a base directory', () => {
    const fixturePath = join(fixtureDir, 'relative.http');
    writeFileSync(fixturePath, [
      'HTTP/1.1 201 Created',
      '',
      ''
    ].join('\r\n'));

    const result = parseFixture('relative.http', fixtureDir);

    expect(result.statusCode).toBe(201);
  });

  test('throws on missing fixture file', () => {
    expect(() => parseFixture('/nonexistent/path.http')).toThrow();
  });
});
