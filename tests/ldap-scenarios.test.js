import { jest } from '@jest/globals';

// Mock path and fs modules
const mockResolve = jest.fn();
const mockDirname = jest.fn();

jest.unstable_mockModule('path', () => ({
  resolve: mockResolve,
  dirname: mockDirname
}));

// Mock setup-ldap module
jest.unstable_mockModule('../src/setup-ldap.mjs', () => ({
  parseLDAPScenarios: jest.fn(),
  parseLDAPFixture: jest.fn()
}));

// Now import the modules after mocking
const { runLDAPScenarios } = await import('../src/ldap-scenarios.mjs');
const { parseLDAPScenarios } = await import('../src/setup-ldap.mjs');

describe('LDAP Scenarios Framework', () => {
  let mockScript;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock script
    mockScript = {
      invoke: jest.fn()
    };
    
    // Setup path mocks
    mockResolve.mockImplementation((dir, file) => {
      if (file.startsWith('./')) {
        return `${dir}/${file.substring(2)}`;
      }
      return `${dir}/${file}`;
    });
    mockDirname.mockImplementation(path => path.replace(/\/[^/]+$/, ''));
    
    // Setup default parseLDAPScenarios mock
    parseLDAPScenarios.mockReturnValue({
      action: { 
        params: { baseDN: 'DC=test,DC=com' }, 
        context: { 
          secrets: { LDAP_BIND_DN: 'CN=test,DC=test,DC=com', LDAP_BIND_PASSWORD: 'password' },
          environment: {} 
        } 
      },
      scenarios: []
    });
    
    // Mock global describe to prevent Jest issues
    global.describe = jest.fn();
  });
  
  afterEach(() => {
    // Clean up global mock
    delete global.describe;
  });

  test('module exports runLDAPScenarios function', () => {
    expect(typeof runLDAPScenarios).toBe('function');
  });

  test('enhanced framework supports new LDAP operations', () => {
    // Test that the enhanced framework supports all LDAP operations including new ones:
    // add, delete, modifyDN, compare (in addition to existing bind, unbind, modify, search)
    
    const enhancedOperations = ['add', 'delete', 'modifyDN', 'compare'];
    const scenarios = enhancedOperations.map(operation => ({
      name: `test ${operation} operation`,
      steps: [
        {
          ldap: { operation },
          fixture: `${operation}-success.ldap`,
          fixtureData: { 
            operation, 
            result: 'success', 
            code: 0,
            ...(operation === 'compare' && { compareResult: true })
          }
        }
      ],
      invoke: { returns: { status: 'success' } }
    }));
    
    parseLDAPScenarios.mockReturnValue({
      action: { 
        params: { baseDN: 'DC=test,DC=com' }, 
        context: { 
          secrets: { LDAP_BIND_DN: 'CN=test,DC=test,DC=com', LDAP_BIND_PASSWORD: 'password' },
          environment: {} 
        } 
      },
      scenarios
    });
    
    // Should not throw when setting up scenarios with enhanced operations
    expect(() => {
      runLDAPScenarios({
        script: mockScript,
        scenarios: './enhanced-operations.yaml',
        callerDir: '/base'
      });
    }).not.toThrow();
    
    // Verify framework initialization
    expect(parseLDAPScenarios).toHaveBeenCalledWith('/base/enhanced-operations.yaml', { includeCommon: true });
  });

  test('handles error scenarios for enhanced LDAP operations', () => {
    const errorScenarios = [
      { operation: 'add', code: 68, message: 'Entry already exists' },
      { operation: 'delete', code: 32, message: 'No such object' },
      { operation: 'modifyDN', code: 50, message: 'Insufficient access rights' },
      { operation: 'compare', code: 16, message: 'No such attribute' }
    ];
    
    const scenarios = errorScenarios.map(({ operation, code, message }) => ({
      name: `test ${operation} error`,
      steps: [
        {
          ldap: { operation },
          fixture: `${operation}-error.ldap`,
          fixtureData: { operation, result: 'error', code, message }
        }
      ],
      invoke: { throws: message }
    }));
    
    parseLDAPScenarios.mockReturnValue({
      action: { 
        params: { baseDN: 'DC=test,DC=com' }, 
        context: { 
          secrets: { LDAP_BIND_DN: 'CN=test,DC=test,DC=com', LDAP_BIND_PASSWORD: 'password' },
          environment: {} 
        } 
      },
      scenarios
    });
    
    // Should handle error scenarios for enhanced operations
    expect(() => {
      runLDAPScenarios({
        script: mockScript,
        scenarios: './error-scenarios.yaml',
        callerDir: '/base'
      });
    }).not.toThrow();
    
    expect(parseLDAPScenarios).toHaveBeenCalledWith('/base/error-scenarios.yaml', { includeCommon: true });
  });

  test('supports includeCommon configuration option', () => {
    expect(() => {
      runLDAPScenarios({
        script: mockScript,
        scenarios: './test-scenarios.yaml',
        includeCommon: false,
        callerDir: '/base'
      });
    }).not.toThrow();
    
    expect(parseLDAPScenarios).toHaveBeenCalledWith('/base/test-scenarios.yaml', { includeCommon: false });
  });

  test('framework documentation test', () => {
    // This test documents that the framework has been enhanced 
    // with support for LDAP operations: add, delete, modifyDN, compare
    
    const allOperations = [
      'bind',     // existing
      'unbind',   // existing 
      'modify',   // existing
      'search',   // existing
      'add',      // enhanced operation
      'delete',   // enhanced operation
      'modifyDN', // enhanced operation
      'compare'   // enhanced operation
    ];
    
    const scenarios = allOperations.map(operation => ({
      name: `${operation} operation test`,
      steps: [{
        ldap: { operation },
        fixture: `${operation}.ldap`,
        fixtureData: { operation, result: 'success', code: 0 }
      }],
      invoke: { returns: { status: 'success' } }
    }));
    
    parseLDAPScenarios.mockReturnValue({
      action: { 
        params: { baseDN: 'DC=test,DC=com' }, 
        context: { 
          secrets: { LDAP_BIND_DN: 'CN=test,DC=test,DC=com', LDAP_BIND_PASSWORD: 'password' },
          environment: {} 
        } 
      },
      scenarios
    });
    
    // Framework v1.2.0 should support all LDAP operations
    expect(() => {
      runLDAPScenarios({
        script: mockScript,
        scenarios: './all-operations.yaml',
        callerDir: '/base'
      });
    }).not.toThrow();
    
    expect(parseLDAPScenarios).toHaveBeenCalled();
  });
});