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

  // Create mock functions first
  const mockBind = jest.fn();
  const mockUnbind = jest.fn();
  const mockModify = jest.fn();
  const mockSearch = jest.fn();

  // Mock ldapts module IMMEDIATELY - before any other operations
  jest.unstable_mockModule('ldapts', () => ({
    Client: jest.fn().mockImplementation(() => ({
      bind: mockBind,
      unbind: mockUnbind,
      modify: mockModify,
      search: mockSearch,
        // Add any other methods that might be called to prevent real network connections
        add: jest.fn().mockResolvedValue(),
        delete: jest.fn().mockResolvedValue(),
        modifyDN: jest.fn().mockResolvedValue(),
        compare: jest.fn().mockResolvedValue(),
        // Ensure no real connections are made by overriding any connection methods
        connect: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
        startTLS: jest.fn().mockResolvedValue()
      })),
    Change: jest.fn().mockImplementation((opts) => ({
      operation: opts.operation,
      modification: opts.modification
    })),
    Attribute: jest.fn().mockImplementation((opts) => ({
      type: opts.type,
      values: opts.values
    })),

    // Filter classes - essential for complex LDAP queries like objectGUID searches
    EqualityFilter: jest.fn().mockImplementation((opts) => ({
      attribute: opts.attribute,
      value: opts.value,
      toString: () => `(${opts.attribute}=${opts.value})`
    })),
    AndFilter: jest.fn().mockImplementation((opts) => ({
      filters: opts.filters || [],
      toString: () => `(&${(opts.filters || []).map(f => f.toString ? f.toString() : f).join('')})`
    })),
    OrFilter: jest.fn().mockImplementation((opts) => ({
      filters: opts.filters || [],
      toString: () => `(|${(opts.filters || []).map(f => f.toString ? f.toString() : f).join('')})`
    })),
    NotFilter: jest.fn().mockImplementation((opts) => ({
      filter: opts.filter,
      toString: () => `(!${opts.filter?.toString ? opts.filter.toString() : opts.filter})`
    })),
    PresenceFilter: jest.fn().mockImplementation((opts) => ({
      attribute: opts.attribute,
      toString: () => `(${opts.attribute}=*)`
    })),
    SubstringFilter: jest.fn().mockImplementation((opts) => ({
      attribute: opts.attribute,
      initial: opts.initial,
      any: opts.any,
      final: opts.final,
      toString: () => `(${opts.attribute}=*substring*)`
    })),
    GreaterThanEqualsFilter: jest.fn().mockImplementation((opts) => ({
      attribute: opts.attribute,
      value: opts.value,
      toString: () => `(${opts.attribute}>=${opts.value})`
    })),
    LessThanEqualsFilter: jest.fn().mockImplementation((opts) => ({
      attribute: opts.attribute,
      value: opts.value,
      toString: () => `(${opts.attribute}<=${opts.value})`
    })),
    ApproximateFilter: jest.fn().mockImplementation((opts) => ({
      attribute: opts.attribute,
      value: opts.value,
      toString: () => `(${opts.attribute}~=${opts.value})`
    })),
    ExtensibleFilter: jest.fn().mockImplementation((opts) => opts),

    // Other commonly used classes
    DN: jest.fn().mockImplementation((dn) => ({
      toString: () => dn || ''
    })),
    Filter: jest.fn().mockImplementation((opts) => opts),

    // Common LDAP error classes
    ResultCodeError: jest.fn(),
    NoSuchObjectError: jest.fn(),
    InvalidCredentialsError: jest.fn(),
    InsufficientAccessError: jest.fn(),
    NoSuchAttributeError: jest.fn(),
    ConstraintViolationError: jest.fn(),
    AlreadyExistsError: jest.fn(),
    UnwillingToPerformError: jest.fn(),
    SizeLimitExceededError: jest.fn(),
    TimeLimitExceededError: jest.fn(),
    InvalidSyntaxError: jest.fn(),
    OperationsError: jest.fn(),
    ProtocolError: jest.fn(),
    BusyError: jest.fn(),
    UnavailableError: jest.fn(),

    // Request/Response classes
    SearchEntry: jest.fn(),
    SearchResponse: jest.fn(),
    ModifyRequest: jest.fn(),
    ModifyResponse: jest.fn(),
    AddRequest: jest.fn(),
    AddResponse: jest.fn(),
    DeleteRequest: jest.fn(),
    DeleteResponse: jest.fn(),
    BindRequest: jest.fn(),
    BindResponse: jest.fn()
  }));

  // Resolve the caller directory for relative paths
  const baseDir = callerDir || process.cwd();
  const resolvedScenariosPath = resolve(baseDir, scenariosPath);
  const scenariosDir = dirname(resolvedScenariosPath);

  // Parse LDAP scenarios using separate parser
  const { action, scenarios } = parseLDAPScenarios(resolvedScenariosPath, { includeCommon });

  describe(`LDAP scenarios: ${scenarios.length} defined`, () => {
    let script;

    beforeAll(async () => {
      // Import the script after the mock is established
      if (typeof scriptPathOrModule === 'string') {
        const resolvedScriptPath = resolve(baseDir, scriptPathOrModule);
        const mod = await import(resolvedScriptPath);
        script = mod.default || mod;
      } else {
        script = scriptPathOrModule;
      }
    });

    beforeEach(() => {
      jest.clearAllMocks();
      global.console.log = jest.fn();
      global.console.error = jest.fn();
      global.console.warn = jest.fn();
    });

    function setupScenarioMocks(resolvedSteps) {
      const operationCounters = { bind: 0, search: 0, modify: 0, unbind: 0 };

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

      mockBind.mockImplementation(() => {
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

      mockSearch.mockImplementation(() => {
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

      mockModify.mockImplementation(() => {
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

      mockUnbind.mockImplementation(() => {
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
    }

    for (const scenario of scenarios) {
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