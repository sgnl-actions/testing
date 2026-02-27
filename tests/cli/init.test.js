import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';

const CLI_PATH = join(import.meta.dirname, '..', '..', 'src', 'cli', 'init.mjs');

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'sgnl-test-init-'));
}

function writeMetadata(dir, content) {
  writeFileSync(join(dir, 'metadata.yaml'), content);
}

function runCli(cwd) {
  return execFileSync('node', [CLI_PATH], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' }
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

describe('sgnl-test-init CLI', () => {
  describe('when metadata.yaml is missing', () => {
    it('exits with code 1 and prints error to stderr', () => {
      const dir = createTempDir();
      const result = runCliExpectError(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('metadata.yaml');
    });
  });

  describe('with valid metadata.yaml', () => {
    let dir;
    let output;

    beforeAll(() => {
      dir = createTempDir();
      writeMetadata(dir, [
        'name: okta-suspend-user',
        'inputs:',
        '  userId:',
        '    type: text',
        '    required: true',
        '  address:',
        '    type: text',
        '    required: false'
      ].join('\n'));
      output = runCli(dir);
    });

    it('creates tests/scenarios.yaml', () => {
      expect(existsSync(join(dir, 'tests', 'scenarios.yaml'))).toBe(true);
    });

    it('scenarios.yaml is valid YAML with expected structure', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action).toBeDefined();
      expect(parsed.action.params.userId).toBe('test-user-123');
      expect(parsed.scenarios).toHaveLength(1);
    });

    it('scenarios.yaml includes address in params', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action.params.address).toBe('test-address');
    });

    it('scenarios.yaml scenario has record: true', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.scenarios[0].record).toBe(true);
    });

    it('prints action name in output', () => {
      expect(output).toContain('okta-suspend-user');
    });

    it('prints Created line for scenarios.yaml', () => {
      expect(output).toContain('Created: tests/scenarios.yaml');
    });

    it('prints next-steps instructions mentioning record: true workflow', () => {
      expect(output).toContain('Next steps');
      expect(output).toContain('runScenarios');
      expect(output).toContain('./src/script.mjs');
      expect(output).toContain('./tests/scenarios.yaml');
      expect(output).toContain('npm test');
      expect(output).toContain('sgnl-test-record');
    });
  });

  describe('when files already exist', () => {
    let dir;
    let output;

    beforeAll(() => {
      dir = createTempDir();
      writeMetadata(dir, [
        'name: okta-suspend-user',
        'inputs:',
        '  userId:',
        '    type: text',
        '    required: true'
      ].join('\n'));

      // Pre-create the file
      mkdirSync(join(dir, 'tests'), { recursive: true });
      writeFileSync(join(dir, 'tests', 'scenarios.yaml'), 'existing content');

      output = runCli(dir);
    });

    it('does not overwrite existing scenarios.yaml', () => {
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      expect(content).toBe('existing content');
    });

    it('prints skip warning', () => {
      expect(output).toContain('Skipped');
      expect(output).toContain('scenarios.yaml');
    });
  });

  describe('with multi-input metadata', () => {
    it('generates params for all inputs', () => {
      const dir = createTempDir();
      writeMetadata(dir, [
        'name: okta-create-user',
        'inputs:',
        '  email:',
        '    type: text',
        '    required: true',
        '  firstName:',
        '    type: text',
        '    required: true',
        '  lastName:',
        '    type: text',
        '    required: true',
        '  count:',
        '    type: number',
        '    required: false',
        '  address:',
        '    type: text',
        '    required: false'
      ].join('\n'));

      runCli(dir);
      const content = readFileSync(join(dir, 'tests', 'scenarios.yaml'), 'utf-8');
      const parsed = yaml.load(content);
      expect(parsed.action.params.email).toBe('user@example.com');
      expect(parsed.action.params.firstName).toBe('Test');
      expect(parsed.action.params.lastName).toBe('User');
      expect(parsed.action.params.count).toBe(42);
      expect(parsed.action.params.address).toBe('test-address');
    });
  });
});
