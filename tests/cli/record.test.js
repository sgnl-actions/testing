import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync, execFile } from 'child_process';
import { createServer } from 'http';
import yaml from 'js-yaml';

import {
  slugify,
  hostnameFromScope,
  buildRequestUrl,
  rawHeadersToLines,
  buildFixtureContent,
  fixtureFilename,
  sanitizeSecrets,
  buildInvokeExpectation
} from '../../src/cli/record.mjs';

const CLI_PATH = join(import.meta.dirname, '..', '..', 'src', 'cli', 'record.mjs');

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'sgnl-test-record-'));
}

/**
 * Write a script.mjs into the standard location (src/script.mjs)
 * so the CLI finds it at the default path.
 */
function writeScript(dir, content) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'script.mjs'), content);
}

/**
 * Write tests/scenarios.yaml with record: true scenarios.
 */
function writeScenariosYaml(dir, content) {
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'scenarios.yaml'), typeof content === 'string' ? content : yaml.dump(content));
}

/**
 * Run CLI asynchronously — required when a local HTTP server in the same
 * process must respond to requests from the child process.
 * (execFileSync would deadlock because it blocks the event loop.)
 */
function runCliAsync(cwd) {
  return new Promise((resolve, reject) => {
    execFile('node', [CLI_PATH], {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, NO_COLOR: '1' }
    }, (err, stdout, stderr) => {
      if (err) {
        const error = new Error(`CLI exited with code ${err.code}: ${stderr}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.status = err.code;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function runCliExpectError(cwd) {
  try {
    execFileSync('node', [CLI_PATH], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    });
    throw new Error('Expected CLI to exit with error');
  } catch (err) {
    if (err.message === 'Expected CLI to exit with error') throw err;
    return { stderr: err.stderr, status: err.status };
  }
}

/**
 * Start a local HTTP server that returns JSON responses.
 * Routes: POST /events → 200, POST /fail → 500
 */
function startTestServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (req.url === '/events') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'accepted', id: 'evt-123' }));
        } else if (req.url === '/fail') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, base: `http://127.0.0.1:${port}` });
    });
  });
}

// ── Unit tests for helpers ──────────────────────────────────────────

describe('record helpers', () => {
  describe('slugify', () => {
    it('converts spaces and special chars to hyphens', () => {
      expect(slugify('successfully transmits event')).toBe('successfully-transmits-event');
    });

    it('removes leading/trailing hyphens', () => {
      expect(slugify('--hello--')).toBe('hello');
    });

    it('lowercases', () => {
      expect(slugify('My Test Case')).toBe('my-test-case');
    });
  });

  describe('hostnameFromScope', () => {
    it('extracts hostname from HTTPS URL with port', () => {
      expect(hostnameFromScope('https://crypto-sgnl.svc:443')).toBe('crypto-sgnl.svc');
    });

    it('extracts hostname from HTTP URL', () => {
      expect(hostnameFromScope('http://localhost:3000')).toBe('localhost');
    });

    it('returns input on invalid URL', () => {
      expect(hostnameFromScope('not-a-url')).toBe('not-a-url');
    });
  });

  describe('buildRequestUrl', () => {
    it('drops default HTTPS port 443', () => {
      expect(buildRequestUrl('https://api.example.com:443', '/events'))
        .toBe('https://api.example.com/events');
    });

    it('drops default HTTP port 80', () => {
      expect(buildRequestUrl('http://api.example.com:80', '/events'))
        .toBe('http://api.example.com/events');
    });

    it('keeps non-default ports', () => {
      expect(buildRequestUrl('http://localhost:3000', '/events'))
        .toBe('http://localhost:3000/events');
    });
  });

  describe('rawHeadersToLines', () => {
    it('pairs up flat array into Key: Value lines', () => {
      const lines = rawHeadersToLines(['Content-Type', 'application/json', 'X-Req-Id', '42']);
      expect(lines).toEqual(['Content-Type: application/json', 'X-Req-Id: 42']);
    });

    it('handles empty array', () => {
      expect(rawHeadersToLines([])).toEqual([]);
    });
  });

  describe('buildFixtureContent', () => {
    it('builds HTTP response with JSON body', () => {
      const content = buildFixtureContent({
        status: 200,
        rawHeaders: ['Content-Type', 'application/json'],
        response: { ok: true }
      });
      expect(content).toContain('HTTP/1.1 200 OK');
      expect(content).toContain('Content-Type: application/json');
      expect(content).toContain('{"ok":true}');
    });

    it('handles string response body', () => {
      const content = buildFixtureContent({
        status: 201,
        rawHeaders: [],
        response: 'plain text'
      });
      expect(content).toContain('HTTP/1.1 201 Created');
      expect(content).toContain('plain text');
    });

    it('falls back to headers object when rawHeaders missing', () => {
      const content = buildFixtureContent({
        status: 200,
        headers: { 'X-Custom': 'value' },
        response: '{}'
      });
      expect(content).toContain('X-Custom: value');
    });
  });

  describe('fixtureFilename', () => {
    it('single-step scenario uses just slug', () => {
      expect(fixtureFilename('success', 1, 1))
        .toBe('success.http');
    });

    it('multi-step scenario includes step number', () => {
      expect(fixtureFilename('test', 2, 3))
        .toBe('test-step2.http');
    });

    it('multi-step first step', () => {
      expect(fixtureFilename('transmit', 1, 2))
        .toBe('transmit-step1.http');
    });
  });

  describe('sanitizeSecrets', () => {
    it('replaces all values with REDACTED', () => {
      expect(sanitizeSecrets({ TOKEN: 'real', KEY: 'secret' }))
        .toEqual({ TOKEN: 'REDACTED', KEY: 'REDACTED' });
    });

    it('handles null/undefined', () => {
      expect(sanitizeSecrets(null)).toEqual({});
      expect(sanitizeSecrets(undefined)).toEqual({});
    });
  });

  describe('buildInvokeExpectation', () => {
    it('returns invoke.returns for successful result', () => {
      expect(buildInvokeExpectation({ result: { status: 'ok' }, error: null }))
        .toEqual({ invoke: { returns: { status: 'ok' } } });
    });

    it('returns invoke.throws for error', () => {
      expect(buildInvokeExpectation({ result: null, error: new Error('boom') }))
        .toEqual({ invoke: { throws: 'boom' } });
    });

    it('returns empty object for null result', () => {
      expect(buildInvokeExpectation({ result: null, error: null }))
        .toEqual({ invoke: { returns: {} } });
    });
  });
});

// ── CLI integration tests ───────────────────────────────────────────

describe('sgnl-test-record CLI', () => {
  describe('when tests/scenarios.yaml is missing', () => {
    it('exits with code 1 and prints error to stderr', () => {
      const dir = createTempDir();
      const result = runCliExpectError(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('scenarios.yaml');
    });

    it('hints to run sgnl-test-init', () => {
      const dir = createTempDir();
      const result = runCliExpectError(dir);
      expect(result.stderr).toContain('sgnl-test-init');
    });
  });

  describe('when no scenarios have record: true', () => {
    it('exits with code 1', () => {
      const dir = createTempDir();
      writeScenariosYaml(dir, {
        action: { params: {} },
        scenarios: [
          {
            name: 'existing scenario',
            request: { method: 'GET', url: 'https://example.com' },
            fixture: 'fixtures/200.http',
            invoke: { returns: {} }
          }
        ]
      });
      const result = runCliExpectError(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('record: true');
    });
  });

  describe('defaults script to ./src/script.mjs', () => {
    let testServer;
    let dir;

    beforeAll(async () => {
      testServer = await startTestServer();
      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          const data = await res.json();
          return { status: data.status };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          context: { environment: { ADDRESS: testServer.base } }
        },
        scenarios: [
          { name: 'default script test', record: true }
        ]
      });

      await runCliAsync(dir);
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('finds and uses ./src/script.mjs without explicit script field', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios).toHaveLength(1);
      expect(parsed.scenarios[0].name).toBe('default script test');
    });
  });

  describe('with a single-call action against local server', () => {
    let testServer;
    let dir;
    let output;

    beforeAll(async () => {
      testServer = await startTestServer();

      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: params.subject })
          });
          const data = await res.json();
          return { status: data.status };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          context: {
            secrets: { API_TOKEN: 'real-secret-token' },
            environment: { ADDRESS: testServer.base }
          }
        },
        scenarios: [
          {
            name: 'successfully transmits event',
            record: true,
            params: { subject: '{"format":"email","email":"user@example.com"}' }
          }
        ]
      });

      const result = await runCliAsync(dir);
      output = result.stdout;
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('updates tests/scenarios.yaml in-place', () => {
      expect(existsSync(join(dir, 'tests', 'scenarios.yaml'))).toBe(true);
    });

    it('scenarios.yaml is valid YAML with expected structure', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action).toBeDefined();
      expect(parsed.scenarios).toHaveLength(1);
      expect(parsed.scenarios[0].name).toBe('successfully transmits event');
    });

    it('scenario has shorthand request format (single HTTP call)', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.request).toBeDefined();
      expect(scenario.request.method).toBe('POST');
      expect(scenario.request.url).toContain('/events');
      expect(scenario.steps).toBeUndefined();
    });

    it('scenario has invoke.returns with recorded result', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.invoke.returns).toEqual({ status: 'accepted' });
    });

    it('scenario has fixture path', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.fixture).toMatch(/^fixtures\/.*\.http$/);
    });

    it('creates fixture .http file', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const fixturePath = join(dir, 'tests', parsed.scenarios[0].fixture);
      expect(existsSync(fixturePath)).toBe(true);
    });

    it('fixture contains valid HTTP response', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const fixturePath = join(dir, 'tests', parsed.scenarios[0].fixture);
      const fixture = readFileSync(fixturePath, 'utf-8');
      expect(fixture).toContain('HTTP/1.1 200 OK');
      expect(fixture).toContain('application/json');
    });

    it('does NOT auto-redact secrets in scenarios.yaml', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action.context.secrets.API_TOKEN).toBe('real-secret-token');
    });

    it('record: true is removed after recording', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[0].record).toBeUndefined();
    });

    it('preserves per-scenario params override', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[0].params.subject).toBe('{"format":"email","email":"user@example.com"}');
    });

    it('prints recording summary', () => {
      expect(output).toContain('Recording: successfully transmits event');
      expect(output).toContain('HTTP calls captured: 1');
    });

    it('prints next-steps instructions', () => {
      expect(output).toContain('Next steps');
      expect(output).toContain('npm test');
    });
  });

  describe('with an action that throws before making HTTP calls', () => {
    let dir;

    beforeAll(async () => {
      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          JSON.parse(params.subject);
          return { status: 'success' };
        }
      `);

      writeScenariosYaml(dir, {
        action: { params: {} },
        scenarios: [
          {
            name: 'rejects invalid subject JSON',
            record: true,
            params: { subject: 'not valid json' }
          }
        ]
      });

      // No server needed — script throws before fetch.
      execFileSync('node', [CLI_PATH], {
        cwd: dir, encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' }
      });
    });

    it('creates scenario with steps: [] for zero HTTP calls', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.steps).toEqual([]);
    });

    it('scenario has invoke.throws', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.invoke.throws).toBeDefined();
      expect(typeof scenario.invoke.throws).toBe('string');
    });

    it('record: true is removed', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[0].record).toBeUndefined();
    });
  });

  describe('with a multi-call action', () => {
    let testServer;
    let dir;

    beforeAll(async () => {
      testServer = await startTestServer();
      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const base = context.environment.ADDRESS;

          const cryptoRes = await fetch(base + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sign' })
          });
          const cryptoData = await cryptoRes.json();

          const receiveRes = await fetch(base + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signed: cryptoData.id })
          });
          const receiveData = await receiveRes.json();

          return { status: receiveData.status };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          context: {
            environment: { ADDRESS: testServer.base }
          }
        },
        scenarios: [
          {
            name: 'multi step success',
            record: true,
            params: { subject: 'test' }
          }
        ]
      });

      await runCliAsync(dir);
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('creates scenario with steps array for multiple HTTP calls', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.steps).toBeDefined();
      expect(scenario.steps).toHaveLength(2);
      expect(scenario.request).toBeUndefined();
    });

    it('each step has request and fixture', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const steps = parsed.scenarios[0].steps;
      for (const step of steps) {
        expect(step.request.method).toBe('POST');
        expect(step.request.url).toContain('/events');
        expect(step.fixture).toMatch(/^fixtures\/.*\.http$/);
      }
    });

    it('creates fixture files for each step', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const steps = parsed.scenarios[0].steps;
      for (const step of steps) {
        const fpath = join(dir, 'tests', step.fixture);
        expect(existsSync(fpath)).toBe(true);
      }
    });

    it('fixture step indices increment', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const steps = parsed.scenarios[0].steps;
      expect(steps[0].fixture).toContain('step1');
      expect(steps[1].fixture).toContain('step2');
    });
  });

  describe('non-recordable scenarios preserved', () => {
    let testServer;

    beforeAll(async () => {
      testServer = await startTestServer();
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('preserves scenarios without record: true unchanged', async () => {
      const dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          const data = await res.json();
          return { status: data.status };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          context: {
            environment: { ADDRESS: testServer.base }
          }
        },
        scenarios: [
          {
            name: 'existing scenario',
            request: { method: 'GET', url: 'https://example.com/old' },
            fixture: 'fixtures/old.http',
            invoke: { returns: { old: true } }
          },
          {
            name: 'will be recorded',
            record: true
          },
          {
            name: 'another existing',
            request: { method: 'POST', url: 'https://example.com/keep' },
            fixture: 'fixtures/keep.http',
            invoke: { returns: { kept: true } }
          }
        ]
      });

      await runCliAsync(dir);

      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);

      expect(parsed.scenarios).toHaveLength(3);

      // Existing scenario preserved at original position
      expect(parsed.scenarios[0].name).toBe('existing scenario');
      expect(parsed.scenarios[0].invoke.returns.old).toBe(true);

      // Recorded scenario filled in
      expect(parsed.scenarios[1].name).toBe('will be recorded');
      expect(parsed.scenarios[1].record).toBeUndefined();
      expect(parsed.scenarios[1].invoke).toBeDefined();

      // Another existing scenario preserved at original position
      expect(parsed.scenarios[2].name).toBe('another existing');
      expect(parsed.scenarios[2].invoke.returns.kept).toBe(true);
    });

    it('preserves action section unchanged', async () => {
      const dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          const data = await res.json();
          return { status: data.status };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          params: { userId: 'test-123' },
          context: {
            secrets: { OLD_TOKEN: 'my-secret' },
            environment: { ADDRESS: testServer.base }
          }
        },
        scenarios: [
          { name: 'new run', record: true }
        ]
      });

      await runCliAsync(dir);

      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action.params.userId).toBe('test-123');
      expect(parsed.action.context.secrets.OLD_TOKEN).toBe('my-secret');
    });

    it('preserves raw YAML formatting outside recorded scenarios (no re-serialization)', async () => {
      const dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          const data = await res.json();
          return { status: data.status };
        }
      `);

      // Write raw YAML with JSON-string params that yaml.dump would mangle
      const rawYaml = [
        'action:',
        '  params:',
        '    subject: \'{"format": "email", "email": "alice@example.com"}\'',
        '  context:',
        '    secrets:',
        '      BEARER_AUTH_TOKEN: real-token',
        '    environment:',
        `      ADDRESS: ${testServer.base}`,
        '',
        'scenarios:',
        '  - name: already recorded',
        '    request:',
        '      method: POST',
        '      url: https://example.com/events',
        '    fixture: fixtures/200-ok.http',
        '    invoke:',
        '      returns:',
        '        status: ok',
        '  - name: needs recording',
        '    record: true',
        ''
      ].join('\n');

      mkdirSync(join(dir, 'tests'), { recursive: true });
      writeFileSync(join(dir, 'tests', 'scenarios.yaml'), rawYaml);

      await runCliAsync(dir);

      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');

      // The action section and first scenario must be byte-for-byte identical
      expect(content).toContain('subject: \'{"format": "email", "email": "alice@example.com"}\'');
      expect(content).toContain('BEARER_AUTH_TOKEN: real-token');
      expect(content).toContain('name: already recorded');

      // The recorded scenario should be filled in
      const parsed = yaml.load(content);
      expect(parsed.scenarios[1].name).toBe('needs recording');
      expect(parsed.scenarios[1].record).toBeUndefined();
      expect(parsed.scenarios[1].invoke).toBeDefined();
    });
  });

  describe('with an action using context.crypto', () => {
    let testServer;
    let dir;

    beforeAll(async () => {
      testServer = await startTestServer();
      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const jwt = await context.crypto.signJWT(
            { sub: params.subject },
            { expiresIn: '5m' }
          );

          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + jwt,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ subject: params.subject })
          });
          const data = await res.json();
          return { status: data.status, jwt };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          context: {
            secrets: { TOKEN: 'real-secret' },
            environment: { ADDRESS: testServer.base },
            crypto: {
              signJWT: { returns: 'recorded.mock.jwt' }
            }
          }
        },
        scenarios: [
          {
            name: 'transmits with signed JWT',
            record: true,
            params: { subject: 'user@example.com' }
          }
        ]
      });

      await runCliAsync(dir);
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('action receives working crypto mock during recording', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      // The action returned the mock JWT value, proving signJWT() worked
      expect(scenario.invoke.returns.jwt).toBe('recorded.mock.jwt');
      expect(scenario.invoke.returns.status).toBe('accepted');
    });

    it('preserves crypto declarations in scenarios.yaml', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action.context.crypto).toEqual({
        signJWT: { returns: 'recorded.mock.jwt' }
      });
    });

    it('does NOT redact secrets in scenarios.yaml', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action.context.secrets.TOKEN).toBe('real-secret');
    });
  });

  describe('with action-level params', () => {
    let testServer;
    let dir;

    beforeAll(async () => {
      testServer = await startTestServer();
      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: params.subject, mode: params.mode })
          });
          const data = await res.json();
          return { status: data.status, subject: params.subject, mode: params.mode };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          params: { subject: 'default-subject', mode: 'normal' },
          context: {
            environment: { ADDRESS: testServer.base }
          }
        },
        scenarios: [
          {
            name: 'inherits all params',
            record: true
          },
          {
            name: 'overrides one param',
            record: true,
            params: { mode: 'turbo' }
          }
        ]
      });

      await runCliAsync(dir);
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('scenario with no params inherits action-level defaults', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[0];
      expect(scenario.invoke.returns.subject).toBe('default-subject');
      expect(scenario.invoke.returns.mode).toBe('normal');
    });

    it('scenario with partial params overrides only specified keys', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      const scenario = parsed.scenarios[1];
      expect(scenario.invoke.returns.subject).toBe('default-subject');
      expect(scenario.invoke.returns.mode).toBe('turbo');
    });

    it('preserves per-scenario params override in output', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[1].params).toEqual({ mode: 'turbo' });
    });
  });

  describe('with multiple record: true scenarios', () => {
    let testServer;
    let dir;

    beforeAll(async () => {
      testServer = await startTestServer();
      dir = createTempDir();

      writeScript(dir, `
        export async function invoke(params, context) {
          if (params.shouldFail) {
            throw new Error('forced failure');
          }
          const res = await fetch(context.environment.ADDRESS + '/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: params.subject })
          });
          const data = await res.json();
          return { status: data.status };
        }
      `);

      writeScenariosYaml(dir, {
        action: {
          context: {
            secrets: { TOKEN: 'my-secret' },
            environment: { ADDRESS: testServer.base }
          }
        },
        scenarios: [
          {
            name: 'success case',
            record: true,
            params: { subject: 'test', shouldFail: false }
          },
          {
            name: 'failure case',
            record: true,
            params: { shouldFail: true }
          }
        ]
      });

      await runCliAsync(dir);
    });

    afterAll(() => {
      testServer.server.close();
    });

    it('records all scenarios', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios).toHaveLength(2);
      expect(parsed.scenarios[0].name).toBe('success case');
      expect(parsed.scenarios[1].name).toBe('failure case');
    });

    it('success scenario has invoke.returns', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[0].invoke.returns).toBeDefined();
    });

    it('failure scenario has invoke.throws', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[1].invoke.throws).toBe('forced failure');
    });

    it('record: true removed from all scenarios', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      for (const scenario of parsed.scenarios) {
        expect(scenario.record).toBeUndefined();
      }
    });
  });
});
