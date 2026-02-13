/**
 * Assert that calling invoke returns an object containing all expected key/value pairs.
 *
 * @param {Function} invokeFn - Async function to call (bound with params, context)
 * @param {Object} expected - Key/value pairs the return object must contain
 * @returns {Promise<Object>} The actual return value
 */
export async function assertInvokeReturns(invokeFn, expected) {
  const result = await invokeFn();

  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) {
      throw new Error(
        `Expected invoke result.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(result[key])}`
      );
    }
  }

  return result;
}

/**
 * Assert that calling invoke throws an error whose message contains the expected string.
 *
 * @param {Function} invokeFn - Async function to call (bound with params, context)
 * @param {string} expectedMessage - Substring that must appear in the error message
 * @returns {Promise<Error>} The caught error
 */
export async function assertInvokeThrows(invokeFn, expectedMessage) {
  let caught;
  try {
    await invokeFn();
  } catch (error) {
    caught = error;
  }

  if (!caught) {
    throw new Error('Expected invoke to throw, but it returned successfully');
  }

  if (expectedMessage && !caught.message.includes(expectedMessage)) {
    throw new Error(
      `Expected error message to contain "${expectedMessage}", got "${caught.message}"`
    );
  }

  return caught;
}

/**
 * Assert that calling the error handler returns an object containing all expected key/value pairs.
 *
 * @param {Function} errorFn - Async error handler function
 * @param {Object} expected - Key/value pairs the return object must contain
 * @returns {Promise<Object>} The actual return value
 */
export async function assertErrorReturns(errorFn, expected) {
  const result = await errorFn();

  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) {
      throw new Error(
        `Expected error handler result.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(result[key])}`
      );
    }
  }

  return result;
}

/**
 * Assert that calling the error handler throws an error whose message contains the expected string.
 *
 * @param {Function} errorFn - Async error handler function
 * @param {string} expectedMessage - Substring that must appear in the error message
 * @returns {Promise<Error>} The caught error
 */
export async function assertErrorThrows(errorFn, expectedMessage) {
  let caught;
  try {
    await errorFn();
  } catch (error) {
    caught = error;
  }

  if (!caught) {
    throw new Error('Expected error handler to throw, but it returned successfully');
  }

  if (expectedMessage && !caught.message.includes(expectedMessage)) {
    throw new Error(
      `Expected error message to contain "${expectedMessage}", got "${caught.message}"`
    );
  }

  return caught;
}

/**
 * Run invoke and optionally error handlers for a scenario, asserting results.
 *
 * Flow:
 *   1. Call script.invoke(params, context)
 *   2. If scenario.invoke.returns: assert return value matches
 *   3. If scenario.invoke.throws: assert it threw with matching message, then:
 *      a. If scenario.error.returns: call script.error({...params, error}, context), assert return
 *      b. If scenario.error.throws: call script.error(...), assert it re-throws
 *      c. If no scenario.error: skip (framework handles retry)
 *
 * @param {Object} script - The action module with invoke/error handlers
 * @param {Object} params - Merged params for this scenario
 * @param {Object} context - Merged context for this scenario
 * @param {Object} scenario - The scenario definition with invoke/error expectations
 */
export async function runScenarioHandlers(script, params, context, scenario) {
  const { invoke: invokeExpect, error: errorExpect } = scenario;

  if (invokeExpect.returns) {
    // Expect invoke to succeed
    await assertInvokeReturns(
      () => script.invoke(params, context),
      invokeExpect.returns
    );
    return;
  }

  if (invokeExpect.throws !== undefined) {
    // Expect invoke to throw
    const caughtError = await assertInvokeThrows(
      () => script.invoke(params, context),
      invokeExpect.throws
    );

    // If there's an error expectation and the script has an error handler, run it
    if (errorExpect && script.error) {
      const errorParams = { ...params, error: caughtError };

      if (errorExpect.returns) {
        await assertErrorReturns(
          () => script.error(errorParams, context),
          errorExpect.returns
        );
      } else if (errorExpect.throws !== undefined) {
        await assertErrorThrows(
          () => script.error(errorParams, context),
          errorExpect.throws
        );
      }
    }
  }
}
