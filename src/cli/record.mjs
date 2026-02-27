#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import nock from 'nock';


const YAML_OPTIONS = { lineWidth: -1, quotingType: '"', forceQuotes: false, noRefs: true };

/**
 * Find the start/end line offsets (in the raw string) of each top-level
 * scenario entry inside the `scenarios:` array.  Returns an array of
 * { start, end } character offsets suitable for string splicing.
 *
 * Each scenario begins with `  - name:` (two-space indent + dash) and
 * continues until the next entry at the same indent or EOF.
 */
function locateScenarioBlocks(raw) {
  const lines = raw.split('\n');
  const blocks = [];
  let inScenarios = false;
  let currentStart = null;
  let charOffset = 0;
  const lineOffsets = []; // charOffset of each line start

  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(charOffset);
    charOffset += lines[i].length + 1; // +1 for the newline
  }
  const totalLength = raw.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect the `scenarios:` key (top-level)
    if (/^scenarios\s*:/.test(line)) {
      inScenarios = true;
      continue;
    }

    if (!inScenarios) continue;

    // A top-level key (no indent) means we left the scenarios block
    if (/^\S/.test(line) && line.trim() !== '') {
      if (currentStart !== null) {
        blocks.push({ start: currentStart, end: lineOffsets[i] });
        currentStart = null;
      }
      inScenarios = false;
      continue;
    }

    // Detect `  - name:` — a new scenario list entry
    if (/^  - /.test(line)) {
      if (currentStart !== null) {
        blocks.push({ start: currentStart, end: lineOffsets[i] });
      }
      currentStart = lineOffsets[i];
    }
  }

  // Close the last block
  if (currentStart !== null) {
    blocks.push({ start: currentStart, end: totalLength });
  }

  return blocks;
}

/**
 * Serialize a single recorded scenario to a YAML snippet indented for
 * inclusion inside the `scenarios:` array (2-space indent, dash prefix).
 */
function serializeScenarioBlock(scenario) {
  // Dump as a single-element array so js-yaml produces `- name: ...` format
  const snippet = yaml.dump([scenario], YAML_OPTIONS);
  // Indent by 2 spaces (scenarios array lives under the top-level key)
  return snippet
    .split('\n')
    .map(line => (line === '' ? '' : '  ' + line))
    .join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Convert a scenario name into a filename-safe slug.
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Extract hostname (without port) from a nock scope URL.
 * @param {string} scope - e.g. "https://crypto-sgnl.svc:443"
 * @returns {string}
 */
export function hostnameFromScope(scope) {
  try {
    const url = new URL(scope);
    return url.hostname;
  } catch {
    return scope;
  }
}

/**
 * Reconstruct full URL from nock recording scope + path.
 * @param {string} scope - e.g. "https://receiver.example.com:443"
 * @param {string} path - e.g. "/events"
 * @returns {string}
 */
export function buildRequestUrl(scope, path) {
  try {
    const url = new URL(scope);
    // Drop default ports that nock adds
    const isDefaultPort =
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80');
    const origin = isDefaultPort
      ? `${url.protocol}//${url.hostname}`
      : `${url.protocol}//${url.host}`;
    return origin + path;
  } catch {
    return scope + path;
  }
}

/**
 * Convert nock's flat rawHeaders array [key, value, key, value, ...]
 * to "Key: Value" lines.
 * @param {string[]} rawHeaders
 * @returns {string[]}
 */
export function rawHeadersToLines(rawHeaders) {
  const lines = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    lines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
  }
  return lines;
}

/**
 * Convert a single nock recording object to .http fixture content.
 * @param {Object} recorded - nock output_objects entry
 * @returns {string}
 */
export function buildFixtureContent(recorded) {
  const status = recorded.status;
  const statusText = statusTextFromCode(status);

  // Build header lines from rawHeaders (preferred) or headers object.
  // nock may return rawHeaders as a flat array [key, val, ...] (http) or
  // as an object { key: val } (fetch recorder). Handle both.
  let headerLines;
  if (recorded.rawHeaders && Array.isArray(recorded.rawHeaders) && recorded.rawHeaders.length > 0) {
    headerLines = rawHeadersToLines(recorded.rawHeaders);
  } else if (recorded.rawHeaders && typeof recorded.rawHeaders === 'object' && !Array.isArray(recorded.rawHeaders)) {
    headerLines = Object.entries(recorded.rawHeaders).map(([k, v]) => `${k}: ${v}`);
  } else if (recorded.headers) {
    headerLines = Object.entries(recorded.headers).map(([k, v]) => `${k}: ${v}`);
  } else {
    headerLines = [];
  }

  // Body — nock may return parsed JSON objects, serialize back
  let body = '';
  if (recorded.response !== undefined && recorded.response !== null) {
    body = typeof recorded.response === 'string'
      ? recorded.response
      : JSON.stringify(recorded.response);
  }

  return `HTTP/1.1 ${status} ${statusText}\n${headerLines.join('\n')}\n\n${body}\n`;
}

