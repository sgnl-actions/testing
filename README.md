# @sgnl-actions/testing

Declarative scenario-based testing framework for SGNL actions. Define API scenarios in YAML with raw HTTP fixture files — the framework handles [nock](https://github.com/nock/nock) (HTTP mocking) setup, invocation, and assertion automatically.

## Why This Framework?

Every SGNL action follows the same pattern: validate inputs, call an external API, handle errors, return a result. Testing these actions means writing the same boilerplate over and over — set up nock, build params/context, call `invoke()`, check the return value, repeat for every error code.

This framework eliminates that repetition. Instead of writing imperative test code, you declare scenarios in YAML:

- **What the action receives** — params, secrets, environment variables
- **What HTTP requests it should make** — method, URL, headers
- **What the API returns** — raw HTTP response fixtures captured with `curl -i`
- **What the action should do** — return specific values or throw specific errors

The framework wires everything together: it parses the YAML, loads fixtures, sets up nock interceptors, imports your script, runs each scenario, and asserts the results. One YAML file replaces hundreds of lines of test code.

### Benefits

- **Zero test boilerplate** — a 3-line test file drives all your scenarios
- **Fixtures are real responses** — capture HTTP with `curl -i`, LDAP with `ldapsearch`/`ldapmodify`
- **Common error scenarios built in** — 401, 403, 429, 500, 502, 503, 504, and network errors auto-generated
- **Readable test definitions** — YAML scenarios serve as documentation for action behavior
- **Consistent across all actions** — every action repo tests the same way

## Quick Start

### 1. Install

```bash
npm install --save-dev github:sgnl-actions/testing
```

### 2. Scaffold test files

From your action repo root (where `metadata.yaml` lives):

```bash
npx sgnl-test-init
```

This reads your `metadata.yaml` and creates:

**For HTTP actions (AAD, etc.):**
- `tests/scenarios.yaml` — starter scenario with params populated from your inputs and `record: true` for recording
- `tests/fixtures/200-success.http` — boilerplate HTTP response fixture (capture real responses with `curl -i`)

**For LDAP actions (AD, etc.):**
- `tests/scenarios.yaml` — starter LDAP scenario with bind/search/modify/unbind steps
- `tests/fixtures/200-bind-success.ldap` — LDAP bind operation fixture
- `tests/fixtures/200-search-success.ldap` — LDAP search operation fixture
- `tests/fixtures/200-modify-success.ldap` — LDAP modify operation fixture
- `tests/fixtures/200-unbind-success.ldap` — LDAP unbind operation fixture

The tool automatically detects whether your action is HTTP or LDAP-based by checking if the action name starts with `ad-` or if the description contains "LDAP".

### 3. Wire up the test runner

**For HTTP actions** in your action's `tests/script.test.js`:

```javascript
import { runScenarios } from '@sgnl-actions/testing';

runScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml'
});
```

**For LDAP actions** in your action's `tests/script.test.js`:

```javascript
import { jest } from '@jest/globals';

// Mock ldapts module before importing
jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn(),
  Change: jest.fn(),
  Attribute: jest.fn()
}));

const { runLDAPScenarios } = await import('@sgnl-actions/testing/ldap-scenarios');

runLDAPScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml'
});
```
import { runScenarios } from '@sgnl-actions/testing';

runScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml'
});
```

All paths are relative to the project root (where `npm test` runs from).

### 4. Record or fill in scenarios, then run

**Option A — Record from real systems (recommended):**

```bash
# Fill in real secrets in tests/scenarios.yaml action.context.secrets
vim tests/scenarios.yaml

# Record scenarios marked with record: true
npx sgnl-test-record

# Redact secrets before committing
vim tests/scenarios.yaml

# Run tests
npm test
```

**Option B — Write scenarios manually:**

Edit the generated files to match your action's actual API calls and expected returns (remove `record: true` and fill in `request`, `fixture`, `invoke`), then:

```bash
npm test
```

That's it. The framework reads the YAML, loads fixtures, sets up nock, imports your script, runs every scenario, and asserts results. Jest discovers `script.test.js` as usual.

## Scaffolding CLI (`npx sgnl-test-init`)

Run from an action repo root (where `metadata.yaml` lives):

```bash
npx sgnl-test-init
```

The CLI:
1. Reads `metadata.yaml` to get the action name and input parameter names/types
2. Creates `tests/fixtures/` directory
3. Creates `tests/fixtures/200-success.http` with boilerplate HTTP response
4. Creates `tests/scenarios.yaml` with:
   - `action.params` populated from metadata inputs (with smart placeholders)
   - Default `context.secrets` and `context.environment`
   - One starter scenario with `record: true` for the recording workflow
5. Skips any file that already exists (prints a warning)
6. Prints next-steps instructions

Example output:

```
Initialized scenario tests for okta-suspend-user

  Created: tests/scenarios.yaml
  Created: tests/fixtures/200-success.http

