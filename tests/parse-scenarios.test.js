import { jest } from '@jest/globals';
import { parseScenarios, parseScenariosString, COMMON_SCENARIOS } from '../src/parse-scenarios.mjs';
import { parseLDAPScenarios } from '../src/setup-ldap.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseScenariosString', () => {
  test('parses minimal scenario YAML with single-request shorthand', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: suspends active user
    request:
      method: POST
      url: https://dev-123.okta.com/api/v1/users/usr123/lifecycle/suspend
    fixture: fixtures/200-suspended.http
    invoke:
      returns:
        userId: usr123
`;

    const result = parseScenariosString(yaml);

    expect(result.action.params).toEqual({ userId: 'usr123' });
    expect(result.action.context.secrets).toEqual({ API_TOKEN: 'test-token' });
    expect(result.scenarios).toHaveLength(1);

    const scenario = result.scenarios[0];
    expect(scenario.name).toBe('suspends active user');
    expect(scenario.steps).toHaveLength(1);
    expect(scenario.steps[0].request.method).toBe('POST');
    expect(scenario.steps[0].fixture).toBe('fixtures/200-suspended.http');
    expect(scenario.invoke.returns).toEqual({ userId: 'usr123' });
  });

  test('parses scenario with steps array', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: multi-step operation
    steps:
      - request:
          method: POST
          url: https://example.com/api/suspend
        fixture: fixtures/200-suspended.http
      - request:
          method: GET
          url: https://example.com/api/users/usr123
        fixture: fixtures/200-user.http
    invoke:
      returns:
        status: SUSPENDED
`;

    const result = parseScenariosString(yaml);
    const scenario = result.scenarios[0];

    expect(scenario.steps).toHaveLength(2);
    expect(scenario.steps[0].request.method).toBe('POST');
    expect(scenario.steps[1].request.method).toBe('GET');
  });

  test('parses scenario with invoke.throws', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: rate limited
    request:
      method: POST
      url: https://example.com/api/suspend
    fixture: fixtures/429-rate-limit.http
    invoke:
      throws: "429"
    error:
      returns:
        status: retry_requested
`;

    const result = parseScenariosString(yaml);
    const scenario = result.scenarios[0];

    expect(scenario.invoke.throws).toBe('429');
    expect(scenario.error.returns).toEqual({ status: 'retry_requested' });
  });

  test('parses scenario with error.throws', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: fatal auth error
    request:
      method: POST
      url: https://example.com/api/suspend
    fixture: fixtures/401-unauthorized.http
    invoke:
      throws: "401"
    error:
      throws: "401"
`;

    const result = parseScenariosString(yaml);
    const scenario = result.scenarios[0];

    expect(scenario.error.throws).toBe('401');
  });

  test('parses scenario with per-scenario params override', () => {
    const yaml = `
action:
  params:
    userId: default-user
    domain: example.com
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: override user
    params:
      userId: override-user
    request:
      method: POST
      url: https://example.com/api/suspend
    fixture: fixtures/200-ok.http
    invoke:
      returns:
        userId: override-user
`;

    const result = parseScenariosString(yaml);
    const scenario = result.scenarios[0];

    expect(scenario.params).toEqual({ userId: 'override-user' });
  });

  test('parses scenario with per-scenario context override', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: default-token

scenarios:
  - name: different token
    context:
      secrets:
        API_TOKEN: different-token
    request:
      method: POST
      url: https://example.com/api/suspend
    fixture: fixtures/200-ok.http
    invoke:
      returns:
        userId: usr123
`;

    const result = parseScenariosString(yaml);
    const scenario = result.scenarios[0];

    expect(scenario.context.secrets).toEqual({ API_TOKEN: 'different-token' });
  });

  test('throws on missing action section', () => {
    const yaml = `
scenarios:
  - name: missing action
    request:
      method: GET
      url: https://example.com
    fixture: f.http
    invoke:
      returns: {}
`;

    expect(() => parseScenariosString(yaml)).toThrow('action');
  });

  test('throws on missing scenarios section', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets: {}
`;

    expect(() => parseScenariosString(yaml)).toThrow('scenarios');
  });

  test('throws on scenario without name', () => {
    const yaml = `
action:
  params: {}
  context:
    secrets: {}

scenarios:
  - request:
      method: GET
      url: https://example.com
    fixture: f.http
    invoke:
      returns: {}
`;

    expect(() => parseScenariosString(yaml)).toThrow('name');
  });

  test('throws on scenario without request/steps', () => {
    const yaml = `
action:
  params: {}
  context:
    secrets: {}

scenarios:
  - name: no request
    fixture: f.http
    invoke:
      returns: {}
`;

    expect(() => parseScenariosString(yaml)).toThrow('request');
  });

  test('throws on scenario without invoke', () => {
    const yaml = `
action:
  params: {}
  context:
    secrets: {}

scenarios:
  - name: no invoke
    request:
      method: GET
      url: https://example.com
    fixture: f.http
`;

    expect(() => parseScenariosString(yaml)).toThrow('invoke');
  });

  test('handles request headers in scenario', () => {
    const yaml = `
action:
  params: {}
  context:
    secrets: {}

scenarios:
  - name: with headers
    request:
      method: POST
      url: https://example.com/api
      headers:
        Authorization: "Bearer token"
        Content-Type: "application/json"
    fixture: f.http
    invoke:
      returns: {}
`;

    const result = parseScenariosString(yaml);
    const step = result.scenarios[0].steps[0];

    expect(step.request.headers).toEqual({
      'Authorization': 'Bearer token',
      'Content-Type': 'application/json'
    });
  });
});

