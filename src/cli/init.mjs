#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { generateScenariosYaml, generateFixture, generateLDAPScenariosYaml, generateLDAPFixture, isLDAPAction } from './generate.mjs';

const cwd = process.cwd();
const metadataPath = join(cwd, 'metadata.yaml');

if (!existsSync(metadataPath)) {
  process.stderr.write('Error: metadata.yaml not found in current directory.\n');
  process.stderr.write('Run this command from the root of an action repository.\n');
  process.exit(1);
}

const raw = readFileSync(metadataPath, 'utf-8');
const doc = yaml.load(raw);
const metadata = { name: doc.name, description: doc.description, inputs: doc.inputs ?? {} };

// Detect if this is an LDAP action and generate appropriate scaffolding
const isLDAP = isLDAPAction(metadata);

let scenariosContent, fixtureFiles;

if (isLDAP) {
  scenariosContent = generateLDAPScenariosYaml(metadata);
  // Generate multiple LDAP fixture files
  fixtureFiles = [
    { name: '200-bind-success.ldap', content: generateLDAPFixture('bind') },
    { name: '200-search-success.ldap', content: generateLDAPFixture('search') },
    { name: '200-modify-success.ldap', content: generateLDAPFixture('modify') },
    { name: '200-unbind-success.ldap', content: generateLDAPFixture('unbind') }
  ];
} else {
  scenariosContent = generateScenariosYaml(metadata);
  // Generate single HTTP fixture file
  fixtureFiles = [
    { name: '200-success.http', content: generateFixture() }
  ];
}

const scenariosPath = join(cwd, 'tests', 'scenarios.yaml');
const fixturesDir = join(cwd, 'tests', 'fixtures');

mkdirSync(fixturesDir, { recursive: true });

const created = [];
const skipped = [];

if (existsSync(scenariosPath)) {
  skipped.push('tests/scenarios.yaml');
} else {
  writeFileSync(scenariosPath, scenariosContent);
  created.push('tests/scenarios.yaml');
}

// Create fixture files based on action type
for (const { name, content } of fixtureFiles) {
  const fixturePath = join(fixturesDir, name);
  if (existsSync(fixturePath)) {
    skipped.push(`tests/fixtures/${name}`);
  } else {
    writeFileSync(fixturePath, content);
    created.push(`tests/fixtures/${name}`);
  }
}

console.log(`\nInitialized ${isLDAP ? 'LDAP' : 'HTTP'} scenario tests for ${metadata.name}\n`);

for (const f of created) {
  console.log(`  Created: ${f}`);
}
for (const f of skipped) {
  console.log(`  Skipped: ${f} (already exists)`);
}

if (isLDAP) {
  console.log(`
Next steps:
  1. Edit tests/scenarios.yaml:
     - Update LDAP parameters (baseDN, filter, etc.) to match your action
     - Set invoke.returns to match your action's actual return values
     - Add more scenarios for error cases (authentication failed, user not found, etc.)
  2. Edit tests/fixtures/*.ldap files:
     - Replace with actual LDAP operation responses for your use case
     - Create additional fixtures for error scenarios
  3. Update tests/script.test.js to use LDAP scenario testing:
     import { jest } from '@jest/globals';
     jest.unstable_mockModule('ldapts', () => ({ Client: jest.fn(), Change: jest.fn(), Attribute: jest.fn() }));
     const { runLDAPScenarios } = await import('@sgnl-actions/testing/ldap-scenarios');
     runLDAPScenarios({ script: './src/script.mjs', scenarios: './tests/scenarios.yaml' });
  4. Run: npm test
`);
} else {
  console.log(`
Next steps:
  1. Edit tests/scenarios.yaml:
     - Set the request method and URL to match your action's API call
     - Set invoke.returns to match your action's actual return values
     - Add more scenarios for error cases (429, 401, etc.)
  2. Edit tests/fixtures/200-success.http:
     - Replace the body with an actual API response (use: curl -i <url>)
     - Create additional fixtures for error scenarios
  3. Update tests/script.test.js to use scenario-based testing:
     import { runScenarios } from '@sgnl-actions/testing';
     runScenarios({ script: './src/script.mjs', scenarios: './tests/scenarios.yaml' });
  4. Run: npm test
`);
}
