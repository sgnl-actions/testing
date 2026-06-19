#!/usr/bin/env node

/**
 * sgnl-sandbox-test — Runs scenario tests through the Deno sandbox container.
 *
 * Auto-discovers tests/scenarios.yaml + dist/index.js and runs each scenario
 * via the sandbox container with fixture-based mocking.
 *
 * Usage:
 *   npx sgnl-sandbox-test [options]
 *
 * Options:
 *   --bundle, -b    Path to bundle (default: dist/index.js)
 *   --scenarios, -s Path to scenarios YAML (default: tests/scenarios.yaml)
 *   --timeout, -t   Timeout per scenario in ms (default: 15000)
 *   --verbose, -v   Show action stderr output
 *   --common        Include auto-generated common error scenarios
 *   --help, -h      Show help
 */

import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseScenarios } from '../parse-scenarios.mjs';
import { parseFixture } from '../parse-fixture.mjs';
import { parse } from 'yaml';

// --- Argument parsing ---
const args = process.argv.slice(2);

function getArg(flags) {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
  }
  return null;
}

function hasFlag(flags) {
  return flags.some((f) => args.includes(f));
}

if (hasFlag(['--help', '-h'])) {
  console.log(`sgnl-sandbox-test — Run scenario tests in the Deno sandbox container

Usage:
  npx sgnl-sandbox-test [options]

Options:
  --bundle, -b    Path to bundle (default: dist/index.js)
  --scenarios, -s Path to scenarios YAML (default: tests/scenarios.yaml)
  --timeout, -t   Timeout per scenario in ms (default: 15000)
  --verbose, -v   Show action stderr output
  --common        Include auto-generated common error scenarios (excluded by default)
  --help, -h      Show help`);
  process.exit(0);
}

const bundlePath = resolve(getArg(['--bundle', '-b']) || 'dist/index.js');
const scenariosPath = resolve(getArg(['--scenarios', '-s']) || 'tests/scenarios.yaml');
const timeout = parseInt(getArg(['--timeout', '-t']) || '15000', 10);
const verbose = hasFlag(['--verbose', '-v']);
const includeCommon = hasFlag(['--common']);

// --- Graceful skip if files don't exist ---
if (!existsSync(bundlePath)) {
  console.log(`\u23ed No bundle found at ${bundlePath} \u2014 skipping sandbox tests`);
  process.exit(0);
}

if (!existsSync(scenariosPath)) {
  console.log(`\u23ed No scenarios found at ${scenariosPath} \u2014 skipping sandbox tests`);
  process.exit(0);
}

// --- Dynamic import of action-sandbox ---
let ContainerSession, checkDocker, runAction;
try {
  const mod = await import('@sgnl-actions/action-sandbox');
  ContainerSession = mod.ContainerSession;
  checkDocker = mod.checkDocker;
  runAction = mod.runAction;
} catch (err) {
  console.error('Error: @sgnl-actions/action-sandbox is not installed.');
  console.error('Install it: npm install -D @sgnl-actions/action-sandbox');
  process.exit(1);
}

