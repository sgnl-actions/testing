import { jest } from '@jest/globals';
import { setupNock, cleanupNock } from '../src/setup-nock.mjs';
import nock from 'nock';

describe('setupNock', () => {
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test('sets up a single GET interceptor from step with fixtureData', async () => {
    const steps = [{
      request: {
        method: 'GET',
        url: 'https://api.example.com/users/123'
      },
      fixtureData: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"id":"123","name":"Test"}'
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ id: '123', name: 'Test' });
    expect(scopes).toHaveLength(1);
    scopes.forEach(s => s.done());
  });

  test('sets up a POST interceptor from step with fixtureData', async () => {
    const steps = [{
      request: {
        method: 'POST',
        url: 'https://api.example.com/users/123/lifecycle/suspend'
      },
      fixtureData: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"id":"123","status":"SUSPENDED"}'
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123/lifecycle/suspend', {
      method: 'POST'
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('SUSPENDED');
    scopes.forEach(s => s.done());
  });

  test('sets up multiple interceptors for multi-step scenarios', async () => {
    const steps = [
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/users/123/lifecycle/suspend'
        },
        fixtureData: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: '{"status":"SUSPENDED"}'
        }
      },
      {
        request: {
          method: 'GET',
          url: 'https://api.example.com/users/123'
        },
        fixtureData: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: '{"id":"123","status":"SUSPENDED"}'
        }
      }
    ];

    const scopes = setupNock(steps);

    // First request
    const res1 = await fetch('https://api.example.com/users/123/lifecycle/suspend', {
      method: 'POST'
    });
    expect(res1.status).toBe(200);

    // Second request
    const res2 = await fetch('https://api.example.com/users/123');
    const data = await res2.json();
    expect(data.status).toBe('SUSPENDED');

    scopes.forEach(s => s.done());
  });

  test('sets up error status responses', async () => {
    const steps = [{
      request: {
        method: 'POST',
        url: 'https://api.example.com/users/123/lifecycle/suspend'
      },
      fixtureData: {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
        body: '{"error":"Rate limit exceeded"}'
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123/lifecycle/suspend', {
      method: 'POST'
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    scopes.forEach(s => s.done());
  });

  test('sets up network error when networkError is true', async () => {
    const steps = [{
      request: {
        method: 'POST',
        url: 'https://api.example.com/users/123/lifecycle/suspend'
      },
      networkError: true
    }];

    const scopes = setupNock(steps);

    await expect(
      fetch('https://api.example.com/users/123/lifecycle/suspend', { method: 'POST' })
    ).rejects.toThrow();

    scopes.forEach(s => s.done());
  });

  test('matches request headers when specified', async () => {
    const steps = [{
      request: {
        method: 'POST',
        url: 'https://api.example.com/users/123/lifecycle/suspend',
        headers: {
          'Authorization': 'SSWS test-token'
        }
      },
      fixtureData: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}'
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123/lifecycle/suspend', {
      method: 'POST',
      headers: { 'Authorization': 'SSWS test-token' }
    });

    expect(response.status).toBe(200);
    scopes.forEach(s => s.done());
  });

  test('handles DELETE method', async () => {
    const steps = [{
      request: {
        method: 'DELETE',
        url: 'https://api.example.com/users/123'
      },
      fixtureData: {
        statusCode: 204,
        headers: {},
        body: ''
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123', { method: 'DELETE' });
    expect(response.status).toBe(204);
    scopes.forEach(s => s.done());
  });

  test('handles PUT method', async () => {
    const steps = [{
      request: {
        method: 'PUT',
        url: 'https://api.example.com/users/123'
      },
      fixtureData: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"updated":true}'
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123', {
      method: 'PUT',
      body: JSON.stringify({ name: 'updated' })
    });
    expect(response.status).toBe(200);
    scopes.forEach(s => s.done());
  });

  test('handles PATCH method', async () => {
    const steps = [{
      request: {
        method: 'PATCH',
        url: 'https://api.example.com/users/123'
      },
      fixtureData: {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"patched":true}'
      }
    }];

    const scopes = setupNock(steps);

    const response = await fetch('https://api.example.com/users/123', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'patched' })
    });
    expect(response.status).toBe(200);
    scopes.forEach(s => s.done());
  });
});

describe('cleanupNock', () => {
  test('cleans up all nock interceptors', () => {
    nock('https://api.example.com').get('/test').reply(200);

    expect(nock.pendingMocks().length).toBe(1);

    cleanupNock();

    expect(nock.pendingMocks().length).toBe(0);
  });
});
