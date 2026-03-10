import { parseLDAPFixture, parseLDAPScenarios } from './setup-ldap.mjs';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve, dirname } from 'path';
import { jest } from '@jest/globals';

/**
 * Check if scenario steps contain LDAP operations
 */
function hasLDAPSteps(steps) {
  return steps && steps.some(step => step.ldap);
}

/**
 * Resolve LDAP fixture data for steps in a scenario.
 */
function resolveLDAPFixtures(steps, scenariosDir) {
  return steps.map(step => {
    if (!step.ldap || !step.fixture) {
      return step;
    }

    const fixtureData = parseLDAPFixture(step.fixture, scenariosDir);
    return { ...step, fixtureData };
  });
}

/**
 * Merge scenario-level overrides with action-level defaults.
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
 * Run LDAP scenarios for AD actions - simple interface like runScenarios
 * 
 * Usage:
 * ```javascript
 * import { runLDAPScenarios } from '@sgnl-actions/testing/ldap-scenarios';
 * 
 * runLDAPScenarios({
 *   script: './src/script.mjs',
 *   scenarios: './tests/scenarios.yaml'
 * });
 * ```
 */
export function runLDAPScenarios(options) {
  const {
    script: scriptPathOrModule,
    scenarios: scenariosPath,
    includeCommon = true,
    callerDir
  } = options;

  // Resolve the caller directory for relative paths
  const baseDir = callerDir || process.cwd();
  const resolvedScenariosPath = resolve(baseDir, scenariosPath);
  const scenariosDir = dirname(resolvedScenariosPath);

  // Parse LDAP scenarios using separate parser
  const { action, scenarios } = parseLDAPScenarios(resolvedScenariosPath, { includeCommon });

  // All scenarios from parseLDAPScenarios are already filtered to LDAP scenarios
  const ldapScenarios = scenarios;

  // Resolve the script
  let scriptModule;
  let scriptPromise;

  if (typeof scriptPathOrModule === 'string') {
    const resolvedScriptPath = resolve(baseDir, scriptPathOrModule);
    scriptPromise = import(resolvedScriptPath);
  } else {
    scriptModule = scriptPathOrModule;
  }

  describe(`LDAP scenarios: ${ldapScenarios.length} defined`, () => {
    let script;
    let mockFunctions;
    
    beforeAll(async () => {
      // Import ldapts after it has been mocked externally
      const ldapts = await import('ldapts');
      
      // Create client instance to get the mock functions
      // Pass empty object as options to avoid constructor errors
      const clientInstance = new ldapts.Client({});
      
      mockFunctions = {
        mockBind: clientInstance.bind,
        mockUnbind: clientInstance.unbind,
        mockModify: clientInstance.modify,
        mockSearch: clientInstance.search,
        mockAdd: clientInstance.add || jest.fn(), // fallback if add not mocked
        mockDelete: clientInstance.delete || jest.fn(), // fallback if delete not mocked
        mockModifyDN: clientInstance.modifyDN || jest.fn(), // fallback if modifyDN not mocked
        mockCompare: clientInstance.compare || jest.fn() // fallback if compare not mocked
      };
      
      if (scriptPromise) {
        const mod = await scriptPromise;
        script = mod.default || mod;
      } else {
        script = scriptModule;
      }
    });

    beforeEach(() => {
      jest.clearAllMocks();
      global.console.log = jest.fn();
      global.console.error = jest.fn();
      global.console.warn = jest.fn();
    });

    function setupScenarioMocks(resolvedSteps) {
      const operationCounters = { bind: 0, search: 0, modify: 0, unbind: 0, add: 0, delete: 0, modifyDN: 0, compare: 0 };

      function getStepForOperation(operation) {
        let currentCounter = 0;
        for (const step of resolvedSteps) {
          if (step.ldap && step.ldap.operation === operation) {
            if (currentCounter === operationCounters[operation]) {
              operationCounters[operation]++;
              return step;
            }
            currentCounter++;
          }
        }
        if (operation === 'search' && operationCounters[operation] > 0) {
          for (let i = resolvedSteps.length - 1; i >= 0; i--) {
            const step = resolvedSteps[i];
            if (step.ldap && step.ldap.operation === 'search') {
              return step;
            }
          }
        }
        return null;
      }

      mockFunctions.mockBind.mockImplementation(() => {
        const step = getStepForOperation('bind');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
        }
        return Promise.resolve();
      });

      mockFunctions.mockSearch.mockImplementation(() => {
        const step = getStepForOperation('search');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
          return Promise.resolve({ searchEntries: step.fixtureData.searchEntries || [] });
        }
        return Promise.resolve({ searchEntries: [] });
      });

      mockFunctions.mockModify.mockImplementation(() => {
        const step = getStepForOperation('modify');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
        }
        return Promise.resolve();
      });

      mockFunctions.mockUnbind.mockImplementation(() => {
        const step = getStepForOperation('unbind');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
        }
        return Promise.resolve();
      });

      mockFunctions.mockAdd.mockImplementation(() => {
        const step = getStepForOperation('add');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
        }
        return Promise.resolve();
      });

      mockFunctions.mockDelete.mockImplementation(() => {
        const step = getStepForOperation('delete');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
        }
        return Promise.resolve();
      });

      mockFunctions.mockModifyDN.mockImplementation(() => {
        const step = getStepForOperation('modifyDN');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
        }
        return Promise.resolve();
      });

      mockFunctions.mockCompare.mockImplementation(() => {
        const step = getStepForOperation('compare');
        if (step && step.fixtureData) {
          if (step.fixtureData.result === 'error') {
            const error = new Error(step.fixtureData.message);
            error.code = step.fixtureData.code;
            throw error;
          }
          // Compare operations return boolean result
          return Promise.resolve(step.fixtureData.compareResult || false);
        }
        return Promise.resolve(false);
      });
    }

    for (const scenario of ldapScenarios) {
      test(scenario.name, async () => {
        // Merge action defaults with scenario overrides
        const { params, context } = mergeDefaults(action, scenario);

        // Resolve LDAP fixtures for each step
        const resolvedSteps = resolveLDAPFixtures(scenario.steps, scenariosDir);

        // Setup LDAP mocks based on scenario steps
        setupScenarioMocks(resolvedSteps);

        try {
          if (scenario.invoke.throws) {
            await expect(script.invoke(params, context))
              .rejects.toThrow(scenario.invoke.throws);
          } else {
            const result = await script.invoke(params, context);
            
            if (scenario.invoke.returns) {
              Object.keys(scenario.invoke.returns).forEach(key => {
                expect(result[key]).toEqual(scenario.invoke.returns[key]);
              });
            }
          }
        } catch (error) {
          if (!scenario.invoke.throws) {
            throw error;
          }
        }
      });
    }
  });
}

