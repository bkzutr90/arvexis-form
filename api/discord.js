const crypto = require('crypto');
const D = require('./_discord');
const { KEY, db } = require('./_lib');

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
function verify(body, sig, ts) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(ts), body]), key, Buffer.from(sig, 'hex'));
  } catch { return false; }
}
const readRaw = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const eph = (res, content) => res.status(200).json({ type: 4, data: { content, flags: 64 } });
const allowed = m => (BigInt(m.permissions || 0) & 0x28n) !== 0n || (process.env.DISCORD_ADMIN_ROLE_ID && (m.roles || []).includes(process.env.DISCORD_ADMIN_ROLE_ID));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const body = await readRaw(req);
  if (!verify(body, req.headers['x-signature-ed25519'] || '', req.headers['x-signature-timestamp'] || '')) return res.status(401).end('invalid signature');
  const i = JSON.parse(body.toString());
  if (i.type === 1) return res.status(200).json({ type: 1 });
  if (i.type !== 3) return res.status(400).end();
  try {
    if (!allowed(i.member)) return eph(res, '⛔ Kamu tidak punya izin untuk mengelola pendaftaran.');
    const who = `<@${i.member.user.id}>`;
    const [act, id] = i.data.custom_id.split(':');
    const raw = await db(['HGET', KEY, id]);
    if (!raw) return eph(res, 'Data tim tidak ditemukan (mungkin sudah dihapus dari admin).');
    const rec = JSON.parse(raw);
    if (rec.status !== 'pending') return eph(res, `Tim ini sudah berstatus ${rec.status}.`);

    const finish = async status => {
      const r = await D.setStatus(id, status, who, { skipSync: true });
      return res.status(200).json({ type: 7, data: { embeds: [D.embed(r)], components: [], allowed_mentions: { parse: [] } } });
    };
    if (act === 'no') return finish('rejected');
    if (act === 'force') return finish('approved');

    const results = await D.checkMembers(rec);
    if (results.some(r => r.member === undefined))
      return eph(res, '⚠️ Gagal mengecek member. Pastikan bot ada di server, DISCORD_GUILD_ID benar, dan Server Members Intent aktif. Kamu masih bisa pakai "Approve tanpa cek".');
    const missing = results.filter(r => !r.member);
    if (!missing.length) return finish('approved');

    const names = missing.map(m => `• ${m.p.discord}`).join('\n');
    const found = results.find(r => r.member);
    if (!found) return eph(res, `⏸️ Belum di-approve. Belum join:\n${names}\nTidak ada pemain tim ini yang ditemukan di server, jadi tidak ada yang bisa di-mention. Hubungi tim lewat cara lain.`);
    const invite = process.env.DISCORD_INVITE_URL ? `\nLink invite: <${process.env.DISCORD_INVITE_URL}>` : '';
    const uid = found.member.user.id;
    const content = `<@${uid}> pendaftaran tim **${rec.team}** belum bisa di-approve (dicek oleh ${who}). Anggota berikut belum bergabung ke Discord Arvexis Community:\n${names}\nMohon minta mereka bergabung, lalu kabari panitia.${invite}`;
    const allowed_mentions = { users: [uid] };
    const chan = process.env.DISCORD_NOTIFY_CHANNEL_ID;
    if (!chan) return res.status(200).json({ type: 4, data: { content, allowed_mentions } });
    const r = await D.bot(`/channels/${chan}/messages`, 'POST', { content, allowed_mentions });
    if (!r.ok) {
      console.error('Kirim mention gagal:', r.status, await r.text());
      return eph(res, `⚠️ Gagal mengirim mention ke <#${chan}> (kode ${r.status}). Pastikan DISCORD_NOTIFY_CHANNEL_ID benar dan bot punya izin View Channel + Send Messages di channel itu.`);
    }
    return eph(res, `⏸️ Belum di-approve. Belum join:\n${names}\nPemain ${found.p.discord} sudah di-mention di <#${chan}>.`);
  } catch (e) {
    console.error(e);
    return eph(res, 'Terjadi kesalahan: ' + e.message);
  }
};
module.exports.config = { api: { bodyParser: false } };
module.exports._verify = verify;