Next steps:
  Option A — Record scenarios from real systems (recommended):
    1. Edit tests/scenarios.yaml — fill in real secrets in action.context.secrets
    2. npx sgnl-test-record
    3. Review generated scenarios and fixtures, redact secrets before committing
    4. Run: npm test

  Option B — Write scenarios manually:
    ...
```

### Smart Placeholders

The CLI generates sensible placeholder values based on input names:

| Input Name | Placeholder |
|------------|-------------|
| `userId` | `test-user-123` |
| `email`, `login` | `user@example.com` |
| `firstName` | `Test` |
| `lastName` | `User` |
| `domain` | `dev-123.example.com` |
| `groupId` | `test-group-123` |
| `accountId` | `test-account-123` |
| `roleId` | `test-role-123` |
| (other text) | `test-{name}` |
| (number) | `42` |
| (boolean) | `true` |

## Scenario YAML Format

Create `tests/scenarios.yaml` in your action:

```yaml
action:
  params:
    userId: usr123
    domain: dev-123.okta.com
  context:
    secrets:
      API_TOKEN: test-token
    environment:
      ADDRESS: https://dev-123.okta.com

scenarios:
  - name: suspends active user
    request:
      method: POST
      url: https://dev-123.okta.com/api/v1/users/usr123/lifecycle/suspend
      headers:
        Authorization: "SSWS test-token"
    fixture: fixtures/200-suspended.http
    invoke:
      returns:
        userId: usr123
        suspended: true
        status: SUSPENDED

  - name: rate limited
    request:
      method: POST
      url: https://dev-123.okta.com/api/v1/users/usr123/lifecycle/suspend
    fixture: fixtures/429-rate-limit.http
    invoke:
      throws: "rate limit"
    error:
      returns:
        status: retry_requested

  - name: fatal auth error
    request:
      method: POST
      url: https://dev-123.okta.com/api/v1/users/usr123/lifecycle/suspend
    fixture: fixtures/401-unauthorized.http
    invoke:
      throws: "Unauthorized"
    error:
      throws: "Unauthorized"
```

### Multi-step scenarios

For actions that make multiple HTTP requests:

```yaml
  - name: suspend and verify
    steps:
      - request:
          method: POST
          url: https://example.com/api/v1/users/usr123/lifecycle/suspend
        fixture: fixtures/200-suspended.http
      - request:
          method: GET
          url: https://example.com/api/v1/users/usr123
        fixture: fixtures/200-user-suspended.http
    invoke:
      returns:
        userId: usr123
        status: SUSPENDED
```

### Per-scenario overrides

Override action-level params or context for specific scenarios:

```yaml
  - name: different user
    params:
      userId: usr456
    context:
      secrets:
        API_TOKEN: different-token
    request:
      method: POST
      url: https://example.com/api/v1/users/usr456/lifecycle/suspend
    fixture: fixtures/200-suspended.http
    invoke:
      returns:
        userId: usr456
```

## Fixture File Format (.http)

Standard HTTP response format, capturable with `curl -i`:

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Rate-Limit-Remaining: 599

{"id":"usr123","status":"SUSPENDED"}
```

Place fixtures in `tests/fixtures/` next to your `scenarios.yaml`.

## Common Scenarios

By default, the framework auto-generates scenarios for common HTTP errors using your first scenario's request as a template:

- 401 Unauthorized
- 403 Forbidden
- 429 Rate Limit
- 500 Internal Server Error
- 502 Bad Gateway
- 503 Service Unavailable
- 504 Gateway Timeout
- Network Error

These verify that your action throws on each error status. To disable:

```javascript
runScenarios({
  script: './src/script.mjs',
  scenarios: './tests/scenarios.yaml',
  includeCommon: false
});
```

To override a common scenario with custom behavior, define it by name in your YAML:

```yaml
scenarios:
  - name: handles 401 unauthorized
    request:
      method: POST
      url: https://example.com/api/endpoint
    fixture: fixtures/401-custom.http
    invoke:
      throws: "custom message"
    error:
      throws: "custom message"
```

## How It Works

For each scenario, the framework:

1. Merges action-level defaults with scenario overrides
2. Parses `.http` fixture files into `{ statusCode, headers, body }`
3. Calls `nock.disableNetConnect()` to block real network calls
4. Sets up nock interceptors matching each expected request
5. Calls `script.invoke(params, context)`
6. If `invoke.returns`: asserts each key/value matches the return object
7. If `invoke.throws`: asserts it threw with matching message, then:
   - If `error.returns`: calls `script.error({...params, error}, context)`, asserts return
   - If `error.throws`: calls `script.error(...)`, asserts it re-throws
   - If no `error` key: skips (framework handles retry)
8. Asserts `scope.isDone()` — all expected HTTP requests were made
9. Cleans up nock interceptors

## API

### `runScenarios(options)`

Main entry point. Call at the top level of a `describe` block.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `script` | `string \| object` | required | Path to action module or the module object |
| `scenarios` | `string` | required | Path to scenarios.yaml |
| `includeCommon` | `boolean` | `true` | Auto-generate common error scenarios |
| `callerDir` | `string` | `process.cwd()` | Base directory for resolving relative paths |

### Sub-module exports

For advanced usage, individual modules are available:

```javascript
import { parseFixture, parseFixtureString } from '@sgnl-actions/testing/parse-fixture';
import { parseScenarios, parseScenariosString, COMMON_SCENARIOS } from '@sgnl-actions/testing/parse-scenarios';
import { setupNock, cleanupNock } from '@sgnl-actions/testing/setup-nock';
import { assertInvokeReturns, assertInvokeThrows, assertErrorReturns, assertErrorThrows } from '@sgnl-actions/testing/assertions';
```

## Installation

```bash
npm install --save-dev github:sgnl-actions/testing
```

After installation, you'll see a reminder to run `npx sgnl-test-init` to scaffold your test files.

## Recording CLI (`npx sgnl-test-record`)

Manually writing scenarios and fixtures is tedious — you have to figure out what HTTP calls your action makes, what the responses look like, and what the action returns. The recording CLI automates this by running your action against real systems, capturing all HTTP traffic, and generating the scenarios + fixtures for you.

### When to use it

- **New actions** — bootstrap your entire test suite from a single recording session
- **Actions with multiple HTTP calls** — e.g., actions that call multiple APIs in sequence
- **Adding new scenarios** — add `record: true` to new scenarios and run the recorder

### How it works

The recorder reads `tests/scenarios.yaml`, finds scenarios marked with `record: true`, runs them against real systems, fills in the recorded data (`request`, `fixture`, `invoke`), and removes the `record: true` flag. Everything stays in one file.

```yaml
action:
  params:
    subject: test-subject
  context:
    secrets:
      BEARER_AUTH_TOKEN: real-token   # you fill in real secrets
    environment:
      ADDRESS: https://real-receiver.example.com/events

scenarios:
  - name: successfully transmits event
    record: true                      # recorder will fill this in

  - name: rejects invalid subject JSON
    record: true
    params:
      subject: not valid json         # per-scenario override

  - name: handles 401                 # already recorded, no flag
    request: ...
    fixture: ...
    invoke:
      throws: "Unauthorized"
```

### Recording workflow

```bash
# 1. Add record: true to scenarios you want to record
# 2. Fill in real secrets in action.context.secrets
vim tests/scenarios.yaml

# 3. Run the recorder
npx sgnl-test-record

# 4. Redact secrets before committing
vim tests/scenarios.yaml

# 5. Run tests
npm test
```

The recorder will:

1. Read `tests/scenarios.yaml` and dynamically import your script
2. For each scenario with `record: true`:
   - Merge action-level params/context with scenario overrides
   - Call `script.invoke(params, context)` against **real** systems
   - Capture all HTTP requests/responses via nock's recorder
   - If invoke throws and the script has an `error()` handler, call that too