/**
 * Load LDAP fixture using shared parser
 */
export function loadLDAPFixture(fixturePath, testFileDir) {
  try {
    return parseLDAPFixture(fixturePath, testFileDir);
  } catch (error) {
    throw new Error(`Failed to load LDAP fixture: ${fixturePath} - ${error.message}`);
  }
}

/**
 * Load scenarios from YAML file
 */
export function loadLDAPScenarios(scenariosPath, testFileDir) {
  const fullScenariosPath = resolve(testFileDir, scenariosPath);
  const scenariosContent = readFileSync(fullScenariosPath, 'utf8');
  return parse(scenariosContent);
}

/**
 * Create LDAP mock setup function
 * Returns a function that can be called with mock functions and scenario steps
 */
export function createLDAPMockSetup(loadFixture) {
  return function setupScenarioMocks(scenario, mocks) {
    const { mockBind, mockUnbind, mockModify, mockSearch } = mocks;

    // Create operation counters to handle multiple calls to same operation
    const operationCounters = {
      bind: 0,
      search: 0,
      modify: 0,
      unbind: 0
    };

    function getStepForOperation(operation) {
      let currentCounter = 0;
      for (const step of scenario.steps) {
        if (step.ldap && step.ldap.operation === operation) {
          if (currentCounter === operationCounters[operation]) {
            operationCounters[operation]++;
            return step;
          }
          currentCounter++;
        }
      }
      // If no more steps for this operation, return the last one for search operations
      // This handles cases where script does additional lookups after errors
      if (operation === 'search' && operationCounters[operation] > 0) {
        // Return the last search step fixture
        for (let i = scenario.steps.length - 1; i >= 0; i--) {
          const step = scenario.steps[i];
          if (step.ldap && step.ldap.operation === 'search') {
            return step;
          }
        }
      }
      return null;
    }

    // Setup bind mock
    mockBind.mockImplementation(() => {
      const step = getStepForOperation('bind');
      if (step) {
        const fixture = loadFixture(step.fixture);
        if (fixture.result === 'error') {
          const error = new Error(fixture.message);
          error.code = fixture.code;
          throw error;
        }
      }
      return Promise.resolve();
    });

    // Setup search mock
    mockSearch.mockImplementation(() => {
      const step = getStepForOperation('search');
      if (step) {
        const fixture = loadFixture(step.fixture);
        if (fixture.result === 'error') {
          const error = new Error(fixture.message);
          error.code = fixture.code;
          throw error;
        }
        return Promise.resolve({
          searchEntries: fixture.searchEntries || []
        });
      }
      return Promise.resolve({ searchEntries: [] });
    });

    // Setup modify mock
    mockModify.mockImplementation(() => {
      const step = getStepForOperation('modify');
      if (step) {
        const fixture = loadFixture(step.fixture);
        if (fixture.result === 'error') {
          const error = new Error(fixture.message);
          error.code = fixture.code;
          throw error;
        }
      }
      return Promise.resolve();
    });

    // Setup unbind mock
    mockUnbind.mockImplementation(() => {
      const step = getStepForOperation('unbind');
      if (step) {
        const fixture = loadFixture(step.fixture);
        if (fixture.result === 'error') {
          const error = new Error(fixture.message);
          error.code = fixture.code;
          throw error;
        }
      }
      return Promise.resolve();
    });
  };
}