describe('COMMON_SCENARIOS', () => {
  test('defines standard HTTP error scenarios', () => {
    expect(COMMON_SCENARIOS).toBeInstanceOf(Array);
    expect(COMMON_SCENARIOS.length).toBeGreaterThanOrEqual(7);

    const names = COMMON_SCENARIOS.map(s => s.name);
    expect(names).toContain('handles 401 unauthorized');
    expect(names).toContain('handles 403 forbidden');
    expect(names).toContain('handles 429 rate limit');
    expect(names).toContain('handles 500 internal server error');
    expect(names).toContain('handles 502 bad gateway');
    expect(names).toContain('handles 503 service unavailable');
    expect(names).toContain('handles 504 gateway timeout');
    expect(names).toContain('handles network error');
    // malformed JSON removed — not all actions throw on bad JSON
  });

  test('each common scenario has required fields', () => {
    for (const scenario of COMMON_SCENARIOS) {
      expect(scenario).toHaveProperty('name');
      expect(scenario).toHaveProperty('generate');
      expect(typeof scenario.generate).toBe('function');
    }
  });

  test('generates a 401 scenario from action request', () => {
    const baseRequest = {
      method: 'POST',
      url: 'https://example.com/api/v1/users/usr123/lifecycle/suspend'
    };

    const s401 = COMMON_SCENARIOS.find(s => s.name === 'handles 401 unauthorized');
    const generated = s401.generate(baseRequest);

    expect(generated.steps).toHaveLength(1);
    expect(generated.steps[0].request.method).toBe('POST');
    expect(generated.steps[0].request.url).toBe(baseRequest.url);
    expect(generated.steps[0].fixtureData.statusCode).toBe(401);
    expect(generated.invoke.throws).toBe('');
  });

  test('generates a network error scenario', () => {
    const baseRequest = {
      method: 'POST',
      url: 'https://example.com/api/v1/users/usr123/lifecycle/suspend'
    };

    const sNet = COMMON_SCENARIOS.find(s => s.name === 'handles network error');
    const generated = sNet.generate(baseRequest);

    expect(generated.steps[0].networkError).toBe(true);
    expect(generated.invoke.throws).toBeDefined();
  });
});

