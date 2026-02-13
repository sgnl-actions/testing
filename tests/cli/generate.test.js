import yaml from 'js-yaml';
import {
  inputPlaceholder,
  generateFixture,
  generateScenariosYaml
} from '../../src/cli/generate.mjs';

describe('inputPlaceholder', () => {
  it('returns well-known placeholder for userId', () => {
    expect(inputPlaceholder('userId', 'text')).toBe('test-user-123');
  });

  it('returns well-known placeholder for email', () => {
    expect(inputPlaceholder('email', 'text')).toBe('user@example.com');
  });

  it('returns well-known placeholder for login', () => {
    expect(inputPlaceholder('login', 'text')).toBe('user@example.com');
  });

  it('returns well-known placeholder for firstName', () => {
    expect(inputPlaceholder('firstName', 'text')).toBe('Test');
  });

  it('returns well-known placeholder for lastName', () => {
    expect(inputPlaceholder('lastName', 'text')).toBe('User');
  });

  it('returns well-known placeholder for domain', () => {
    expect(inputPlaceholder('domain', 'text')).toBe('dev-123.example.com');
  });

  it('returns well-known placeholder for subject', () => {
    expect(inputPlaceholder('subject', 'text')).toBe('test-subject');
  });

  it('returns well-known placeholder for audience', () => {
    expect(inputPlaceholder('audience', 'text')).toBe('https://audience.example.com');
  });

  it('returns well-known placeholder for groupId', () => {
    expect(inputPlaceholder('groupId', 'text')).toBe('test-group-123');
  });

  it('returns well-known placeholder for groupIds', () => {
    expect(inputPlaceholder('groupIds', 'text')).toBe('group-1,group-2');
  });

  it('returns well-known placeholder for roleId', () => {
    expect(inputPlaceholder('roleId', 'text')).toBe('test-role-123');
  });

  it('returns well-known placeholder for accountId', () => {
    expect(inputPlaceholder('accountId', 'text')).toBe('test-account-123');
  });

  it('returns type-based placeholder for unknown text field', () => {
    expect(inputPlaceholder('customField', 'text')).toBe('test-customField');
  });

  it('returns type-based placeholder for number', () => {
    expect(inputPlaceholder('retryCount', 'number')).toBe(42);
  });

  it('returns type-based placeholder for boolean', () => {
    expect(inputPlaceholder('enabled', 'boolean')).toBe(true);
  });

  it('defaults to text placeholder for unknown type', () => {
    expect(inputPlaceholder('something', 'unknown')).toBe('test-something');
  });
});

describe('generateFixture', () => {
  it('returns a valid HTTP response string', () => {
    const fixture = generateFixture();
    expect(fixture).toContain('HTTP/1.1 200 OK');
    expect(fixture).toContain('Content-Type: application/json');
    expect(fixture).toContain('{"TODO": "replace with actual API response body"}');
  });

  it('has blank line separating headers from body', () => {
    const fixture = generateFixture();
    const lines = fixture.split('\n');
    const blankIndex = lines.indexOf('');
    expect(blankIndex).toBeGreaterThan(0);
    expect(lines[blankIndex - 1]).toBe('Content-Type: application/json');
    expect(lines[blankIndex + 1]).toBe('{"TODO": "replace with actual API response body"}');
  });

  it('ends with a trailing newline', () => {
    const fixture = generateFixture();
    expect(fixture.endsWith('\n')).toBe(true);
  });
});

describe('generateScenariosYaml', () => {
  const simpleMetadata = {
    name: 'okta-suspend-user',
    inputs: {
      userId: { type: 'text', description: 'The Okta user ID', required: true },
      address: { type: 'text', description: 'API base URL', required: false }
    }
  };

  it('returns a parseable YAML string', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed).toBeDefined();
    expect(parsed.action).toBeDefined();
    expect(parsed.scenarios).toBeDefined();
  });

  it('populates action.params from metadata inputs, skipping address', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.params.userId).toBe('test-user-123');
    expect(parsed.action.params).not.toHaveProperty('address');
  });

  it('includes default secrets with BEARER_AUTH_TOKEN', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.context.secrets.BEARER_AUTH_TOKEN).toBe('test-token-123');
  });

  it('includes default environment with ADDRESS', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.context.environment.ADDRESS).toBe('https://api.example.com');
  });

  it('generates one scenario with TODO markers', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0].name).toContain('TODO');
  });

  it('scenario has request with TODO url', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    const scenario = parsed.scenarios[0];
    expect(scenario.request.method).toBe('POST');
    expect(scenario.request.url).toContain('TODO');
  });

  it('scenario has fixture path', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.scenarios[0].fixture).toBe('fixtures/200-success.http');
  });

  it('scenario has invoke.returns with TODO status', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.scenarios[0].invoke.returns.status).toBe('success');
  });

  it('includes YAML comments with TODO instructions', () => {
    const result = generateScenariosYaml(simpleMetadata);
    expect(result).toContain('# TODO');
  });

  it('handles metadata with multiple inputs of different types', () => {
    const metadata = {
      name: 'test-action',
      inputs: {
        email: { type: 'text', required: true },
        count: { type: 'number', required: false },
        enabled: { type: 'boolean', required: false },
        address: { type: 'text', required: false }
      }
    };
    const result = generateScenariosYaml(metadata);
    const parsed = yaml.load(result);
    expect(parsed.action.params.email).toBe('user@example.com');
    expect(parsed.action.params.count).toBe(42);
    expect(parsed.action.params.enabled).toBe(true);
    expect(parsed.action.params).not.toHaveProperty('address');
  });

  it('handles metadata with no inputs', () => {
    const metadata = { name: 'no-inputs-action', inputs: {} };
    const result = generateScenariosYaml(metadata);
    const parsed = yaml.load(result);
    expect(parsed.action.params).toEqual({});
  });

  it('handles metadata with only address input', () => {
    const metadata = {
      name: 'address-only',
      inputs: { address: { type: 'text', required: false } }
    };
    const result = generateScenariosYaml(metadata);
    const parsed = yaml.load(result);
    expect(parsed.action.params).toEqual({});
  });
});
