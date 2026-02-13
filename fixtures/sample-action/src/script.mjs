/**
 * Sample action for testing the framework.
 * Suspends a user via a REST API.
 */
async function suspendUser(userId, baseUrl, authToken) {
  const encodedUserId = encodeURIComponent(userId);
  const url = `${baseUrl}/api/v1/users/${encodedUserId}/lifecycle/suspend`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `SSWS ${authToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  return response;
}

export default {
  invoke: async (params, context) => {
    const { userId, domain } = params;
    const authToken = context.secrets.API_TOKEN;

    if (!userId) {
      throw new Error('userId is required');
    }
    if (!domain) {
      throw new Error('domain is required');
    }
    if (!authToken) {
      throw new Error('API_TOKEN is required');
    }

    const baseUrl = `https://${domain}`;
    const response = await suspendUser(userId, baseUrl, authToken);

    if (!response.ok) {
      const statusCode = response.status;
      let errorMessage = `Failed to suspend user: HTTP ${statusCode}`;

      try {
        const errorBody = await response.json();
        if (errorBody.errorSummary) {
          errorMessage = `Failed to suspend user: ${errorBody.errorSummary}`;
        }
      } catch {
        // Response might not be JSON
      }

      const error = new Error(errorMessage);
      error.statusCode = statusCode;
      throw error;
    }

    let userData = {};
    try {
      userData = await response.json();
    } catch {
      // Response might not have JSON body
    }

    return {
      userId,
      suspended: true,
      status: userData.status || 'SUSPENDED'
    };
  },

  error: async (params, _context) => {
    const { error } = params;

    // Fatal: Auth errors should not retry
    if (error.statusCode === 401 || error.statusCode === 403) {
      throw error;
    }

    // Default: Let framework retry
    return { status: 'retry_requested' };
  },

  halt: async (params, _context) => {
    return {
      userId: params.userId || 'unknown',
      reason: params.reason,
      haltedAt: new Date().toISOString(),
      cleanupCompleted: true
    };
  }
};