describe('parseScenarios (with common scenario merging)', () => {
  test('merges common scenarios using first scenario request as template', () => {
    const yaml = `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: suspends active user
    request:
      method: POST
      url: https://example.com/api/v1/users/usr123/lifecycle/suspend
    fixture: fixtures/200-ok.http
    invoke:
      returns:
        userId: usr123
`;

    const result = parseScenariosString(yaml, { includeCommon: true });

    // Should have user-defined + common scenarios
    expect(result.scenarios.length).toBeGreaterThan(1);

    const names = result.scenarios.map(s => s.name);
    expect(names).toContain('suspends active user');
    expect(names).toContain('handles 401 unauthorized');
    expect(names).toContain('handles network error');
  });

  test('skips common scenarios when includeCommon is false', () => {
    const yaml = `
action:
  params: {}
  context:
    secrets: {}

scenarios:
  - name: basic test
    request:
      method: GET
      url: https://example.com/api
    fixture: f.http
    invoke:
      returns: {}
`;

    const result = parseScenariosString(yaml, { includeCommon: false });
    expect(result.scenarios).toHaveLength(1);
  });

  test('does not duplicate if user already defines a common scenario name', () => {
    const yaml = `
action:
  params: {}
  context:
    secrets: {}

scenarios:
  - name: handles 401 unauthorized
    request:
      method: POST
      url: https://example.com/api
    fixture: fixtures/401.http
    invoke:
      throws: "custom 401 handling"
  - name: basic test
    request:
      method: POST
      url: https://example.com/api
    fixture: f.http
    invoke:
      returns: {}
`;

    const result = parseScenariosString(yaml, { includeCommon: true });
    const count401 = result.scenarios.filter(s => s.name === 'handles 401 unauthorized').length;
    expect(count401).toBe(1);
  });
});

