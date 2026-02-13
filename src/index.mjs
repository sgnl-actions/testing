import { resolve, dirname } from 'path';
import nock from 'nock';
import { parseFixture } from './parse-fixture.mjs';
import { parseScenarios } from './parse-scenarios.mjs';
import { setupNock, cleanupNock } from './setup-nock.mjs';
import { runScenarioHandlers } from './assertions.mjs';

/**
 * Merge scenario-level overrides with action-level defaults.
 * Scenario params/context override action-level values (shallow merge per section).
 */
function mergeDefaults(action, scenario) {
  const params = { ...action.params, ...(scenario.params || {}) };

  const actionContext = action.context || {};
  const scenarioContext = scenario.context || {};

  const context = {
    ...actionContext,
    ...scenarioContext,
    secrets: { ...(actionContext.secrets || {}), ...(scenarioContext.secrets || {}) },
    environment: { ...(actionContext.environment || {}), ...(scenarioContext.environment || {}) }
  };

  return { params, context };
}

/**
 * Resolve fixture data for each step in a scenario.
 * Steps may have:
 *   - fixture: path to .http file (relative to scenarios.yaml dir)
 *   - fixtureData: already parsed { statusCode, headers, body }
 *   - networkError: true (no fixture needed)
 */
function resolveStepFixtures(steps, scenariosDir) {
  return steps.map(step => {
    // Already has fixtureData or networkError — nothing to resolve
    if (step.fixtureData || step.networkError) {
      return step;
    }

    if (!step.fixture) {
      throw new Error(
        `Step for ${step.request.method} ${step.request.url} has no fixture, fixtureData, or networkError`
      );
    }

    const fixtureData = parseFixture(step.fixture, scenariosDir);
    return { ...step, fixtureData };
  });
}

/**
 * Run all scenarios from a YAML file against an action script.
 *
 * Usage in a test file:
 *   import { runScenarios } from '@sgnl-actions/testing';
 *   runScenarios({
 *     script: '../src/script.mjs',
 *     scenarios: './scenarios.yaml'
 *   });
 *
 * @param {Object} options
 * @param {string|Object} options.script - Path to the action module (relative to test file) or the module itself
 * @param {string} options.scenarios - Path to scenarios.yaml (relative to test file)
 * @param {boolean} [options.includeCommon=true] - Whether to include common error scenarios
 * @param {string} [options.callerDir] - Directory to resolve relative paths from (auto-detected if not provided)
 */
export function runScenarios(options) {
  const {
    script: scriptPathOrModule,
    scenarios: scenariosPath,
    includeCommon = true,
    callerDir
  } = options;

  // Resolve the caller directory for relative paths
  // In Jest, tests run from the project root, so we need the test file's directory
  const baseDir = callerDir || process.cwd();
  const resolvedScenariosPath = resolve(baseDir, scenariosPath);
  const scenariosDir = dirname(resolvedScenariosPath);

  // Parse scenarios
  const { action, scenarios } = parseScenarios(resolvedScenariosPath, { includeCommon });

  // Resolve the script - either import it or use the provided module
  let scriptModule;
  let scriptPromise;

  if (typeof scriptPathOrModule === 'string') {
    const resolvedScriptPath = resolve(baseDir, scriptPathOrModule);
    // Dynamic import returns a promise — we'll resolve it in beforeAll
    scriptPromise = import(resolvedScriptPath);
  } else {
    // Module object provided directly
    scriptModule = scriptPathOrModule;
  }

  describe(`scenarios: ${scenarios.length} defined`, () => {
    let script;

    beforeAll(async () => {
      if (scriptPromise) {
        const mod = await scriptPromise;
        script = mod.default || mod;
      } else {
        script = scriptModule;
      }
    });

    afterEach(() => {
      cleanupNock();
    });

    for (const scenario of scenarios) {
      test(scenario.name, async () => {
        // Merge action defaults with scenario overrides
        const { params, context } = mergeDefaults(action, scenario);

        // Resolve fixtures for each step
        const resolvedSteps = resolveStepFixtures(scenario.steps, scenariosDir);

        // Block real network calls
        nock.disableNetConnect();

        // Set up nock interceptors
        const scopes = setupNock(resolvedSteps);

        // Suppress console output during scenario execution
        const origLog = console.log;
        const origError = console.error;
        console.log = () => {};
        console.error = () => {};

        try {
          // Run the handlers and assert results
          await runScenarioHandlers(script, params, context, scenario);

          // Verify all expected HTTP requests were made
          for (const scope of scopes) {
            scope.done();
          }
        } finally {
          console.log = origLog;
          console.error = origError;
        }
      });
    }
  });
}

// Re-export all sub-modules for direct use
export { parseFixture, parseFixtureString } from './parse-fixture.mjs';
export { parseScenarios, parseScenariosString, COMMON_SCENARIOS } from './parse-scenarios.mjs';
export { setupNock, cleanupNock } from './setup-nock.mjs';
export {
  assertInvokeReturns,
  assertInvokeThrows,
  assertErrorReturns,
  assertErrorThrows,
  runScenarioHandlers
} from './assertions.mjs';