// --- Verify Docker is available ---
try {
  checkDocker();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// --- Parse scenarios ---
const scenariosDir = dirname(scenariosPath);
const { action, scenarios } = parseScenarios(scenariosPath, { includeCommon });

// --- Merge helper ---
function buildCryptoContext(cryptoDef) {
  if (!cryptoDef || typeof cryptoDef !== 'object') return undefined;
  const result = {};
  for (const [name, def] of Object.entries(cryptoDef)) {
    if (def && typeof def === 'object' && 'returns' in def) {
      result[name] = { returns: def.returns };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeDefaults(actionDef, scenario) {
  const params = { ...actionDef.params, ...(scenario.params || {}) };

  const actionContext = actionDef.context || {};
  const scenarioContext = scenario.context || {};

  const mergedCryptoDef = {
    ...(actionContext.crypto || {}),
    ...(scenarioContext.crypto || {}),
  };

  const context = {
    ...actionContext,
    ...scenarioContext,
    secrets: { ...(actionContext.secrets || {}), ...(scenarioContext.secrets || {}) },
    environment: { ...(actionContext.environment || {}), ...(scenarioContext.environment || {}) },
  };

  const crypto = buildCryptoContext(mergedCryptoDef);
  if (crypto) {
    context.crypto = crypto;
  } else {
    delete context.crypto;
  }

  return { params, context };
}

// --- Resolve fixtures for steps ---
function resolveStepFixtures(steps) {
  return steps.map((step) => {
    if (step.fixtureData || step.networkError) return step;
    if (step.ldap) {
      if (step.fixtureData) return step;
      if (!step.fixture) {
        throw new Error(
          `LDAP step for ${step.ldap.operation} has no fixture or fixtureData`,
        );
      }
      const fullPath = resolve(scenariosDir, step.fixture);
      const content = readFileSync(fullPath, 'utf8');
      const fixtureData = parse(content);
      return { ...step, fixtureData };
    }
    if (!step.fixture) {
      throw new Error(
        `Step for ${step.request?.method} ${step.request?.url} has no fixture, fixtureData, or networkError`,
      );
    }
    const fixtureData = parseFixture(step.fixture, scenariosDir);
    return { ...step, fixtureData };
  });
}

// --- Convert scenario steps to container fixture format ---

/**
 * Convert HTTP steps into the container's fixture format:
 * [{ request: { method, url }, response: { statusCode, headers, body } | networkError: true }]
 */
function buildHttpFixtures(steps) {
  return steps
    .filter((step) => step.request)
    .map((step) => {
      if (step.networkError) {
        return {
          request: { method: step.request.method, url: step.request.url },
          response: { networkError: true },
        };
      }
      return {
        request: { method: step.request.method, url: step.request.url },
        response: {
          statusCode: step.fixtureData.statusCode,
          headers: step.fixtureData.headers || {},
          body: step.fixtureData.body || '',
        },
      };
    });
}

/**
 * Convert LDAP steps into the container's fixture format.
 */
function buildLdapFixtures(steps) {
  return steps
    .filter((step) => step.ldap && step.fixtureData)
    .map((step) => step.fixtureData);
}

// --- Start container session ---
const session = new ContainerSession();
await session.start();

// --- Run scenarios ---
console.log(`\nRunning ${scenarios.length} scenarios in Deno sandbox container...`);
console.log(`Bundle: ${bundlePath}\n`);

let passed = 0;
let failed = 0;
let skipped = 0;

for (const scenario of scenarios) {
  const { params, context } = mergeDefaults(action, scenario);

  // Resolve step fixtures
  let resolvedSteps;
  try {
    resolvedSteps = resolveStepFixtures(scenario.steps || []);
  } catch (err) {
    console.log(`  \u2717 ${scenario.name}`);
    console.log(`    Fixture error: ${err.message}`);
    failed++;
    continue;
  }

  const httpFixtures = buildHttpFixtures(resolvedSteps);
  const ldapFixtures = buildLdapFixtures(resolvedSteps);

  try {
    if ('throws' in (scenario.invoke || {})) {
      // Expect failure
      try {
        await runAction({
          bundle: bundlePath,
          inputs: params,
          secrets: context.secrets || {},
          environment: context.environment || {},
          handler: 'invoke',
          timeout,
          verbose,
          httpFixtures: httpFixtures.length > 0 ? httpFixtures : null,
          ldapFixtures: ldapFixtures.length > 0 ? ldapFixtures : null,
          session,
        });
        // Should have thrown
        console.log(`  \u2717 ${scenario.name}`);
        console.log(`    Expected to throw${scenario.invoke.throws ? ` containing: "${scenario.invoke.throws}"` : ''}`);
        console.log(`    But it returned successfully`);
        failed++;
      } catch (err) {
        if (scenario.invoke.throws === '' || err.message.includes(scenario.invoke.throws)) {
          console.log(`  \u2713 ${scenario.name}`);
          passed++;
        } else {
          console.log(`  \u2717 ${scenario.name}`);
          console.log(`    Expected throw containing: "${scenario.invoke.throws}"`);
          console.log(`    Actual: "${err.message}"`);
          failed++;
        }
      }
    } else if (scenario.invoke?.returns) {
      // Expect success with specific return values
      const result = await runAction({
        bundle: bundlePath,
        inputs: params,
        secrets: context.secrets || {},
        environment: context.environment || {},
        handler: 'invoke',
        timeout,
        verbose,
        httpFixtures: httpFixtures.length > 0 ? httpFixtures : null,
        ldapFixtures: ldapFixtures.length > 0 ? ldapFixtures : null,
        session,
      });

      let scenarioPassed = true;
      const mismatches = [];
      for (const [key, expected] of Object.entries(scenario.invoke.returns)) {
        const actual = result?.[key];
        const expectedStr = JSON.stringify(expected);
        const actualStr = JSON.stringify(actual);
        if (expectedStr !== actualStr) {
          scenarioPassed = false;
          mismatches.push(`    ${key}: expected ${expectedStr}, got ${actualStr}`);
        }
      }

      if (scenarioPassed) {
        console.log(`  \u2713 ${scenario.name}`);
        passed++;
      } else {
        console.log(`  \u2717 ${scenario.name}`);
        mismatches.forEach((m) => console.log(m));
        failed++;
      }
    } else {
      // No assertion defined — just verify it doesn't crash
      await runAction({
        bundle: bundlePath,
        inputs: params,
        secrets: context.secrets || {},
        environment: context.environment || {},
        handler: 'invoke',
        timeout,
        verbose,
        httpFixtures: httpFixtures.length > 0 ? httpFixtures : null,
        ldapFixtures: ldapFixtures.length > 0 ? ldapFixtures : null,
        session,
      });
      console.log(`  \u2713 ${scenario.name} (no assertion)`);
      passed++;
    }
  } catch (err) {
    if (scenario.invoke?.throws) {
      console.log(`  \u2717 ${scenario.name}`);
      console.log(`    Unexpected error: ${err.message}`);
      failed++;
    } else {
      console.log(`  \u2717 ${scenario.name}`);
      console.log(`    Error: ${err.message}`);
      failed++;
    }
  }
}

// --- Cleanup ---
await session.close();

// --- Summary ---
const total = passed + failed + skipped;
console.log(`\n${total} scenarios: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed > 0 ? 1 : 0);

