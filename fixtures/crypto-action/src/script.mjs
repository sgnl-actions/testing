/**
 * Crypto action: signs a JWT via context.crypto.signJWT() and
 * sends it as a bearer token in a POST request.
 */
export default {
  invoke: async (params, context) => {
    const { subject, audience } = params;
    const receiverUrl = context.environment.ADDRESS;

    // Sign a JWT using the in-process crypto service
    const jwt = await context.crypto.signJWT(
      { sub: subject, aud: audience },
      { expiresIn: '5m' }
    );

    // Transmit the event with the signed JWT
    const response = await fetch(receiverUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ subject, audience })
    });

    if (!response.ok) {
      throw new Error(`Transmit failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    return { status: data.status, jwt };
  }
};
