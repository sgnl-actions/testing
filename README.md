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
- `tests/scenarios.yaml` — starter scenario with params populated from your inputs
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

All paths are relative to the project root (where `npm test` runs from).

### 4. Fill in the TODOs and run

Edit the generated files to match your action's actual API calls and expected returns, then:

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
   - One starter scenario with TODO markers
5. Skips any file that already exists (prints a warning)
6. Prints next-steps instructions

Example output:

```
Initialized scenario tests for okta-suspend-user

  Created: tests/scenarios.yaml
  Created: tests/fixtures/200-success.http

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

## LDAP Fixture File Format (.ldap)

LDAP fixtures use YAML format to define LDAP operation results, capturable with `ldapsearch`, `ldapmodify`, etc.:

```yaml
# tests/fixtures/bind-success.ldap
operation: "bind"
result:
  code: 0
  message: "Success"
```

```yaml
# tests/fixtures/search-user-found.ldap
operation: "search"
result:
  code: 0
  message: "Success"
  entries:
    - dn: "CN=testuser,OU=Users,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
      attributes:
        cn: "testuser"
        distinguishedName: "CN=testuser,OU=Users,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
        objectClass: ["top", "person", "user"]
        memberOf: ["CN=ExistingGroup,OU=Groups,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"]
```

```yaml
# tests/fixtures/modify-success.ldap
operation: "modify"
result:
  code: 0
  message: "Success"
```

```yaml
# tests/fixtures/bind-error.ldap
operation: "bind"
result:
  code: 49
  message: "Invalid credentials"
```

Place LDAP fixtures in `tests/fixtures/` next to your `scenarios.yaml`.

## LDAP Scenario YAML Format

LDAP scenarios define a sequence of LDAP operations (bind, search, modify, unbind):

```yaml
action:
  params:
    userDN: "CN=testuser,OU=Users,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
    groupDN: "CN=TestGroup,OU=Groups,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
  context:
    secrets:
      LDAP_USERNAME: "admin@adaptertest.sgnl.ai"
      LDAP_PASSWORD: "test-password"
    environment:
      LDAP_URL: "ldap://adaptertest.sgnl.ai:389"

scenarios:
  - name: successfully add user to group
    steps:
      - operation: bind
        fixture: fixtures/bind-success.ldap
      - operation: search
        fixture: fixtures/search-user-found.ldap
      - operation: modify
        fixture: fixtures/modify-success.ldap
      - operation: unbind
        fixture: fixtures/unbind-success.ldap
    invoke:
      returns:
        userDN: "CN=testuser,OU=Users,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
        groupDN: "CN=TestGroup,OU=Groups,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
        success: true

  - name: user not found
    steps:
      - operation: bind
        fixture: fixtures/bind-success.ldap
      - operation: search
        fixture: fixtures/search-user-not-found.ldap
      - operation: unbind
        fixture: fixtures/unbind-success.ldap
    invoke:
      throws: "User not found"
    error:
      returns:
        userDN: "CN=testuser,OU=Users,OU=adaptertest,DC=adaptertest,DC=sgnl,DC=ai"
        error: "User not found"
```

### LDAP Operation Types

| Operation | Purpose | Typical Fixtures |
|-----------|---------|------------------|
| `bind` | Authenticate with LDAP server | `bind-success.ldap`, `bind-error.ldap` |
| `search` | Find LDAP entries | `search-user-found.ldap`, `search-user-not-found.ldap` |
| `modify` | Update LDAP entries | `modify-success.ldap`, `modify-insufficient-permissions.ldap` |
| `add` | Create LDAP entries | `add-success.ldap`, `add-already-exists.ldap` |
| `delete` | Remove LDAP entries | `delete-success.ldap`, `delete-not-found.ldap` |
| `unbind` | Close LDAP connection | `unbind-success.ldap` |

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

**HTTP Testing:**
```javascript
import { parseFixture, parseFixtureString } from '@sgnl-actions/testing/parse-fixture';
import { parseScenarios, parseScenariosString, COMMON_SCENARIOS } from '@sgnl-actions/testing/parse-scenarios';
import { setupNock, cleanupNock } from '@sgnl-actions/testing/setup-nock';
import { assertInvokeReturns, assertInvokeThrows, assertErrorReturns, assertErrorThrows } from '@sgnl-actions/testing/assertions';
```

**LDAP Testing:**
```javascript
import { parseLDAPFixture, parseLDAPFixtureString } from '@sgnl-actions/testing/parse-ldap-fixture';
import { parseLDAPScenarios, isLDAPScenario, resolveLDAPStepFixtures, cleanupLDAPMocks } from '@sgnl-actions/testing/setup-ldap';
import { runLDAPScenarios } from '@sgnl-actions/testing/ldap-scenarios';
```

## Installation

```bash
npm install --save-dev github:sgnl-actions/testing
```

After installation, you'll see a reminder to run `npx sgnl-test-init` to scaffold your test files.

## Requirements

- Node.js 22+
- Jest 29+ (peer dependency)
- Actions must use `fetch()` for HTTP calls (nock intercepts native fetch to mock responses)
