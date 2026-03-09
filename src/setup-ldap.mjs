import { parse } from 'yaml';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  return steps && steps.some(step => step.ldap);
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
  jest.clearAllMocks();
}