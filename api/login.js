// GET /api/login — redirects the user to Google's OAuth consent screen
module.exports = function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send('GOOGLE_CLIENT_ID environment variable is not set.');
  }

  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host  = req.headers.host;
  const redirectUri = `${proto}://${host}/api/callback`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email https://www.googleapis.com/auth/cloud-platform',
    access_type:   'online',
    prompt:        'select_account',
  });

  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
