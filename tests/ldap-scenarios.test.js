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
    // Clean up global mock.
    delete global.describe;
  });

  test('module exports runLDAPScenarios function', () => {
    expect(typeof runLDAPScenarios).toBe('function');
  });
});