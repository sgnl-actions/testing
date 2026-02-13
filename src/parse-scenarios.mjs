import yaml from 'js-yaml';
import { readFileSync } from 'fs';

/**
 * Built-in common scenarios that every HTTP-calling action should handle.
 * Each entry has a name and a generate(baseRequest) function that produces
 * the scenario steps and expectations from the action's own request shape.
 */
export const COMMON_SCENARIOS = [
  {
    name: 'handles 401 unauthorized',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json' },
          body: '{"error":"Unauthorized","message":"Invalid or expired token"}'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles 403 forbidden',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: '{"error":"Forbidden","message":"Insufficient permissions"}'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles 429 rate limit',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
          body: '{"error":"Too Many Requests","message":"Rate limit exceeded"}'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles 500 internal server error',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: '{"error":"Internal Server Error"}'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles 502 bad gateway',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 502,
          headers: { 'Content-Type': 'text/html' },
          body: '<html><body>Bad Gateway</body></html>'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles 503 service unavailable',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json' },
          body: '{"error":"Service Unavailable"}'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles 504 gateway timeout',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        fixtureData: {
          statusCode: 504,
          headers: { 'Content-Type': 'text/html' },
          body: '<html><body>Gateway Timeout</body></html>'
        }
      }],
      invoke: { throws: '' }
    })
  },
  {
    name: 'handles network error',
    generate: (baseRequest) => ({
      steps: [{
        request: { method: baseRequest.method, url: baseRequest.url },
        networkError: true
      }],
      invoke: { throws: '' }
    })
  }
];

/**
 * Normalise a single scenario: convert shorthand (request/fixture at top level)
 * into the steps array format.
 */
function normaliseScenario(scenario) {
  const normalised = { ...scenario };

  // Convert shorthand to steps array
  if (!normalised.steps) {
    if (!normalised.request) {
      throw new Error(`Scenario "${normalised.name}" must have either "request" or "steps"`);
    }
    normalised.steps = [{
      request: normalised.request,
      fixture: normalised.fixture
    }];
    delete normalised.request;
    delete normalised.fixture;
  }

  return normalised;
}

/**
 * Validate a parsed scenario object.
 */
function validateScenario(scenario, index) {
  if (!scenario.name) {
    throw new Error(`Scenario at index ${index} is missing required field "name"`);
  }
  if (!scenario.invoke) {
    throw new Error(`Scenario "${scenario.name}" is missing required field "invoke"`);
  }
}

/**
 * Parse a scenarios YAML string into structured scenario definitions.
 *
 * @param {string} yamlString - Raw YAML content
 * @param {Object} [options]
 * @param {boolean} [options.includeCommon=false] - Whether to merge common scenarios
 * @returns {{ action: Object, scenarios: Array }}
 */
export function parseScenariosString(yamlString, options = {}) {
  const { includeCommon = false } = options;

  const doc = yaml.load(yamlString);

  if (!doc.action) {
    throw new Error('scenarios.yaml must have an "action" section');
  }
  if (!doc.scenarios || !Array.isArray(doc.scenarios) || doc.scenarios.length === 0) {
    throw new Error('scenarios.yaml must have a "scenarios" array with at least one scenario');
  }

  // Normalise and validate each user-defined scenario
  const userScenarios = doc.scenarios.map((s, i) => {
    validateScenario(s, i);
    return normaliseScenario(s);
  });

  let allScenarios = [...userScenarios];

  // Merge common scenarios if requested
  if (includeCommon) {
    const userNames = new Set(userScenarios.map(s => s.name));

    // Use first scenario's first step request as template for common scenarios
    const templateRequest = userScenarios[0].steps[0].request;

    for (const common of COMMON_SCENARIOS) {
      if (userNames.has(common.name)) continue;

      const generated = common.generate(templateRequest);
      allScenarios.push({
        name: common.name,
        ...generated,
        _common: true
      });
    }
  }

  return {
    action: doc.action,
    scenarios: allScenarios
  };
}

/**
 * Read and parse a scenarios.yaml file.
 *
 * @param {string} filePath - Path to the scenarios.yaml file
 * @param {Object} [options] - Same options as parseScenariosString
 * @returns {{ action: Object, scenarios: Array, filePath: string }}
 */
export function parseScenarios(filePath, options = {}) {
  const raw = readFileSync(filePath, 'utf-8');
  const result = parseScenariosString(raw, options);
  return { ...result, filePath };
}
