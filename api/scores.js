const crypto = require('crypto');
const { db, body, limited } = require('./_lib');
const SKEY = 'arvexis:scores';
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const token = () => crypto.createHash('sha256').update('arvexis:' + process.env.ADMIN_PASSWORD).digest('hex');

const num = v => (v === '' || v == null || isNaN(+v) ? '' : Math.max(0, Math.min(13, Math.round(+v))));
const side = x => ({ n: String(x?.n || '').trim().slice(0, 40), s: [num(x?.s?.[0]), num(x?.s?.[1])] });
const clean = m => ({ a: side(m?.a), b: side(m?.b), w: m?.w === 'a' || m?.w === 'b' ? m.w : '' });

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') { // publik
      const raw = await db(['GET', SKEY]);
      res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=5');
      return res.json(raw ? JSON.parse(raw) : { matches: null, updatedAt: null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD belum diatur.' });
    if (!same((req.headers.authorization || '').replace('Bearer ', ''), token())) return res.status(401).json({ error: 'Sesi berakhir.' });
    if (await limited(req, 'scores', 300, 600)) return res.status(429).json({ error: 'Terlalu banyak permintaan.' });
    const b = body(req);
    if (!Array.isArray(b.matches) || b.matches.length > 100) return res.status(400).json({ error: 'Data tidak valid.' });
    const data = { matches: b.matches.map(clean), updatedAt: new Date().toISOString() };
    await db(['SET', SKEY, JSON.stringify(data)]);
    res.json({ ok: true, updatedAt: data.updatedAt });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Terjadi kesalahan server.' }); }
};
