// POST /api/generate — forwards video generation request to Vertex AI
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vertex-Path');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const authHeader = req.headers['authorization'];
  const vertexPath = req.headers['x-vertex-path'];

  if (!authHeader || !vertexPath) {
    return res.status(400).json({ error: { message: 'Missing Authorization or X-Vertex-Path header' } });
  }

  const body = JSON.stringify(req.body);

  const upstream = await fetch(`https://aiplatform.googleapis.com${vertexPath}`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });

  const data = await upstream.json();
  return res.status(upstream.status).json(data);
};
