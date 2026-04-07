// /api/callback — OAuth callback + token refresh
//
// GET  /api/callback?code=...         — exchange auth code for tokens (standard OAuth callback)
// POST /api/callback?action=refresh   — exchange refresh_token for a new access_token

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const projectId    = process.env.GOOGLE_PROJECT_ID || '';

  // ── POST ?action=refresh — token refresh ─────────────────────────────────
  const url    = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');

  if (req.method === 'POST' && action === 'refresh') {
    const { refresh_token } = req.body || {};
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token,
        grant_type:    'refresh_token',
      }),
    });

    const data = await tokenRes.json();

    if (!data.access_token) {
      return res.status(tokenRes.status || 401).json({
        error: data.error_description || data.error || 'Token refresh failed',
      });
    }

    return res.status(200).json({
      access_token: data.access_token,
      expires_in:   data.expires_in || 3600,
      ...(data.id_token ? { id_token: data.id_token } : {}),
    });
  }

  // ── GET — standard OAuth callback ────────────────────────────────────────
  const { code, error } = req.query;

  if (error) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(302, '/?auth_error=no_code');
  }

  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host  = req.headers.host;
  const redirectUri = `${proto}://${host}/api/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });

  const data = await tokenRes.json();

  if (!data.access_token) {
    const msg = data.error_description || data.error || 'Authentication failed';
    return res.redirect(302, `/?auth_error=${encodeURIComponent(msg)}`);
  }

  // Pass tokens to the frontend via URL fragment (never sent to any server)
  const fragment = new URLSearchParams({
    access_token: data.access_token,
    ...(data.id_token       ? { id_token:       data.id_token       } : {}),
    ...(data.refresh_token  ? { refresh_token:  data.refresh_token  } : {}),
    ...(data.expires_in     ? { expires_in:     String(data.expires_in) } : {}),
    ...(projectId           ? { project:        projectId           } : {}),
  });

  res.redirect(302, `/#${fragment}`);
};
