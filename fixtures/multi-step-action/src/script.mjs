/**
 * Multi-step action: suspends a user then verifies the suspension.
 */
export default {
  invoke: async (params, context) => {
    const { userId, domain } = params;
    const authToken = context.secrets.API_TOKEN;
    const baseUrl = `https://${domain}`;
    const encodedUserId = encodeURIComponent(userId);

    // Step 1: Suspend the user
    const suspendResponse = await fetch(
      `${baseUrl}/api/v1/users/${encodedUserId}/lifecycle/suspend`,
      {
        method: 'POST',
        headers: {
          'Authorization': `SSWS ${authToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    if (!suspendResponse.ok) {
      throw new Error(`Failed to suspend user: HTTP ${suspendResponse.status}`);
    }

    // Step 2: Verify suspension
    const verifyResponse = await fetch(
      `${baseUrl}/api/v1/users/${encodedUserId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `SSWS ${authToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!verifyResponse.ok) {
      throw new Error(`Failed to verify user: HTTP ${verifyResponse.status}`);
    }

    const userData = await verifyResponse.json();

    return {
      userId,
      suspended: userData.status === 'SUSPENDED',
      status: userData.status
    };
  }
};
