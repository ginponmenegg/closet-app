// Supabase との同期。端末内(db.js)が主、クラウドは共有と保管。
// 自分の服だけ書き込める(行ごとのルールは docs/supabase.sql)。相手の服は読むだけ。
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const BUCKET = 'photos';
let client = null;
let loadError = null;

export async function init() {
  if (client || loadError) return client;
  try {
    const { createClient } = await import('./vendor/supabase.js');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  } catch (e) { loadError = e; console.error('supabase load', e); }
  return client;
}

export async function currentSession() {
  const c = await init();
  if (!c) return null;
  try { return (await c.auth.getSession()).data.session; } catch { return null; }
}
export async function signIn(email, password) {
  const c = await init();
  if (!c) throw new Error('通信の部品を読み込めませんでした');
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
export async function signOut() { const c = await init(); if (c) await c.auth.signOut(); }

// ---- 状態 ----
export const status = { state: 'idle', at: null, message: '' };
let listener = () => {};
export const onChange = (fn) => { listener = fn; };
const setStatus = (state, message = '') => { status.state = state; status.message = message; if (state === 'ok') status.at = Date.now(); listener(); };

// ---- 変換 ----
const toRow = (it) => ({
  id: it.id, owner_id: it.owner, category: it.category, sub: it.sub || '', brand: it.brand || '', shop: it.shop || '',
  size: it.size || '', purchased_on: it.purchasedOn || '', memo: it.memo || '',
  photo_main: `${it.owner}/${it.id}/main.jpg`, thumb: `${it.owner}/${it.id}/thumb.jpg`,
  photo_tag: it.photoTag || it.hasTag ? `${it.owner}/${it.id}/tag.jpg` : null,
  created_at: it.createdAt, updated_at: it.updatedAt,
});
const fromRow = (r) => ({
  id: r.id, owner: r.owner_id, category: r.category, sub: r.sub, brand: r.brand, shop: r.shop, size: r.size,
  purchasedOn: r.purchased_on, memo: r.memo, createdAt: r.created_at, updatedAt: r.updated_at,
  hasMain: !!r.photo_main, hasTag: !!r.photo_tag, photoMain: null, thumb: null, photoTag: null,
  uploaded: { main: true, thumb: true, tag: true }, dirty: false,
});

const paths = (owner, id) => ['main', 'thumb', 'tag'].map((n) => `${owner}/${id}/${n}.jpg`);

// ---- 写真の取得(必要になったときだけ) ----
export async function fetchPhoto(item, kind) {
  const c = await init();
  if (!c) throw new Error('オフラインです');
  const { data, error } = await c.storage.from(BUCKET).download(`${item.owner}/${item.id}/${kind}.jpg`);
  if (error) throw error;
  const fresh = (await db.get(item.id)) || item;
  fresh[kind === 'main' ? 'photoMain' : kind === 'tag' ? 'photoTag' : 'thumb'] = data;
  await db.put(fresh);
  return data;
}

// ---- 送信 ----
async function pushItem(c, it) {
  const up = async (name, blob) => {
    const { error } = await c.storage.from(BUCKET).upload(`${it.owner}/${it.id}/${name}.jpg`, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
  };
  const u = it.uploaded || {};
  if (!u.main && it.photoMain) await up('main', it.photoMain);
  if (!u.thumb && it.thumb) await up('thumb', it.thumb);
  if (!u.tag && it.photoTag) await up('tag', it.photoTag);
  const { error } = await c.from('clothes').upsert(toRow(it));
  if (error) throw error;
  const cur = await db.get(it.id);
  // 送信中に編集されていなければ「送信済み」にする
  if (cur && cur.updatedAt === it.updatedAt) await db.put({ ...cur, dirty: false, uploaded: { main: true, thumb: true, tag: true } });
}

async function pushDeletes(c) {
  const pending = (await db.getMeta('pendingDeletes')) || [];
  const left = [];
  for (const d of pending) {
    try {
      await c.storage.from(BUCKET).remove(paths(d.owner, d.id));
      const { error } = await c.from('clothes').delete().eq('id', d.id);
      if (error) throw error;
    } catch (e) { console.warn('delete', e); left.push(d); }
  }
  await db.setMeta('pendingDeletes', left);
}

// ---- 受信 ----
async function pull(c, me) {
  const { data: rows, error } = await c.from('clothes').select('*').order('created_at');
  if (error) throw error;
  const local = new Map((await db.all()).map((i) => [i.id, i]));
  let changed = 0;
  const needThumb = [];
  for (const r of rows) {
    const cur = local.get(r.id);
    if (cur?.dirty) continue;
    if (cur && cur.updatedAt >= r.updated_at && cur.thumb) continue;
    const item = fromRow(r);
    if (cur && cur.updatedAt === r.updated_at) { item.photoMain = cur.photoMain; item.photoTag = cur.photoTag; item.thumb = cur.thumb; }
    await db.put(item);
    if (!item.thumb) needThumb.push(item);
    changed++;
  }
  const serverIds = new Set(rows.map((r) => r.id));
  for (const [id, cur] of local) {
    if (!serverIds.has(id) && !cur.dirty) { await db.del(id); changed++; }
  }
  // サムネイルは数件ずつ並行して取る
  for (let i = 0; i < needThumb.length; i += 6) {
    await Promise.all(needThumb.slice(i, i + 6).map((it) => fetchPhoto(it, 'thumb').catch((e) => console.warn('thumb', e))));
  }
  return changed;
}

// ---- 実行 ----
let running = false, again = false;
export async function run(me) {
  if (!me || me.id === 'me') return 0;
  if (!navigator.onLine) { setStatus('offline'); return 0; }
  if (running) { again = true; return 0; }
  running = true;
  setStatus('syncing');
  let changed = 0;
  try {
    const c = await init();
    if (!c) throw new Error('通信の部品を読み込めませんでした');
    await pushDeletes(c);
    for (const it of (await db.all()).filter((i) => i.dirty && i.owner === me.id)) await pushItem(c, it);
    changed = await pull(c, me);
    setStatus('ok');
  } catch (e) {
    console.error('sync', e);
    setStatus('error', e.message || String(e));
  } finally {
    running = false;
    if (again) { again = false; run(me); }
  }
  return changed;
}

export async function removeLocalAndRemote(item) {
  const pending = (await db.getMeta('pendingDeletes')) || [];
  pending.push({ id: item.id, owner: item.owner });
  await db.setMeta('pendingDeletes', pending);
  await db.del(item.id);
}
export const hasPending = async () => ((await db.getMeta('pendingDeletes')) || []).length > 0 || (await db.all()).some((i) => i.dirty);