3. Write `tests/fixtures/*.http` — one fixture file per HTTP response captured
4. Update scenarios in-place: fill in `request`/`fixture`/`invoke`, remove `record: true`
5. Write the updated `scenarios.yaml` back — secrets are **not** auto-redacted (that's your job)

Example output:

```
  Recording: successfully transmits event
    Result: returned {"status":"success"}
    HTTP calls captured: 2

  Recording: rejects invalid subject JSON
    Result: threw "Unexpected token 'n'"
    HTTP calls captured: 0

  Scenarios recorded: 2
  Fixtures created: 2
    fixtures/successfully-transmits-event-step1-api-example-com.http
    fixtures/successfully-transmits-event-step2-receiver-example-com.http

Next steps:
  1. Review tests/scenarios.yaml:
     - Verify the recorded request URLs and methods are correct
     - Check invoke.returns / invoke.throws match expectations
     - Redact any real secrets in action.context.secrets and URLs before committing
  2. Review tests/fixtures/*.http:
     - Remove any sensitive data from response headers and bodies
  3. Run: npm test
```

### Generated scenario formats

**Single HTTP call** — shorthand format:

```yaml
- name: successfully transmits event
  request:
    method: POST
    url: https://receiver.example.com/events
  fixture: fixtures/successfully-transmits-event-step1-receiver-example-com.http
  invoke:
    returns:
      status: success
```

**Multiple HTTP calls** — steps format:

```yaml
- name: successfully transmits event
  steps:
    - request:
        method: POST
        url: http://api.example.com/sign
      fixture: fixtures/successfully-transmits-event-step1-api-example-com.http
    - request:
        method: POST
        url: https://receiver.example.com/events
      fixture: fixtures/successfully-transmits-event-step2-receiver-example-com.http
  invoke:
    returns:
      status: success
```

**Zero HTTP calls** (threw before making any fetch) — empty steps:

```yaml
- name: rejects invalid subject JSON
  steps: []
  invoke:
    throws: "Unexpected token 'n', \"not valid json\" is not valid JSON"
```

### Secret handling

- Secrets are **not** auto-redacted — you are responsible for redacting `action.context.secrets` values before committing
- Secrets may also appear in fixture files (e.g., Authorization headers) or in URLs — always review generated files before committing
- The recorder preserves the `action` section as-is, so your real secrets remain in `scenarios.yaml` until you manually redact them

### Fixture file format

Generated fixtures follow the same `.http` format used by the testing framework:

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-Id: abc123

{"status":"accepted","id":"evt-456"}
```

Fixture filenames encode the scenario, step number, and target hostname:

```
{scenario-slug}-step{N}-{hostname-slug}.http
```

For example: `successfully-transmits-event-step1-api-example-com.http`

### Workflow example

Here's the recommended workflow for a new action:

```bash
# 1. Write your action script
vim src/script.mjs

# 2. Scaffold test files (generates scenarios.yaml with record: true + fixture)
npx sgnl-test-init

# 3. Fill in real secrets in scenarios.yaml
vim tests/scenarios.yaml            # replace placeholder secrets and URLs

# 4. Record scenarios against real systems
npx sgnl-test-record

# 5. Redact secrets and review generated files
vim tests/scenarios.yaml            # replace real secrets with test values
vim tests/fixtures/*.http           # remove sensitive headers/data

# 6. Wire up the test runner (if not already done)
cat > tests/script.test.js << 'EOF'
import { runScenarios } from '@sgnl-actions/testing';
runScenarios({ script: './src/script.mjs', scenarios: './tests/scenarios.yaml' });
EOF

# 7. Run tests — should pass with the recorded fixtures
npm test

# 8. Commit
git add tests/
git commit -m "Add scenario tests via sgnl-test-record"
```

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `tests/scenarios.yaml not found` | Missing or wrong location | Run `npx sgnl-test-init` to generate one |
| `no scenarios have "record: true"` | No scenarios flagged for recording | Add `record: true` to scenarios you want to record |
| `script module must export an invoke() function` | Wrong script path or missing export | Check script path; ensure `export async function invoke(...)` |
| `0 HTTP calls captured` for a scenario that should make calls | Action threw before reaching `fetch()` | Check error message; fix params or context |
| Tests fail after recording | Fixture responses don't match expectations | Review `invoke.returns` / `invoke.throws`; update if needed |
| Secrets visible in fixtures | HTTP headers or URLs contain tokens | Manually edit fixture files to remove sensitive data |
| `has "record: true" but has not been recorded yet` | Running tests before recording | Run `npx sgnl-test-record` first, or remove `record: true` and fill in manually |

## Requirements

- Node.js 22+
- Jest 29+ (peer dependency)
- Actions must use `fetch()` for HTTP calls (nock intercepts native fetch to mock responses)