/**
 * Generate a fixture filename.
 * Single-step: `{slug}.http`
 * Multi-step:  `{slug}-step{N}.http`
 *
 * @param {string} slug - scenario slug
 * @param {number} stepIndex - 1-based step index
 * @param {number} totalSteps - total number of steps in the scenario
 * @returns {string}
 */
export function fixtureFilename(slug, stepIndex, totalSteps) {
  if (totalSteps <= 1) return `${slug}.http`;
  return `${slug}-step${stepIndex}.http`;
}

/**
 * Replace all secret values with "REDACTED" in a secrets object.
 * @param {Object} secrets
 * @returns {Object}
 */
export function sanitizeSecrets(secrets) {
  if (!secrets || typeof secrets !== 'object') return {};
  const sanitized = {};
  for (const key of Object.keys(secrets)) {
    sanitized[key] = 'REDACTED';
  }
  return sanitized;
}

/**
 * Run one scenario against real systems and return nock recordings.
 * @param {Object} script - action module with invoke/error
 * @param {Object} params - action params
 * @param {Object} context - action context (with real secrets)
 * @returns {Promise<{ result: any, error: Error|null, recordings: Array }>}
 */
export async function recordRun(script, params, context) {
  // Ensure nock is not intercepting — we want real HTTP
  nock.cleanAll();
  nock.enableNetConnect();
  if (nock.isActive()) nock.restore();

  // Start recording
  nock.recorder.rec({
    output_objects: true,
    dont_print: true,
    enable_reqheaders_recording: true
  });

  let result = null;
  let error = null;

  try {
    result = await script.invoke(params, context);
  } catch (err) {
    error = err;
    // If the script has an error handler, call it
    if (script.error) {
      try {
        result = await script.error({ ...params, error: err }, context);
      } catch {
        // error handler also threw — that's fine, we still have the original error
      }
    }
  }

  const recordings = nock.recorder.play();
  nock.recorder.clear();

  // nock.restore() stops the recorder and unpatches http/https.
  // Must always call it so the next recordRun() can call rec() again.
  nock.restore();
  nock.cleanAll();
  nock.enableNetConnect();

  return { result, error, recordings };
}

/**
 * Build a single scenario YAML entry from recordings.
 * @param {Object} run - { name, params } scenario entry
 * @param {string} slug - filename slug
 * @param {Array} recordings - nock recordings
 * @param {{ result: any, error: Error|null }} outcome
 * @returns {Object} scenario entry for YAML
 */
export function buildScenario(run, slug, recordings, outcome) {
  const invokeExpectation = buildInvokeExpectation(outcome);
  const scenario = { name: run.name };

  if (recordings.length === 0) {
    // No HTTP calls — e.g. threw before fetch
    scenario.steps = [];
    Object.assign(scenario, invokeExpectation);
    return scenario;
  }

  if (recordings.length === 1) {
    // Single HTTP call → shorthand format
    const rec = recordings[0];
    const fixtureName = fixtureFilename(slug, 1, 1);
    scenario.request = {
      method: rec.method,
      url: buildRequestUrl(rec.scope, rec.path)
    };
    scenario.fixture = `fixtures/${fixtureName}`;
    Object.assign(scenario, invokeExpectation);
    return scenario;
  }

  // Multiple HTTP calls → steps format
  const total = recordings.length;
  scenario.steps = recordings.map((rec, i) => {
    const fixtureName = fixtureFilename(slug, i + 1, total);
    return {
      request: {
        method: rec.method,
        url: buildRequestUrl(rec.scope, rec.path)
      },
      fixture: `fixtures/${fixtureName}`
    };
  });
  Object.assign(scenario, invokeExpectation);
  return scenario;
}

/**
 * Build invoke.returns or invoke.throws from the run outcome.
 * @param {{ result: any, error: Error|null }} outcome
 * @returns {{ invoke: Object }}
 */
export function buildInvokeExpectation(outcome) {
  if (outcome.error) {
    return { invoke: { throws: outcome.error.message } };
  }
  if (outcome.result && typeof outcome.result === 'object') {
    return { invoke: { returns: outcome.result } };
  }
  return { invoke: { returns: outcome.result ?? {} } };
}

/**
 * Map common HTTP status codes to reason phrases.
 */
function statusTextFromCode(code) {
  const map = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway',
    503: 'Service Unavailable', 504: 'Gateway Timeout'
  };
  return map[code] || 'Unknown';
}

// ── Main ─────────────────────────────────────────────────────────────

const DEFAULT_SCRIPT = './src/script.mjs';

