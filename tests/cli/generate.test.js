import yaml from 'js-yaml';
import {
  inputPlaceholder,
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

  it('populates action.params from all metadata inputs', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.params.userId).toBe('test-user-123');
    expect(parsed.action.params.address).toBe('test-address');
  });

  it('includes default secrets with BEARER_AUTH_TOKEN', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.context.secrets.BEARER_AUTH_TOKEN).toBe('test-token-123');
  });

  it('includes empty environment object', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.context.environment).toEqual({});
  });

  it('generates one scenario with TODO markers', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0].name).toContain('TODO');
  });

  it('scenario has record: true for recording workflow', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.scenarios[0].record).toBe(true);
  });

  it('scenario does not have request or fixture (filled by recorder)', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.scenarios[0].request).toBeUndefined();
    expect(parsed.scenarios[0].fixture).toBeUndefined();
    expect(parsed.scenarios[0].invoke).toBeUndefined();
  });

  it('includes YAML comments with recording instructions', () => {
    const result = generateScenariosYaml(simpleMetadata);
    expect(result).toContain('record: true');
    expect(result).toContain('npx sgnl-test-record');
  });

  it('includes default crypto mock for signJWT', () => {
    const result = generateScenariosYaml(simpleMetadata);
    const parsed = yaml.load(result);
    expect(parsed.action.context.crypto).toEqual({
      signJWT: { returns: 'mock.jwt.token' }
    });
  });

  it('handles metadata with multiple inputs of different types', () => {
    const metadata = {
      name: 'test-action',
      inputs: {
        email: { type: 'text', required: true },
        count: { type: 'number', required: false },
        enabled: { type: 'boolean', required: false }
      }
    };
    const result = generateScenariosYaml(metadata);
    const parsed = yaml.load(result);
    expect(parsed.action.params.email).toBe('user@example.com');
    expect(parsed.action.params.count).toBe(42);
    expect(parsed.action.params.enabled).toBe(true);
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
    expect(parsed.action.params.address).toBe('test-address');
  });
});
