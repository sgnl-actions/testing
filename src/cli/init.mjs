#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { generateScenariosYaml } from './generate.mjs';

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

const scenariosPath = join(cwd, 'tests', 'scenarios.yaml');

mkdirSync(join(cwd, 'tests'), { recursive: true });

const created = [];
const skipped = [];

if (existsSync(scenariosPath)) {
  skipped.push('tests/scenarios.yaml');
} else {
  writeFileSync(scenariosPath, scenariosContent);
  created.push('tests/scenarios.yaml');
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
  Option A — Record scenarios from real systems (recommended):
    1. Edit tests/scenarios.yaml — fill in real secrets in action.context.secrets
    2. npx sgnl-test-record
    3. Review generated scenarios and fixtures, redact secrets before committing
    4. Run: npm test

  Option B — Write scenarios manually:
    1. Edit tests/scenarios.yaml:
       - Remove "record: true" from scenarios
       - Set the request method and URL to match your action's API call
       - Set invoke.returns to match your action's actual return values
       - Add more scenarios for error cases (429, 401, etc.)
    2. Create tests/fixtures/*.http:
       - Capture real responses with: curl -i <url>

  Then wire up the test runner in tests/script.test.js:
    import { runScenarios } from '@sgnl-actions/testing';
    runScenarios({ script: './src/script.mjs', scenarios: './tests/scenarios.yaml' });

  Run: npm test
`);
