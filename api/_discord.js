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

const FOOT = 'Arvexis Community • Violence District Tournament';
const cell = v => String(v).replace(/`/g, "'");
function table(list) {
  const rows = list.map(p => [cell(p.discord), cell(p.roblox), cell(p.role)]);
  const w = [13, 6, 17].map((m, i) => Math.max(m, ...rows.map(r => r[i].length)));
  const row = r => `${r[0].padEnd(w[0])} | ${r[1].padEnd(w[1])} | ${r[2]}`;
  return '```\n' + [row(['Discord', 'Roblox', 'Role']), '-'.repeat(w[0] + 1) + '|' + '-'.repeat(w[1] + 2) + '|' + '-'.repeat(w[2] + 3), ...rows.map(row)].join('\n') + '\n```';
}

function embed(rec) {
  if (rec.status === 'approved') {
    const pv = rec.prov || {};
    const roleLn = pv.roleId ? `\n**Role Tim:** <@&${pv.roleId}>` : '';
    const warn = pv.missing && pv.missing.length ? `\n⚠️ Role belum diberikan (belum join): ${pv.missing.join(', ')}` : '';
    return {
      title: '✅ PENDAFTARAN TIM DISETUJUI', color: COLORS.approved,
      description: `**Nama Tim:** ${rec.team}\n\n**Anggota Tim**\n${table(rec.players)}` + (rec.sub ? `\n**Anggota Cadangan**\n${table([rec.sub])}` : '') + `\n**Status:** ✅ Disetujui\n**Diverifikasi oleh:** ${rec.by || '-'}${roleLn}${warn}`,
      footer: { text: FOOT },
    };
  }
  const st = statusText(rec);
  return {
    title: `${TITLES[rec.status]}: ${rec.team}`, color: COLORS[rec.status],
    description: rec.players.map((p, i) => line(p, i + 1)).join('\n'),
    fields: [...(rec.sub ? [{ name: 'Cadangan', value: line(rec.sub, '⤷') }] : []), ...(st ? [{ name: 'Status', value: st }] : [])],
    footer: { text: FOOT }, timestamp: rec.createdAt,
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
async function notifySuccess(rec) {
  if (process.env.DISCORD_WEBHOOK_SUCCESS_URL) await hook(process.env.DISCORD_WEBHOOK_SUCCESS_URL, { embeds: [embed(rec)] });
  else console.error('DISCORD_WEBHOOK_SUCCESS_URL belum diatur');
}
async function syncMessage(rec) {
  if (!rec.msg || !process.env.DISCORD_BOT_TOKEN) return;
  const r = await bot(`/channels/${rec.msg.c}/messages/${rec.msg.m}`, 'PATCH', { embeds: [embed(rec)], components: rec.status === 'pending' ? buttons(rec.id) : [] });
  if (!r.ok) console.error('Sync pesan gagal:', r.status, await r.text());
}

// ---------- Cek member server ----------
// member: objek = ada, null = belum join, undefined = gagal cek
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
  return all.map((p, i) => ({ p, member: res[i], sub: i >= rec.players.length }));
}

// ---------- Role + channel tim ----------
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, HIST: 1n << 16n, CONN: 1n << 20n };
const chName = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'tim';
const jsonOrThrow = async r => { if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };
let BOT_ID;
const botId = async () => BOT_ID || (BOT_ID = (await jsonOrThrow(await bot('/users/@me'))).id);

// Update jika id lama masih ada, buat baru jika belum ada / sudah terhapus
async function upsert(id, patchUrl, patchBody, createUrl, createBody) {
  if (id) {
    const r = await bot(patchUrl(id), 'PATCH', patchBody);
    if (r.ok) return id;
    if (r.status !== 404) throw new Error(`${r.status} ${await r.text()}`);
  }
  return (await jsonOrThrow(await bot(createUrl, 'POST', createBody))).id;
}

// Idempotent: aman dipanggil ulang (edit tim, sinkron role). results = hasil checkMembers (opsional)
async function provision(rec, results) {
  const G = process.env.DISCORD_GUILD_ID;
  if (!G || !process.env.DISCORD_BOT_TOKEN) return null;
  const out = { ...(rec.prov || {}), missing: [], error: null };
  try {
    out.roleId = await upsert(out.roleId, i => `/guilds/${G}/roles/${i}`, { name: rec.team },
      `/guilds/${G}/roles`, { name: rec.team, permissions: '0', mentionable: false });

    if (process.env.DISCORD_TEAM_CHANNELS !== 'off') {
      const parent = process.env.DISCORD_TEAM_CATEGORY_ID || undefined;
      const staff = process.env.DISCORD_ADMIN_ROLE_ID;
      const bid = await botId();
      const ows = allow => [
        { id: G, type: 0, allow: '0', deny: String(P.VIEW) },
        { id: out.roleId, type: 0, allow: String(allow), deny: '0' },
        { id: bid, type: 1, allow: String(allow), deny: '0' },
        ...(staff ? [{ id: staff, type: 0, allow: String(allow), deny: '0' }] : []),
      ];
      out.textId = await upsert(out.textId, i => `/channels/${i}`, { name: chName(rec.team) },
        `/guilds/${G}/channels`, { name: chName(rec.team), type: 0, parent_id: parent, permission_overwrites: ows(P.VIEW | P.SEND | P.HIST) });
      out.voiceId = await upsert(out.voiceId, i => `/channels/${i}`, { name: rec.team.slice(0, 100) },
        `/guilds/${G}/channels`, { name: rec.team.slice(0, 100), type: 2, parent_id: parent, permission_overwrites: ows(P.VIEW | P.CONN) });
    }

    results = results || await checkMembers(rec);
    await Promise.all(results.map(async r => {
      if (!r.member) { out.missing.push(r.p.discord); return; }
      const a = await bot(`/guilds/${G}/members/${r.member.user.id}/roles/${out.roleId}`, 'PUT');
      if (!a.ok) { console.error('Assign role gagal', a.status, await a.text()); out.missing.push(r.p.discord); }
    }));
  } catch (e) {
    console.error('Provision gagal:', e.message);
    out.error = e.message.slice(0, 300);
  }
  return out;
}

async function deprovision(rec) {
  const p = rec.prov, G = process.env.DISCORD_GUILD_ID;
  if (!p || !G) return;
  const del = path => bot(path, 'DELETE').catch(e => console.error('Hapus gagal', e.message));
  await Promise.all([p.textId && del(`/channels/${p.textId}`), p.voiceId && del(`/channels/${p.voiceId}`), p.roleId && del(`/guilds/${G}/roles/${p.roleId}`)].filter(Boolean));
}

async function setStatus(id, status, by, { skipSync, members } = {}) {
  const raw = await db(['HGET', KEY, id]);
  if (!raw) return null;
  const rec = JSON.parse(raw), prev = rec.status;
  rec.status = status; rec.by = by;
  if (prev !== status) {
    if (status === 'approved') rec.prov = (await provision(rec, members)) || rec.prov;
    else if (prev === 'approved' && rec.prov) { await deprovision(rec); delete rec.prov; }
  }
  await db(['HSET', KEY, id, JSON.stringify(rec)]);
  if (prev !== status) {
    if (status === 'approved') await notifySuccess(rec);
    if (!skipSync) await syncMessage(rec);
  }
  return rec;
}

function blocked(rec, uid, who, missing) {
  const invite = process.env.DISCORD_INVITE_URL ? `\n🔗 Link Discord: ${process.env.DISCORD_INVITE_URL}` : '';
  const list = missing.map(m => `• ${m.p.discord}${m.sub ? ' (Cadangan)' : ''}`).join('\n');
  return {
    content: `<@${uid}>`, allowed_mentions: { users: [uid] },
    embeds: [{
      title: '⚠️ PENDAFTARAN TIM BELUM DISETUJUI', color: 0xf0b429,
      description: `**Nama Tim:** ${rec.team}\n**Pendaftar:** <@${uid}>\n**Diperiksa oleh:** ${who}\n\nPendaftaran tim **${rec.team}** belum dapat disetujui karena beberapa anggota belum bergabung ke server Discord Arvexis Community.\n\n**Anggota yang belum bergabung:**\n${list}\n\nMohon minta anggota yang tercantum di atas untuk bergabung ke server Discord terlebih dahulu. Setelah semua anggota bergabung, silakan hubungi Staff untuk pemeriksaan ulang.${invite}`,
      footer: { text: FOOT },
    }],
  };
}

module.exports = { blocked, bot, embed, notifyPending, notifySuccess, syncMessage, setStatus, checkMembers, provision, deprovision };