describe('parseScenarios (from file)', () => {
  const fixtureDir = join(tmpdir(), `sgnl-scenarios-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(fixtureDir, { recursive: true });
  });

  test('reads and parses a YAML file', () => {
    const yamlPath = join(fixtureDir, 'scenarios.yaml');
    writeFileSync(yamlPath, `
action:
  params:
    userId: usr123
  context:
    secrets:
      API_TOKEN: test-token

scenarios:
  - name: basic test
    request:
      method: GET
      url: https://example.com/api
    fixture: f.http
    invoke:
      returns:
        ok: true
`);

    const result = parseScenarios(yamlPath);

    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].name).toBe('basic test');
    expect(result.filePath).toBe(yamlPath);
  });
});

describe('parseLDAPScenarios', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = join(tmpdir(), `parse-ldap-scenarios-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  test('parses LDAP scenarios and filters out HTTP-only scenarios', () => {
    const yaml = `
action:
  params:
    userPrincipalName: john.doe@example.com
    groupDN: "CN=Developers,OU=Groups,DC=corp,DC=example,DC=com"
  context:
    secrets:
      LDAP_BIND_USER: "CN=Service,OU=ServiceAccounts,DC=corp,DC=example,DC=com"
      LDAP_BIND_PASSWORD: "password"
    environment:
      LDAP_URL: "ldap://dc.corp.example.com:389"

scenarios:
  - name: successfully add user to group
    steps:
      - ldap:
          operation: bind
        fixture: fixtures/bind-success.ldap
      - ldap:
          operation: search
        fixture: fixtures/search-user-found.ldap
    invoke:
      returns:
        status: "success"

  - name: http only scenario
    request:
      method: GET
      url: https://api.example.com/users/123
    fixture: fixtures/200-user.http
    invoke:
      returns:
        userId: "123"

  - name: mixed scenario with LDAP
    steps:
      - request:
          method: GET
          url: https://api.example.com/validate
        fixture: fixtures/200-ok.http
      - ldap:
          operation: bind
        fixture: fixtures/bind-success.ldap
    invoke:
      returns:
        status: "success"
`;

    const yamlPath = join(tempDir, 'ldap-scenarios.yaml');
    writeFileSync(yamlPath, yaml);

    const result = parseLDAPScenarios(yamlPath);

    expect(result.action.params.userPrincipalName).toBe('john.doe@example.com');
    expect(result.action.context.secrets.LDAP_BIND_USER).toBe('CN=Service,OU=ServiceAccounts,DC=corp,DC=example,DC=com');
    
    // Should only include scenarios with LDAP steps (2 out of 3)
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].name).toBe('successfully add user to group');
    expect(result.scenarios[1].name).toBe('mixed scenario with LDAP');
    
    // HTTP-only scenario should be filtered out
    const httpOnlyScenario = result.scenarios.find(s => s.name === 'http only scenario');
    expect(httpOnlyScenario).toBeUndefined();
  });

  test('returns empty scenarios array when no LDAP scenarios found', () => {
    const yaml = `
action:
  params:
    userId: usr123

scenarios:
  - name: http only scenario
    request:
      method: GET
      url: https://api.example.com/users/123
    fixture: fixtures/200-user.http
    invoke:
      returns:
        userId: "123"

  - name: another http scenario
    steps:
      - request:
          method: POST
          url: https://api.example.com/create
        fixture: fixtures/201-created.http
    invoke:
      returns:
        created: true
`;

    const yamlPath = join(tempDir, 'http-only-scenarios.yaml');
    writeFileSync(yamlPath, yaml);

    const result = parseLDAPScenarios(yamlPath);

    expect(result.action.params.userId).toBe('usr123');
    expect(result.scenarios).toHaveLength(0);
  });

  test('handles scenarios with mixed step types', () => {
    const yaml = `
action:
  params:
    userPrincipalName: test@example.com

scenarios:
  - name: ldap with http steps
    steps:
      - request:
          method: GET
          url: https://api.example.com/validate
        fixture: fixtures/200-ok.http
      - ldap:
          operation: bind
        fixture: fixtures/bind-success.ldap
      - ldap:
          operation: search
        fixture: fixtures/search-user.ldap
      - request:
          method: POST
          url: https://api.example.com/log
        fixture: fixtures/200-logged.http
    invoke:
      returns:
        status: "success"
`;

    const yamlPath = join(tempDir, 'mixed-scenarios.yaml');
    writeFileSync(yamlPath, yaml);

    const result = parseLDAPScenarios(yamlPath);

    expect(result.scenarios).toHaveLength(1);
    const scenario = result.scenarios[0];
    expect(scenario.name).toBe('ldap with http steps');
    expect(scenario.steps).toHaveLength(4);
    
    // Should preserve all steps, not filter them
    expect(scenario.steps[0].request.method).toBe('GET');
    expect(scenario.steps[1].ldap.operation).toBe('bind');
    expect(scenario.steps[2].ldap.operation).toBe('search');
    expect(scenario.steps[3].request.method).toBe('POST');
  });

  test('throws error when scenarios is not an array', () => {
    const yaml = `
action:
  params:
    userPrincipalName: test@example.com

scenarios: "not an array"
`;

    const yamlPath = join(tempDir, 'invalid-scenarios.yaml');
    writeFileSync(yamlPath, yaml);

    expect(() => {
      parseLDAPScenarios(yamlPath);
    }).toThrow('scenarios.yaml must have a "scenarios" array');
  });

  test('throws error when scenarios is missing', () => {
    const yaml = `
action:
  params:
    userPrincipalName: test@example.com
`;

    const yamlPath = join(tempDir, 'no-scenarios.yaml');
    writeFileSync(yamlPath, yaml);

    expect(() => {
      parseLDAPScenarios(yamlPath);
    }).toThrow('scenarios.yaml must have a "scenarios" array');
  });

  test('handles missing action section', () => {
    const yaml = `
scenarios:
  - name: ldap scenario
    steps:
      - ldap:
          operation: bind
        fixture: fixtures/bind-success.ldap
    invoke:
      returns:
        status: "success"
`;

    const yamlPath = join(tempDir, 'no-action.yaml');
    writeFileSync(yamlPath, yaml);

    const result = parseLDAPScenarios(yamlPath);

    expect(result.action).toEqual({});
    expect(result.scenarios).toHaveLength(1);
  });
});
