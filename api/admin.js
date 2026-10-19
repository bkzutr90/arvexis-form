const crypto = require('crypto');
const { KEY, db, allTeams, body } = require('./_lib');
const { setStatus } = require('./_discord');
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const token = () => crypto.createHash('sha256').update('arvexis:' + process.env.ADMIN_PASSWORD).digest('hex');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD belum diatur di Vercel.' });
  try {
    const b = body(req);
    if (b.action === 'login') {
      if (!same(b.password || '', process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: 'Password salah.' });
      return res.json({ token: token() });
    }
    if (!same((req.headers.authorization || '').replace('Bearer ', ''), token())) return res.status(401).json({ error: 'Sesi berakhir.' });

    if (b.action === 'list') return res.json({ teams: await allTeams() });
    if (b.action === 'status') {
      if (!['pending', 'approved', 'rejected'].includes(b.status)) return res.status(400).json({ error: 'Status tidak valid.' });
      const rec = await setStatus(b.id, b.status, 'Web Admin');
      if (!rec) return res.status(404).json({ error: 'Data tidak ditemukan.' });
      return res.json({ ok: true });
    }
    if (b.action === 'delete') { await db(['HDEL', KEY, b.id]); return res.json({ ok: true }); }
    res.status(400).json({ error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
