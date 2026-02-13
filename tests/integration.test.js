import { jest } from '@jest/globals';
import { runScenarios } from '../src/index.mjs';
import { join } from 'path';

const fixturesDir = join(import.meta.dirname, '..', 'fixtures');

// ---- Sample Action: single-request scenarios ----
describe('Sample Action (single-request scenarios)', () => {
  runScenarios({
    script: join(fixturesDir, 'sample-action', 'src', 'script.mjs'),
    scenarios: join(fixturesDir, 'sample-action', 'tests', 'scenarios.yaml'),
    includeCommon: false,
    callerDir: '/'
  });
});

// ---- Multi-Step Action ----
describe('Multi-Step Action (multi-request scenarios)', () => {
  runScenarios({
    script: join(fixturesDir, 'multi-step-action', 'src', 'script.mjs'),
    scenarios: join(fixturesDir, 'multi-step-action', 'tests', 'scenarios.yaml'),
    includeCommon: false,
    callerDir: '/'
  });
});

// ---- Sample Action with common scenarios ----
describe('Sample Action (with common scenarios)', () => {
  runScenarios({
    script: join(fixturesDir, 'sample-action', 'src', 'script.mjs'),
    scenarios: join(fixturesDir, 'sample-action', 'tests', 'scenarios.yaml'),
    includeCommon: true,
    callerDir: '/'
  });
});

// ---- Direct module object (no file path) ----
describe('Direct module object', () => {
  const mockScript = {
    invoke: async (params, context) => {
      const response = await fetch(`https://api.example.com/users/${params.userId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return { userId: params.userId, name: data.name };
    }
  };

  runScenarios({
    script: mockScript,
    scenarios: join(fixturesDir, 'inline-action', 'tests', 'scenarios.yaml'),
    includeCommon: false,
    callerDir: '/'
  });
});
