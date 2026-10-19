const { KEY, db } = require('./_lib');
const API = 'https://discord.com/api/v10';
const bot = (path, method = 'GET', data) => fetch(API + path, {
  method, headers: { Authorization: 'Bot ' + process.env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json' },
  body: data ? JSON.stringify(data) : undefined,
});
const hasBot = () => !!(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_PENDING_CHANNEL_ID);
const COLORS = { pending: 0xc0121f, approved: 0x2ecc71, rejected: 0x6b6b6b };
const TITLES = { pending: '📥 Pendaftaran Baru', approved: '✅ Tim Disetujui', rejected: '❌ Tim Ditolak' };
const line = (p, i) => `**${i}.** ${p.discord} • ${p.roblox} • ${p.role}`;
const statusText = r => r.status === 'pending' ? null : `${r.status === 'approved' ? '✅ Disetujui' : '❌ Ditolak'} oleh ${r.by || '-'}`;

function embed(rec) {
  const st = statusText(rec);
  return {
    title: `${TITLES[rec.status]}: ${rec.team}`, color: COLORS[rec.status],
    description: rec.players.map((p, i) => line(p, i + 1)).join('\n'),
    fields: [...(rec.sub ? [{ name: 'Cadangan', value: line(rec.sub, '⤷') }] : []), ...(st ? [{ name: 'Status', value: st }] : [])],
    footer: { text: 'Arvexis Community • Violence District Tournament' }, timestamp: rec.createdAt,
  };
}
const buttons = id => [{ type: 1, components: [
  { type: 2, style: 3, label: 'Approve', custom_id: 'ok:' + id },
  { type: 2, style: 2, label: 'Approve tanpa cek', custom_id: 'force:' + id },
  { type: 2, style: 4, label: 'Reject', custom_id: 'no:' + id },
] }];

async function hook(url, payload) {
  try {
    const r = await fetch(url.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Arvexis Registration', ...payload }) });
    if (!r.ok) console.error('Webhook ditolak:', r.status, await r.text());
  } catch (e) { console.error('Webhook error', e.message); }
}

// Pendaftaran baru -> channel pending (bot + tombol; fallback webhook biasa tanpa tombol)
async function notifyPending(rec) {
  if (hasBot()) {
    const r = await bot(`/channels/${process.env.DISCORD_PENDING_CHANNEL_ID}/messages`, 'POST', { embeds: [embed(rec)], components: buttons(rec.id) });
    if (r.ok) { const m = await r.json(); return { c: m.channel_id, m: m.id }; }
    console.error('Bot gagal kirim pending:', r.status, await r.text());
  }
  if (process.env.DISCORD_WEBHOOK_URL) await hook(process.env.DISCORD_WEBHOOK_URL, { embeds: [embed(rec)] });
  else console.error('Notif pending tidak terkirim: DISCORD_BOT_TOKEN / DISCORD_WEBHOOK_URL belum diatur');
  return null;
}

// Approved -> webhook khusus sukses
async function notifySuccess(rec) {
  if (process.env.DISCORD_WEBHOOK_SUCCESS_URL) await hook(process.env.DISCORD_WEBHOOK_SUCCESS_URL, { embeds: [embed(rec)] });
  else console.error('DISCORD_WEBHOOK_SUCCESS_URL belum diatur');
}

// Samakan pesan pending di Discord dengan status terbaru (dipakai saat ubah status dari web)
async function syncMessage(rec) {
  if (!rec.msg || !process.env.DISCORD_BOT_TOKEN) return;
  const r = await bot(`/channels/${rec.msg.c}/messages/${rec.msg.m}`, 'PATCH', { embeds: [embed(rec)], components: rec.status === 'pending' ? buttons(rec.id) : [] });
  if (!r.ok) console.error('Sync pesan gagal:', r.status, await r.text());
}

async function setStatus(id, status, by, { skipSync } = {}) {
  const raw = await db(['HGET', KEY, id]);
  if (!raw) return null;
  const rec = JSON.parse(raw), prev = rec.status;
  rec.status = status; rec.by = by;
  await db(['HSET', KEY, id, JSON.stringify(rec)]);
  if (prev !== status) {
    if (status === 'approved') await notifySuccess(rec);
    if (!skipSync) await syncMessage(rec);
  }
  return rec;
}

// Cek apakah pemain sudah ada di server Discord. member: objek = ada, null = belum join, undefined = gagal cek
const norm = s => String(s).toLowerCase().trim().replace(/^@/, '').replace(/#\d+$/, '');
async function findMember(name) {
  const q = norm(name);
  const r = await bot(`/guilds/${process.env.DISCORD_GUILD_ID}/members/search?query=${encodeURIComponent(q)}&limit=10`);
  if (!r.ok) throw new Error(`search ${r.status} ${await r.text()}`);
  const list = await r.json();
  return list.find(m => [m.user.username, m.user.global_name, m.nick].some(n => n && n.toLowerCase() === q)) || null;
}
async function checkMembers(rec) {
  const all = [...rec.players, ...(rec.sub ? [rec.sub] : [])];
  const res = await Promise.all(all.map(p => findMember(p.discord).catch(e => { console.error(e.message); return undefined; })));
  return all.map((p, i) => ({ p, member: res[i] }));
}

module.exports = { bot, embed, notifyPending, notifySuccess, syncMessage, setStatus, checkMembers };
