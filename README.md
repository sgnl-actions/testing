# @sgnl-actions/testing

Declarative scenario-based testing framework for SGNL actions. Define API scenarios in YAML with raw HTTP fixture files — the framework handles nock setup, invocation, and assertion automatically.

## Quick Start

In your action's `tests/script.test.js`:

```javascript
import { runScenarios } from '@sgnl-actions/testing';

runScenarios({
  script: '../src/script.mjs',
  scenarios: './scenarios.yaml'
});
```

That's it. The framework reads the YAML, loads fixtures, sets up nock, imports your script, runs every scenario, and asserts results. Jest discovers `script.test.js` as usual.

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
  script: '../src/script.mjs',
  scenarios: './scenarios.yaml',
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
npm install --save-dev @sgnl-actions/testing
```

Or from GitHub:

```bash
npm install --save-dev github:sgnl-actions/testing
```

## Requirements

- Node.js 22+
- Jest 29+ (peer dependency)
- Actions must use `fetch()` for HTTP calls (nock 14 intercepts native fetch)
