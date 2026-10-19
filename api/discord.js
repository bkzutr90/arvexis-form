const crypto = require('crypto');
const D = require('./_discord');
const { KEY, db } = require('./_lib');
// Jawaban "deferred" butuh waitUntil (npm i @vercel/functions). Tanpa paket itu, jalan seperti biasa (sinkron).
let waitUntil; try { ({ waitUntil } = require('@vercel/functions')); } catch {}

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
function verify(body, sig, ts) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(ts), body]), key, Buffer.from(sig, 'hex'));
  } catch { return false; }
}
const readRaw = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const allowed = m => (BigInt(m.permissions || 0) & 0x28n) !== 0n || (process.env.DISCORD_ADMIN_ROLE_ID && (m.roles || []).includes(process.env.DISCORD_ADMIN_ROLE_ID));

// Hasil kerja: { k:'eph', c } pesan rahasia | { k:'upd', d } ubah pesan tombol | { k:'msg', d } pesan publik
const E = c => ({ k: 'eph', c });
async function work(i) {
  try {
    const who = `<@${i.member.user.id}>`;
    const [act, id] = i.data.custom_id.split(':');
    const raw = await db(['HGET', KEY, id]);
    if (!raw) return E('Data tim tidak ditemukan (mungkin sudah dihapus dari admin).');
    const rec = JSON.parse(raw);
    if (rec.status !== 'pending') return E(`Tim ini sudah berstatus ${rec.status}.`);

    const finish = async (status, members) => {
      const r = await D.setStatus(id, status, who, { skipSync: true, members });
      return { k: 'upd', d: { embeds: [D.embed(r)], components: [], allowed_mentions: { parse: [] } } };
    };
    if (act === 'no') return finish('rejected');
    if (act === 'force') return finish('approved');

    const results = await D.checkMembers(rec);
    if (results.some(r => r.member === undefined))
      return E('⚠️ Gagal mengecek member. Pastikan bot ada di server, DISCORD_GUILD_ID benar, dan Server Members Intent aktif. Kamu masih bisa pakai "Approve tanpa cek".');
    const missing = results.filter(r => !r.member);
    if (!missing.length) return finish('approved', results);

    const names = missing.map(m => `• ${m.p.discord}`).join('\n');
    const found = results.find(r => r.member);
    if (!found) return E(`⏸️ Belum di-approve. Belum join:\n${names}\nTidak ada pemain tim ini yang ditemukan di server, jadi tidak ada yang bisa di-mention. Hubungi tim lewat cara lain.`);
    const msg = D.blocked(rec, found.member.user.id, who, missing);
    const chan = process.env.DISCORD_NOTIFY_CHANNEL_ID;
    if (!chan) return { k: 'msg', d: msg };
    const r = await D.bot(`/channels/${chan}/messages`, 'POST', msg);
    if (!r.ok) {
      console.error('Kirim mention gagal:', r.status, await r.text());
      return E(`⚠️ Gagal mengirim mention ke <#${chan}> (kode ${r.status}). Pastikan DISCORD_NOTIFY_CHANNEL_ID benar dan bot punya izin View Channel + Send Messages di channel itu.`);
    }
    return E(`⏸️ Belum di-approve. Belum join:\n${names}\nPemain ${found.p.discord} sudah di-mention di <#${chan}>.`);
  } catch (e) {
    console.error(e);
    return E('Terjadi kesalahan: ' + e.message);
  }
}
const inline = (res, o) => res.status(200).json(
  o.k === 'upd' ? { type: 7, data: o.d } : o.k === 'msg' ? { type: 4, data: o.d } : { type: 4, data: { content: o.c, flags: 64 } });
async function later(i, o) {
  const url = `https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`;
  const send = (u, method, data) => fetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const r = o.k === 'upd' ? await send(url + '/messages/@original', 'PATCH', o.d) : await send(url, 'POST', o.k === 'msg' ? o.d : { content: o.c, flags: 64 });
  if (!r.ok) console.error('Followup gagal:', r.status, await r.text());
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readRaw(req);
  if (!verify(body, req.headers['x-signature-ed25519'] || '', req.headers['x-signature-timestamp'] || '')) return res.status(401).end('invalid signature');
  const i = JSON.parse(body.toString());
  if (i.type === 1) return res.status(200).json({ type: 1 });
  if (i.type !== 3) return res.status(400).end();
  if (!allowed(i.member)) return inline(res, E('⛔ Kamu tidak punya izin untuk mengelola pendaftaran.'));
  if (waitUntil) { // balas < 3 detik, kerja berat jalan di belakang
    waitUntil(work(i).then(o => later(i, o)).catch(e => console.error('Deferred gagal', e)));
    return res.status(200).json({ type: 6 });
  }
  return inline(res, await work(i));
};
module.exports.config = { api: { bodyParser: false } };
module.exports._verify = verify;
