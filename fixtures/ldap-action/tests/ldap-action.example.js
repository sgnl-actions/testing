/**
 * Example LDAP Action Tests
 * 
 * This demonstrates how to test LDAP actions using the testing framework.
 * Run with: npm test ldap-action.test.js
 */
import { runLDAPScenarios } from '../../../src/ldap-scenarios.mjs';
import script from '../src/script.mjs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Example of testing with direct script import
runLDAPScenarios({
  script: script,
  scenarios: './scenarios.yaml',
  callerDir: __dirname
});