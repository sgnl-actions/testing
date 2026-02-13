import { readFileSync } from 'fs';
import { resolve, isAbsolute } from 'path';

/**
 * Parse a raw HTTP response string into { statusCode, headers, body }.
 *
 * Accepts standard HTTP response format as captured by `curl -i`:
 *   HTTP/1.1 200 OK
 *   Content-Type: application/json
 *
 *   {"key":"value"}
 *
 * @param {string} raw - Raw HTTP response text
 * @returns {{ statusCode: number, headers: Record<string, string>, body: string }}
 */
export function parseFixtureString(raw) {
  // Normalise line endings to \n
  const normalised = raw.replace(/\r\n/g, '\n');

  // Split on first blank line to separate headers from body
  const separatorIndex = normalised.indexOf('\n\n');
  const headerSection = separatorIndex === -1 ? normalised : normalised.slice(0, separatorIndex);
  const body = separatorIndex === -1 ? '' : normalised.slice(separatorIndex + 2);

  const headerLines = headerSection.split('\n');
  const statusLine = headerLines[0];

  // Match HTTP/x.y or HTTP/x status line
  const statusMatch = statusLine.match(/^HTTP\/[\d.]+ (\d{3})/);
  if (!statusMatch) {
    throw new Error(`Invalid HTTP fixture: expected status line, got "${statusLine}"`);
  }

  const statusCode = parseInt(statusMatch[1], 10);

  // Parse headers (lines after status line)
  const headers = {};
  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i];
    if (!line) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const name = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    headers[name] = value;
  }

  return { statusCode, headers, body };
}

/**
 * Read and parse a .http fixture file.
 *
 * @param {string} filePath - Absolute or relative path to the .http file
 * @param {string} [baseDir] - Base directory for resolving relative paths
 * @returns {{ statusCode: number, headers: Record<string, string>, body: string }}
 */
export function parseFixture(filePath, baseDir) {
  const resolved = isAbsolute(filePath) ? filePath : resolve(baseDir, filePath);
  const raw = readFileSync(resolved, 'utf-8');
  return parseFixtureString(raw);
}
