const crypto = require('crypto');
const { KEY, EKEY, AKEY, db, body, err, allTeams, allEvents, activeEvent, evOf, counted, limited, validateTeam } = require('./_lib');
const D = require('./_discord');
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const token = () => crypto.createHash('sha256').update('arvexis:' + process.env.ADMIN_PASSWORD).digest('hex');
const getTeam = async id => { const raw = await db(['HGET', KEY, id]); if (!raw) throw err(404, 'Data tidak ditemukan.'); return JSON.parse(raw); };
const save = rec => db(['HSET', KEY, rec.id, JSON.stringify(rec)]);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD belum diatur di Vercel.' });
  try {
    const b = body(req);
    if (b.action === 'login') {
      if (await limited(req, 'login', 8, 600)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.' });
      if (!same(b.password || '', process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: 'Password salah.' });
      return res.json({ token: token() });
    }
    if (!same((req.headers.authorization || '').replace('Bearer ', ''), token())) return res.status(401).json({ error: 'Sesi berakhir.' });

    if (b.action === 'list') return res.json({ teams: await allTeams(), events: await allEvents(), active: (await activeEvent()).id });

    if (b.action === 'status') {
      if (!['pending', 'approved', 'rejected'].includes(b.status)) return res.status(400).json({ error: 'Status tidak valid.' });
      const rec = await D.setStatus(b.id, b.status, 'Web Admin');
      if (!rec) return res.status(404).json({ error: 'Data tidak ditemukan.' });
      return res.json({ ok: true, team: rec });
    }
    if (b.action === 'update') { // edit data tim
      const rec = await getTeam(b.id);
      const others = counted(await allTeams(evOf(rec))).filter(t => t.id !== rec.id);
      Object.assign(rec, await validateTeam(b, others));
      if (rec.status === 'approved') rec.prov = (await D.provision(rec)) || rec.prov; // nama role/channel & anggota ikut diperbarui
      await save(rec); await D.syncMessage(rec);
      return res.json({ ok: true, team: rec });
    }
    if (b.action === 'sync') { // beri ulang role (mis. pemain baru join server)
      const rec = await getTeam(b.id);
      if (rec.status !== 'approved') throw err(400, 'Hanya tim approved yang bisa disinkronkan.');
      rec.prov = (await D.provision(rec)) || rec.prov;
      await save(rec);
      return res.json({ ok: true, team: rec });
    }
    if (b.action === 'delete') {
      const raw = await db(['HGET', KEY, b.id]);
      if (raw) await D.deprovision(JSON.parse(raw));
      await db(['HDEL', KEY, b.id]);
      return res.json({ ok: true });
    }
    if (b.action === 'event_save') {
      const e = b.event || {}, name = String(e.name || '').trim().slice(0, 60);
      if (!name) throw err(400, 'Nama event wajib diisi.');
      const max = Math.max(1, Math.min(256, parseInt(e.max, 10) || 16));
      const ok = v => (v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');
      const url = String(e.rulesUrl || '').trim();
      const ev = {
        id: e.id || 'fm' + Date.now().toString(36), name, max, open: e.open !== false,
        opensAt: ok(e.opensAt), closesAt: ok(e.closesAt), prize: String(e.prize || '').trim().slice(0, 120),
        schedule: (e.schedule || []).map(s => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 12),
        rulesUrl: /^https?:\/\//.test(url) ? url : '', createdAt: e.createdAt || new Date().toISOString(),
      };
      await db(['HSET', EKEY, ev.id, JSON.stringify(ev)]);
      if (b.activate || !e.id) await db(['SET', AKEY, ev.id]);
      return res.json({ ok: true, id: ev.id });
    }
    if (b.action === 'cleanup') { // hapus role & channel semua tim di satu event (setelah event selesai)
      const teams = (await allTeams(b.event)).filter(t => t.prov);
      for (const t of teams) { await D.deprovision(t); delete t.prov; await save(t); }
      return res.json({ ok: true, count: teams.length });
    }
    res.status(400).json({ error: 'Aksi tidak dikenal.' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
