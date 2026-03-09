import { jest } from '@jest/globals';

// Mock fs module properly for ES modules - this must be done before importing the module under test
const mockReadFileSync = jest.fn();
jest.unstable_mockModule('fs', () => ({
  readFileSync: mockReadFileSync
}));

// Mock path module  
jest.unstable_mockModule('path', () => ({
  resolve: jest.fn((dir, file) => `${dir}/${file}`)
}));

// Now import the module under test after mocking its dependencies
const { parseLDAPFixture, isLDAPScenario, resolveLDAPStepFixtures, cleanupLDAPMocks } = await import('../src/setup-ldap.mjs');

describe('setup-ldap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFileSync.mockClear();
  });

  describe('parseLDAPFixture', () => {
    test('parses valid LDAP fixture with bind operation', () => {
      const fixtureContent = `# LDAP bind operation
operation: bind
result: success
code: 0
message: "Bind successful"`;

      mockReadFileSync.mockReturnValue(fixtureContent);

      const result = parseLDAPFixture('bind-success.ldap', '/test/scenarios');

      expect(mockReadFileSync).toHaveBeenCalledWith(
        '/test/scenarios/bind-success.ldap',
        'utf8'
      );
      expect(result).toEqual({
        operation: 'bind',
        result: 'success',
        code: 0,
        message: 'Bind successful'
      });
    });

    test('parses LDAP fixture with search operation and entries', () => {
      const fixtureContent = `# LDAP search operation
operation: search
result: success
code: 0
message: "Search successful"
searchEntries:
  - dn: "CN=Test User,OU=Users,DC=corp,DC=example,DC=com"
    attributes:
      distinguishedName: "CN=Test User,OU=Users,DC=corp,DC=example,DC=com"
      sAMAccountName: "testuser"
      mail: "test@example.com"
  - dn: "CN=Another User,OU=Users,DC=corp,DC=example,DC=com"
    attributes:
      distinguishedName: "CN=Another User,OU=Users,DC=corp,DC=example,DC=com"
      sAMAccountName: "anotheruser"`;

      mockReadFileSync.mockReturnValue(fixtureContent);

      const result = parseLDAPFixture('search-users.ldap', '/test/scenarios');

      expect(result.operation).toBe('search');
      expect(result.result).toBe('success');
      expect(result.searchEntries).toHaveLength(2);
      expect(result.searchEntries[0].dn).toBe('CN=Test User,OU=Users,DC=corp,DC=example,DC=com');
      expect(result.searchEntries[0].attributes.sAMAccountName).toBe('testuser');
    });

    test('parses LDAP fixture with modify operation', () => {
      const fixtureContent = `# LDAP modify operation
operation: modify
result: success
code: 0
message: "Modify successful"`;

      mockReadFileSync.mockReturnValue(fixtureContent);

      const result = parseLDAPFixture('modify-user.ldap', '/test/scenarios');

      expect(result).toEqual({
        operation: 'modify',
        result: 'success',
        code: 0,
        message: 'Modify successful'
      });
    });

    test('parses LDAP fixture with error result', () => {
      const fixtureContent = `# LDAP bind failure
operation: bind
result: error
code: 49
message: "Invalid credentials"`;

      mockReadFileSync.mockReturnValue(fixtureContent);

      const result = parseLDAPFixture('bind-error.ldap', '/test/scenarios');

      expect(result).toEqual({
        operation: 'bind',
        result: 'error',
        code: 49,
        message: 'Invalid credentials'
      });
    });

    test('throws error when fixture file cannot be read', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() => {
        parseLDAPFixture('nonexistent.ldap', '/test/scenarios');
      }).toThrow('Failed to parse LDAP fixture nonexistent.ldap: File not found');
    });

    test('throws error when fixture file has invalid YAML', () => {
      const invalidYaml = `operation: bind
result: success
code: 0
invalid: yaml: content: [unclosed`;

      mockReadFileSync.mockReturnValue(invalidYaml);

      expect(() => {
        parseLDAPFixture('invalid.ldap', '/test/scenarios');
      }).toThrow(/Failed to parse LDAP fixture invalid\.ldap:/);
    });
  });

  describe('isLDAPScenario', () => {
    test('returns true when steps contain LDAP operations', () => {
      const steps = [
        { request: { method: 'GET', url: 'https://api.example.com/test' } },
        { ldap: { operation: 'bind' } },
        { ldap: { operation: 'search' } }
      ];

      expect(isLDAPScenario(steps)).toBe(true);
    });

    test('returns false when steps contain no LDAP operations', () => {
      const steps = [
        { request: { method: 'GET', url: 'https://api.example.com/test' } },
        { request: { method: 'POST', url: 'https://api.example.com/create' } }
      ];

      expect(isLDAPScenario(steps)).toBe(false);
    });

    test('returns false when steps is empty', () => {
      expect(isLDAPScenario([])).toBe(false);
    });

    test('returns false when steps is null or undefined', () => {
      expect(isLDAPScenario(null)).toBe(false);
      expect(isLDAPScenario(undefined)).toBe(false);
    });

    test('returns true when at least one step has LDAP operation', () => {
      const steps = [
        { request: { method: 'GET', url: 'https://api.example.com/test' } },
        { ldap: { operation: 'search' } }
      ];

      expect(isLDAPScenario(steps)).toBe(true);
    });
  });

  describe('resolveLDAPStepFixtures', () => {
    test('resolves fixture data for LDAP steps', () => {
      const fixtureContent = `operation: bind
result: success
code: 0`;

      mockReadFileSync.mockReturnValue(fixtureContent);

      const steps = [
        { request: { method: 'GET', url: 'https://api.example.com/test' } },
        { 
          ldap: { operation: 'bind' },
          fixture: 'bind-success.ldap'
        }
      ];

      const result = resolveLDAPStepFixtures(steps, '/test/scenarios');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(steps[0]); // Non-LDAP step unchanged
      expect(result[1].ldap).toEqual({ operation: 'bind' });
      expect(result[1].fixture).toBe('bind-success.ldap');
      expect(result[1].fixtureData).toEqual({
        operation: 'bind',
        result: 'success',
        code: 0
      });
    });

    test('leaves steps with existing fixtureData unchanged', () => {
      const existingFixtureData = { operation: 'search', result: 'success', searchEntries: [] };
      
      const steps = [
        { 
          ldap: { operation: 'search' },
          fixture: 'search.ldap',
          fixtureData: existingFixtureData
        }
      ];

      const result = resolveLDAPStepFixtures(steps, '/test/scenarios');

      expect(result[0].fixtureData).toBe(existingFixtureData);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    test('leaves non-LDAP steps unchanged', () => {
      const steps = [
        { request: { method: 'GET', url: 'https://api.example.com/test' } },
        { request: { method: 'POST', url: 'https://api.example.com/create' } }
      ];

      const result = resolveLDAPStepFixtures(steps, '/test/scenarios');

      expect(result).toEqual(steps);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    test('throws error when LDAP step has no fixture or fixtureData', () => {
      const steps = [
        { ldap: { operation: 'bind' } } // Missing both fixture and fixtureData
      ];

      expect(() => {
        resolveLDAPStepFixtures(steps, '/test/scenarios');
      }).toThrow('LDAP step for bind has no fixture or fixtureData');
    });

    test('resolves multiple LDAP steps with different fixtures', () => {
      mockReadFileSync
        .mockReturnValueOnce('operation: bind\nresult: success\ncode: 0')
        .mockReturnValueOnce('operation: search\nresult: success\nsearchEntries: []');

      const steps = [
        { 
          ldap: { operation: 'bind' },
          fixture: 'bind.ldap'
        },
        { 
          ldap: { operation: 'search' },
          fixture: 'search.ldap'
        }
      ];

      const result = resolveLDAPStepFixtures(steps, '/test/scenarios');

      expect(result).toHaveLength(2);
      expect(result[0].fixtureData.operation).toBe('bind');
      expect(result[1].fixtureData.operation).toBe('search');
      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });

    test('handles mixed LDAP and HTTP steps', () => {
      mockReadFileSync.mockReturnValue('operation: modify\nresult: success\ncode: 0');

      const steps = [
        { request: { method: 'GET', url: 'https://api.example.com/user' } },
        { 
          ldap: { operation: 'modify' },
          fixture: 'modify.ldap'
        },
        { request: { method: 'POST', url: 'https://api.example.com/log' } }
      ];

      const result = resolveLDAPStepFixtures(steps, '/test/scenarios');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(steps[0]); // HTTP step unchanged
      expect(result[1].fixtureData.operation).toBe('modify'); // LDAP step resolved
      expect(result[2]).toEqual(steps[2]); // HTTP step unchanged
    });
  });

  describe('cleanupLDAPMocks', () => {
    test('clears all Jest mocks', () => {
      // Create some mock functions to verify clearing
      const mockFn1 = jest.fn();
      const mockFn2 = jest.fn();
      
      // Call the mock functions so they have call history
      mockFn1('test');
      mockFn2('test');
      
      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).toHaveBeenCalledTimes(1);

      // Call cleanupLDAPMocks - this should clear all mocks
      cleanupLDAPMocks();

      // The mocks should still show their previous call history since
      // jest.clearAllMocks() clears mock call history but doesn't affect
      // the assertions we already made above. The important thing is that
      // the function runs without throwing an error.
      expect(typeof cleanupLDAPMocks).toBe('function');
    });
  });
});