#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { generateScenariosYaml, generateFixture } from './generate.mjs';

const cwd = process.cwd();
const metadataPath = join(cwd, 'metadata.yaml');

if (!existsSync(metadataPath)) {
  process.stderr.write('Error: metadata.yaml not found in current directory.\n');
  process.stderr.write('Run this command from the root of an action repository.\n');
  process.exit(1);
}

const raw = readFileSync(metadataPath, 'utf-8');
const doc = yaml.load(raw);
const metadata = { name: doc.name, inputs: doc.inputs ?? {} };

const scenariosContent = generateScenariosYaml(metadata);
const fixtureContent = generateFixture();

const scenariosPath = join(cwd, 'tests', 'scenarios.yaml');
const fixturesDir = join(cwd, 'tests', 'fixtures');
const fixturePath = join(fixturesDir, '200-success.http');

mkdirSync(fixturesDir, { recursive: true });

const created = [];
const skipped = [];

if (existsSync(scenariosPath)) {
  skipped.push('tests/scenarios.yaml');
} else {
  writeFileSync(scenariosPath, scenariosContent);
  created.push('tests/scenarios.yaml');
}

if (existsSync(fixturePath)) {
  skipped.push('tests/fixtures/200-success.http');
} else {
  writeFileSync(fixturePath, fixtureContent);
  created.push('tests/fixtures/200-success.http');
}

console.log(`\nInitialized scenario tests for ${metadata.name}\n`);

for (const f of created) {
  console.log(`  Created: ${f}`);
}
for (const f of skipped) {
  console.log(`  Skipped: ${f} (already exists)`);
}

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
