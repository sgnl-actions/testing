import { jest, expect as jestExpect } from '@jest/globals';
import {
  assertInvokeReturns,
  assertInvokeThrows,
  assertErrorReturns,
  assertErrorThrows,
  runScenarioHandlers
} from '../src/assertions.mjs';

describe('assertInvokeReturns', () => {
  test('passes when all expected keys match', async () => {
    const invoke = async () => ({ userId: 'usr123', suspended: true, status: 'SUSPENDED' });
    const expected = { userId: 'usr123', suspended: true };

    await expect(assertInvokeReturns(invoke, expected)).resolves.not.toThrow();
  });

  test('returns the actual result', async () => {
    const invoke = async () => ({ userId: 'usr123', extra: 'data' });
    const expected = { userId: 'usr123' };

    const result = await assertInvokeReturns(invoke, expected);
    expect(result).toEqual({ userId: 'usr123', extra: 'data' });
  });

  test('fails when a key value does not match', async () => {
    const invoke = async () => ({ userId: 'usr123', suspended: false });
    const expected = { suspended: true };

    await expect(assertInvokeReturns(invoke, expected)).rejects.toThrow();
  });

  test('fails when expected key is missing from result', async () => {
    const invoke = async () => ({ userId: 'usr123' });
    const expected = { suspended: true };

    await expect(assertInvokeReturns(invoke, expected)).rejects.toThrow();
  });

  test('fails when invoke throws instead of returning', async () => {
    const invoke = async () => { throw new Error('unexpected error'); };
    const expected = { userId: 'usr123' };

    await expect(assertInvokeReturns(invoke, expected)).rejects.toThrow('unexpected error');
  });
});

describe('assertInvokeThrows', () => {
  test('passes when error message contains expected string', async () => {
    const invoke = async () => { throw new Error('Failed: HTTP 429 Too Many Requests'); };

    const caught = await assertInvokeThrows(invoke, '429');
    expect(caught.message).toContain('429');
  });

  test('returns the thrown error', async () => {
    const error = new Error('HTTP 401 Unauthorized');
    error.statusCode = 401;
    const invoke = async () => { throw error; };

    const caught = await assertInvokeThrows(invoke, '401');
    expect(caught.statusCode).toBe(401);
  });

  test('passes with empty string match (any error)', async () => {
    const invoke = async () => { throw new Error('anything'); };

    const caught = await assertInvokeThrows(invoke, '');
    expect(caught.message).toBe('anything');
  });

  test('fails when invoke does not throw', async () => {
    const invoke = async () => ({ ok: true });

    await expect(assertInvokeThrows(invoke, '429')).rejects.toThrow('Expected invoke to throw');
  });

  test('fails when error message does not contain expected string', async () => {
    const invoke = async () => { throw new Error('HTTP 500 Internal Server Error'); };

    await expect(assertInvokeThrows(invoke, '429')).rejects.toThrow('Expected error message to contain "429"');
  });
});

describe('assertErrorReturns', () => {
  test('passes when error handler returns expected values', async () => {
    const errorHandler = async () => ({ status: 'retry_requested' });
    const expected = { status: 'retry_requested' };

    await expect(assertErrorReturns(errorHandler, expected)).resolves.not.toThrow();
  });

  test('returns the actual result', async () => {
    const errorHandler = async () => ({ status: 'recovered', extra: 'data' });
    const expected = { status: 'recovered' };

    const result = await assertErrorReturns(errorHandler, expected);
    expect(result).toEqual({ status: 'recovered', extra: 'data' });
  });

  test('fails when error handler throws instead of returning', async () => {
    const errorHandler = async () => { throw new Error('fatal'); };
    const expected = { status: 'recovered' };

    await expect(assertErrorReturns(errorHandler, expected)).rejects.toThrow('fatal');
  });
});

describe('assertErrorThrows', () => {
  test('passes when error handler re-throws with matching message', async () => {
    const errorHandler = async () => { throw new Error('HTTP 401 Unauthorized'); };

    const caught = await assertErrorThrows(errorHandler, '401');
    expect(caught.message).toContain('401');
  });

  test('fails when error handler does not throw', async () => {
    const errorHandler = async () => ({ status: 'recovered' });

    await expect(assertErrorThrows(errorHandler, '401')).rejects.toThrow('Expected error handler to throw');
  });

  test('fails when error message does not match', async () => {
    const errorHandler = async () => { throw new Error('HTTP 500'); };

    await expect(assertErrorThrows(errorHandler, '401')).rejects.toThrow('Expected error message to contain "401"');
  });
});

describe('runScenarioHandlers', () => {
  test('runs invoke that returns successfully', async () => {
    const script = {
      invoke: async () => ({ userId: 'usr123', status: 'SUSPENDED' })
    };

    const scenario = {
      invoke: { returns: { userId: 'usr123' } }
    };

    await runScenarioHandlers(script, { userId: 'usr123' }, {}, scenario);
  });

  test('runs invoke that throws, then error handler that returns', async () => {
    const invokeError = new Error('HTTP 429');
    const script = {
      invoke: async () => { throw invokeError; },
      error: async () => ({ status: 'retry_requested' })
    };

    const scenario = {
      invoke: { throws: '429' },
      error: { returns: { status: 'retry_requested' } }
    };

    await runScenarioHandlers(script, { userId: 'usr123' }, {}, scenario);
  });

  test('runs invoke that throws, then error handler that throws', async () => {
    const invokeError = new Error('HTTP 401');
    const script = {
      invoke: async () => { throw invokeError; },
      error: async (params) => { throw params.error; }
    };

    const scenario = {
      invoke: { throws: '401' },
      error: { throws: '401' }
    };

    await runScenarioHandlers(script, { userId: 'usr123' }, {}, scenario);
  });

  test('runs invoke that throws, no error section - skips error handler', async () => {
    const script = {
      invoke: async () => { throw new Error('HTTP 500'); }
    };

    const scenario = {
      invoke: { throws: '500' }
      // no error section
    };

    await runScenarioHandlers(script, {}, {}, scenario);
  });

  test('passes error to error handler in params', async () => {
    const invokeError = new Error('HTTP 429');
    let receivedParams;

    const script = {
      invoke: async () => { throw invokeError; },
      error: async (params, ctx) => {
        receivedParams = params;
        return { status: 'retry_requested' };
      }
    };

    const scenario = {
      invoke: { throws: '429' },
      error: { returns: { status: 'retry_requested' } }
    };

    await runScenarioHandlers(script, { userId: 'usr123' }, { secrets: {} }, scenario);

    expect(receivedParams.error).toBe(invokeError);
    expect(receivedParams.userId).toBe('usr123');
  });
});
