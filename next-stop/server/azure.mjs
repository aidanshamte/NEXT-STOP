// Access tokens from the Azure VM's managed identity (Instance Metadata Service).
// No keys or client secrets are stored on the server. Tokens are cached until
// five minutes before expiry.
const cache = new Map();

export async function managedIdentityToken(resource, fetchImpl = fetch) {
  const cached = cache.get(resource);
  if (cached && cached.expiresAt - 300000 > Date.now()) return cached.token;
  const response = await fetchImpl(
    `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${encodeURIComponent(resource)}`,
    { headers: { Metadata: 'true' }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw Error(`Managed identity token request failed (${response.status}).`);
  const body = await response.json();
  cache.set(resource, { token: body.access_token, expiresAt: Number(body.expires_on) * 1000 });
  return body.access_token;
}
