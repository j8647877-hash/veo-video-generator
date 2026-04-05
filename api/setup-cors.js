// POST /api/setup-cors — configures CORS on the GCS bucket so the browser can fetch videos inline.
// Called once after sign-in. The config persists on the bucket so subsequent sessions skip this.
module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const bucket     = process.env.GOOGLE_GCS_BUCKET;

  if (!authHeader || !bucket) {
    return res.status(400).json({ error: 'Missing authorization or bucket config' });
  }

  const proto  = req.headers['x-forwarded-proto'] || 'http';
  const host   = req.headers.host;
  const origin = `${proto}://${host}`;

  const upstream = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': authHeader,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        cors: [{
          origin:         [origin, 'http://localhost:3000'],
          method:         ['GET'],
          responseHeader: ['Content-Type', 'Content-Length', 'Range'],
          maxAgeSeconds:  3600,
        }],
      }),
    }
  );

  if (!upstream.ok) {
    const text = await upstream.text();
    return res.status(upstream.status).json({ error: text });
  }

  return res.status(200).json({ ok: true });
};