async function main() {
  const cwd = process.cwd();
  const scenariosPath = join(cwd, 'tests', 'scenarios.yaml');

  // 1. Read + validate tests/scenarios.yaml
  if (!existsSync(scenariosPath)) {
    process.stderr.write('Error: tests/scenarios.yaml not found.\n');
    process.stderr.write('Run npx sgnl-test-init to generate one, then add "record: true" to scenarios you want to record.\n');
    process.exit(1);
  }

  const raw = readFileSync(scenariosPath, 'utf-8');
  const doc = yaml.load(raw);

  if (!doc.scenarios || !Array.isArray(doc.scenarios)) {
    process.stderr.write('Error: tests/scenarios.yaml must have a "scenarios" array.\n');
    process.exit(1);
  }

  // Filter scenarios marked for recording
  const recordableIndices = [];
  for (let i = 0; i < doc.scenarios.length; i++) {
    if (doc.scenarios[i].record === true) {
      recordableIndices.push(i);
    }
  }

  if (recordableIndices.length === 0) {
    process.stderr.write('Error: no scenarios have "record: true". Add "record: true" to scenarios you want to record.\n');
    process.exit(1);
  }

  // 2. Dynamic import the script module (default: ./src/script.mjs)
  const scriptField = doc.script || DEFAULT_SCRIPT;
  const scriptPath = resolve(cwd, scriptField);
  const scriptUrl = pathToFileURL(scriptPath).href;
  const mod = await import(scriptUrl);
  const script = mod.default || mod;

  if (typeof script.invoke !== 'function') {
    process.stderr.write('Error: script module must export an invoke() function.\n');
    process.exit(1);
  }

  const actionParams = doc.action?.params ?? {};
  const actionContext = doc.action?.context ?? {};
  const fixturesDir = join(cwd, 'tests', 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });

  const createdFixtures = [];
  const recordedScenarios = [];

  // 3. For each recordable scenario: record HTTP traffic + fill in data
  for (const idx of recordableIndices) {
    const scenario = doc.scenarios[idx];
    const slug = slugify(scenario.name);
    const params = { ...actionParams, ...(scenario.params ?? {}) };

    const context = {
      ...actionContext,
      secrets: { ...(actionContext.secrets ?? {}), ...(scenario.context?.secrets ?? {}) },
      environment: { ...(actionContext.environment ?? {}), ...(scenario.context?.environment ?? {}) }
    };

    console.log(`\n  Recording: ${scenario.name}`);

    const { result, error, recordings } = await recordRun(script, params, context);

    if (error) {
      console.log(`    Result: threw "${error.message}"`);
    } else {
      console.log(`    Result: returned ${JSON.stringify(result)}`);
    }
    console.log(`    HTTP calls captured: ${recordings.length}`);

    // Write .http fixtures
    const totalSteps = recordings.length;
    for (let i = 0; i < recordings.length; i++) {
      const rec = recordings[i];
      const fname = fixtureFilename(slug, i + 1, totalSteps);
      const fpath = join(fixturesDir, fname);
      const content = buildFixtureContent(rec);
      writeFileSync(fpath, content);
      createdFixtures.push(`fixtures/${fname}`);
    }

    // Build recorded data from recordings
    const recorded = buildScenario(scenario, slug, recordings, { result, error });

    // Update scenario in-place: preserve name/params/context overrides, fill in recorded data, remove record flag
    const updated = { name: scenario.name };
    if (scenario.params) updated.params = scenario.params;
    if (scenario.context) updated.context = scenario.context;
    // Copy request/fixture or steps from recorded data
    if (recorded.request) updated.request = recorded.request;
    if (recorded.fixture) updated.fixture = recorded.fixture;
    if (recorded.steps) updated.steps = recorded.steps;
    if (recorded.invoke) updated.invoke = recorded.invoke;

    recordedScenarios.push({ idx, updated });
  }

  // 4. Splice recorded scenarios into raw YAML — preserves everything else byte-for-byte
  const blocks = locateScenarioBlocks(raw);
  // Apply replacements from last to first so offsets stay valid
  let output = raw;
  for (let i = recordedScenarios.length - 1; i >= 0; i--) {
    const { idx, updated } = recordedScenarios[i];
    const block = blocks[idx];
    const replacement = serializeScenarioBlock(updated);
    output = output.slice(0, block.start) + replacement + output.slice(block.end);
  }
  writeFileSync(scenariosPath, output);

  // 5. Print summary
  console.log(`\n  Scenarios recorded: ${recordableIndices.length}`);
  console.log(`  Fixtures created: ${createdFixtures.length}`);
  for (const f of createdFixtures) {
    console.log(`    ${f}`);
  }

  console.log(`
Next steps:
  1. Review tests/scenarios.yaml:
     - Verify the recorded request URLs and methods are correct
     - Check invoke.returns / invoke.throws match expectations
     - Redact any real secrets in action.context.secrets and URLs before committing
  2. Review tests/fixtures/*.http:
     - Remove any sensitive data from response headers and bodies
  3. Run: npm test
`);
}

// Only run main() when this file is the entry point (not when imported for tests).
// Use realpathSync to resolve symlinks (e.g. node_modules/.bin/sgnl-test-record).
const isEntryPoint = process.argv[1] &&
  pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;

if (isEntryPoint) {
  main().then(() => {
    process.exit(0);
  }).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
