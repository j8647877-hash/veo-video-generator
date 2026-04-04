// GET /api/callback — OAuth callback: exchanges code for tokens and redirects back to the app
module.exports = async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(302, `/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(302, '/?auth_error=no_code');
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const projectId    = process.env.GOOGLE_PROJECT_ID || '';

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
    ...(data.id_token  ? { id_token:  data.id_token  } : {}),
    ...(projectId      ? { project:   projectId      } : {}),
  });

  res.redirect(302, `/#${fragment}`);
};
