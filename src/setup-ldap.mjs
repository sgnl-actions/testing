import { parse } from 'yaml';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Parse LDAP scenarios from YAML file (separate from HTTP scenarios parsing)
 */
export function parseLDAPScenarios(scenariosPath, options = {}) {
  const { includeCommon = true } = options;
  const content = readFileSync(scenariosPath, 'utf8');
  const data = parse(content);

  if (!data.scenarios || !Array.isArray(data.scenarios)) {
    throw new Error('scenarios.yaml must have a "scenarios" array');
  }

  // Filter scenarios that have LDAP steps
  const ldapScenarios = data.scenarios.filter(scenario => 
    scenario.steps && scenario.steps.some(step => step.ldap)
  );

  return {
    action: data.action || {},
    scenarios: ldapScenarios
  };
}

/**
 * Parse LDAP fixture file (.ldap format)
 * Expected format:
 * # LDAP operation comment
 * operation: bind|search|modify|unbind
 * result: success|error
 * code: 0|68|49|etc
 * message: "Error message"
 * searchEntries:
 *   - dn: "CN=User,OU=Users,DC=corp,DC=example,DC=com"
 *     attributes:
 *       distinguishedName: "CN=User,OU=Users,DC=corp,DC=example,DC=com"
 */
export function parseLDAPFixture(fixturePath, scenariosDir) {
  const fullPath = resolve(scenariosDir, fixturePath);
  try {
    const content = readFileSync(fullPath, 'utf8');
    return parse(content);
  } catch (error) {
    throw new Error(`Failed to parse LDAP fixture ${fixturePath}: ${error.message}`);
  }
}

/**
 * Check if scenario steps contain LDAP operations
 */
export function isLDAPScenario(steps) {
  return Boolean(steps && steps.some(step => step.ldap));
}

/**
 * Resolve LDAP fixture data for each step in a scenario
 */
export function resolveLDAPStepFixtures(steps, scenariosDir) {
  return steps.map(step => {
    if (!step.ldap) {
      return step;
    }

    // Already has fixtureData — nothing to resolve
    if (step.fixtureData) {
      return step;
    }

    if (!step.fixture) {
      throw new Error(
        `LDAP step for ${step.ldap.operation} has no fixture or fixtureData`
      );
    }

    const fixtureData = parseLDAPFixture(step.fixture, scenariosDir);
    return { ...step, fixtureData };
  });
}

/**
 * Clean up LDAP mocks
 */
export function cleanupLDAPMocks() {
  // Only clear mocks if jest is available (i.e., running in test environment)
  if (typeof global !== 'undefined' && global.jest) {
    global.jest.clearAllMocks();
  }
}