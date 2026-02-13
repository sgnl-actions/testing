import nock from 'nock';

/**
 * Map HTTP method string to the corresponding nock interceptor method.
 */
const METHOD_MAP = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
  HEAD: 'head',
  OPTIONS: 'options'
};

/**
 * Set up nock interceptors for a list of scenario steps.
 *
 * Each step defines an expected HTTP request and either:
 *   - fixtureData: { statusCode, headers, body } to reply with
 *   - networkError: true to simulate a connection failure
 *
 * @param {Array} steps - Scenario steps with request + fixture/networkError
 * @returns {Array<nock.Scope>} Array of nock scopes (call .done() to verify)
 */
export function setupNock(steps) {
  const scopes = [];

  for (const step of steps) {
    const { request, fixtureData, networkError } = step;
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname + url.search;
    const method = METHOD_MAP[request.method.toUpperCase()];

    if (!method) {
      throw new Error(`Unsupported HTTP method: ${request.method}`);
    }

    let scope = nock(origin);

    // Set up header matching if specified
    const interceptor = request.headers
      ? scope[method](path, undefined, { reqheaders: request.headers })
      : scope[method](path);

    if (networkError) {
      interceptor.replyWithError('Network error: connection refused');
      scopes.push(scope);
    } else if (fixtureData) {
      interceptor.reply(
        fixtureData.statusCode,
        fixtureData.body,
        fixtureData.headers
      );
      scopes.push(scope);
    } else {
      throw new Error(`Step for ${request.method} ${request.url} has no fixtureData or networkError`);
    }
  }

  return scopes;
}

/**
 * Clean up all nock interceptors and restore network connectivity.
 */
export function cleanupNock() {
  nock.cleanAll();
  nock.enableNetConnect();
}
