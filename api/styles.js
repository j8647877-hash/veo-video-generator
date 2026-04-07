// /api/styles — CRUD for visual style templates stored in GCS under styles/ prefix
// GET    /api/styles              — list all saved styles (returns array of style objects)
// POST   /api/styles              — save a new style (body: style JSON)
// DELETE /api/styles?id=<object>  — delete a style by GCS object name (e.g. styles/uuid.json)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header.' });
  }

  const bucket = process.env.GOOGLE_GCS_BUCKET;
  if (!bucket) {
    return res.status(500).json({ error: 'GOOGLE_GCS_BUCKET env var not set.' });
  }

  const gcsBase = 'https://storage.googleapis.com/storage/v1';
  const gcsUpload = 'https://storage.googleapis.com/upload/storage/v1';
  const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

  // ── GET — list all styles ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const listUrl = `${gcsBase}/b/${bucket}/o?prefix=styles%2F&fields=items(name,timeCreated)`;
    const listRes = await fetch(listUrl, { headers });
    if (!listRes.ok) {
      const text = await listRes.text();
      return res.status(listRes.status).json({ error: text });
    }
    const listData = await listRes.json();
    const items = (listData.items || []).filter(it => it.name.endsWith('.json'));

    if (items.length === 0) return res.status(200).json({ styles: [] });

    // Fetch each style object in parallel
    const fetchStyle = async (item) => {
      const encoded = encodeURIComponent(item.name);
      const r = await fetch(`${gcsBase}/b/${bucket}/o/${encoded}?alt=media`, { headers });
      if (!r.ok) return null;
      try { return await r.json(); } catch { return null; }
    };

    const results = await Promise.all(items.map(fetchStyle));
    const styles = results.filter(Boolean);
    // Sort newest first
    styles.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.status(200).json({ styles });
  }

  // ── POST — save a new style ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const style = req.body;
    if (!style || !style.styleName) {
      return res.status(400).json({ error: 'Request body must be a style object with a styleName.' });
    }

    // Generate a simple unique ID
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const objectName = `styles/${id}.json`;

    const payload = {
      ...style,
      id,
      createdAt: new Date().toISOString(),
    };

    const uploadUrl = `${gcsUpload}/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return res.status(uploadRes.status).json({ error: text });
    }

    return res.status(201).json({ id, objectName, style: payload });
  }

  // ── DELETE — remove a style ───────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const objectName = req.query?.id || new URL(req.url, 'http://x').searchParams.get('id');
    if (!objectName) {
      return res.status(400).json({ error: 'Query param ?id=<object_name> required.' });
    }

    const encoded = encodeURIComponent(objectName);
    const delRes = await fetch(`${gcsBase}/b/${bucket}/o/${encoded}`, {
      method: 'DELETE',
      headers,
    });

    if (delRes.status === 404) return res.status(404).json({ error: 'Style not found.' });
    if (!delRes.ok) {
      const text = await delRes.text();
      return res.status(delRes.status).json({ error: text });
    }

    return res.status(200).json({ ok: true, deleted: objectName });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
