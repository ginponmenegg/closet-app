import { CATEGORIES } from './categories.js';
import * as db from './db.js';
import * as sync from './sync.js';

const view = document.getElementById('view');
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'フリー'];
const $ = (sel, root = view) => root.querySelector(sel);
const $$ = (sel, root = view) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let me = null; // { id, email }。部品が読めない時だけ id:'me'(端末内のみ)
const isMine = (i) => i.owner === me.id;
let who = 'me'; // 'me' = 自分の服 / 'other' = 相手の服(閲覧のみ)

let urls = [];
const blobUrl = (b) => { if (!b) return ''; const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
let routeSeq = 0;

let filter = { cat: '', sub: '', brand: '', size: '' };
let sizeBrand = '';
let lastAdd = { category: '', sub: '' };

const sizeRank = (s) => {
  const i = SIZES.indexOf(s);
  if (i >= 0) return [0, i, ''];
  const n = parseFloat(s);
  return Number.isNaN(n) ? [2, 0, s] : [1, n, ''];
};
const sizeCmp = (a, b) => {
  const x = sizeRank(a), y = sizeRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'ja');
};
const uniq = (items, key) => [...new Set(items.map((i) => i[key]).filter(Boolean))];
const jaSort = (arr) => arr.sort((a, b) => a.localeCompare(b, 'ja'));

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- 同期の表示 ----------
const syncText = () => ({ idle: '', syncing: '同期中…', ok: '同期済み', offline: 'オフライン', error: '同期エラー' })[sync.status.state] || '';
const updateSync = () => $$('.sync', document).forEach((e) => { e.textContent = syncText(); });
sync.onChange(updateSync);
const seg = () => `<div class="seg"><button data-who="me" class="${who === 'me' ? 'on' : ''}">自分</button><button data-who="other" class="${who === 'other' ? 'on' : ''}">相手</button></div><span class="sync">${syncText()}</span>`;
const bindSeg = () => $$('[data-who]').forEach((b) => (b.onclick = () => { who = b.dataset.who; route(); }));
const refreshIfSafe = () => {
  const page = location.hash.split('/')[1] || '';
  if (['', 'item', 'sizes', 'settings'].includes(page)) route();
};
const runSync = () => sync.run(me).then((changed) => { if (changed) refreshIfSafe(); });
const listFor = async () => (await db.all()).filter((i) => (who === 'me' ? isMine(i) : !isMine(i)));

// ---------- 画像 ----------
async function bitmapOf(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return await createImageBitmap(file); }
}
function drawBlob(bmp, max, quality) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像の変換に失敗'))), 'image/jpeg', quality));
}

// ---------- ログイン ----------
function viewLogin(msg = '') {
  document.getElementById('tabs').hidden = true;
  view.innerHTML = `
    <header class="top"><h1>ログイン</h1></header>
    <form id="lf" class="card">
      <label class="f">メールアドレス</label><input type="email" id="em" autocomplete="username" required>
      <label class="f">パスワード</label><input type="password" id="pw" autocomplete="current-password" required>
      <button class="btn" style="margin-top:16px;width:100%" type="submit">ログイン</button>
      <p class="err" id="lerr">${esc(msg)}</p>
    </form>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    $('#lerr').textContent = '確認中…';
    try { await sync.signIn($('#em').value.trim(), $('#pw').value); await boot(); }
    catch (err) { $('#lerr').textContent = navigator.onLine ? 'ログインできませんでした。メールアドレスとパスワードを確認してください。' : 'オフラインです。電波のある所で試してください。'; console.warn(err); }
  };
}

// ---------- 一覧 ----------
async function viewList() {
  const items = await listFor();
  const brands = jaSort(uniq(items, 'brand'));
  const sizes = uniq(items, 'size').sort(sizeCmp);
  if (filter.brand && !brands.includes(filter.brand)) filter.brand = '';
  if (filter.size && !sizes.includes(filter.size)) filter.size = '';
  const shown = items
    .filter((i) => (!filter.cat || i.category === filter.cat) && (!filter.sub || i.sub === filter.sub)
      && (!filter.brand || i.brand === filter.brand) && (!filter.size || i.size === filter.size))
    .sort((a, b) => b.createdAt - a.createdAt);
  const chip = (attr, val, label, on) => `<button class="chip${on ? ' on' : ''}" data-${attr}="${esc(val)}">${esc(label)}</button>`;
  const opt = (v, cur) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`;
  const emptyMsg = items.length ? '条件に合う服がありません' : who === 'me' ? 'まだ服がありません。下の「＋登録」から追加します。' : '相手の服はまだありません。';
  view.innerHTML = `
    <header class="top">${seg()}</header>
    <div class="chips">${chip('cat', '', 'すべて', !filter.cat)}${Object.keys(CATEGORIES).map((c) => chip('cat', c, c, filter.cat === c)).join('')}</div>
    ${filter.cat ? `<div class="chips">${chip('sub', '', '全部', !filter.sub)}${CATEGORIES[filter.cat].map((s) => chip('sub', s, s, filter.sub === s)).join('')}</div>` : ''}
    <div class="row">
      <select id="fBrand"><option value="">ブランド: すべて</option>${brands.map((b) => opt(b, filter.brand)).join('')}</select>
      <select id="fSize"><option value="">サイズ: すべて</option>${sizes.map((z) => opt(z, filter.size)).join('')}</select>
    </div>
    <p class="count">${shown.length}着${shown.length !== items.length ? `(全${items.length}着)` : ''}${who === 'other' ? ' ・閲覧のみ' : ''}</p>
    ${shown.length
      ? `<div class="grid">${shown.map((i) => `<a class="tile" href="#/item/${i.id}">${i.thumb ? `<img src="${blobUrl(i.thumb)}" alt="">` : ''}${i.size ? `<span class="badge">${esc(i.size)}</span>` : ''}<span class="cap">${esc(i.brand || i.sub || i.category)}</span></a>`).join('')}</div>`
      : `<p class="empty">${emptyMsg}</p>`}`;
  bindSeg();
  $$('[data-cat]').forEach((b) => (b.onclick = () => { filter.cat = b.dataset.cat; filter.sub = ''; route(); }));
  $$('[data-sub]').forEach((b) => (b.onclick = () => { filter.sub = b.dataset.sub; route(); }));
  $('#fBrand').onchange = (e) => { filter.brand = e.target.value; route(); };
  $('#fSize').onchange = (e) => { filter.size = e.target.value; route(); };
}

// ---------- 詳細 ----------
async function viewDetail(id) {
  const seq = routeSeq;
  const i = await db.get(id);
  if (!i) { location.hash = '#/'; return; }
  const mine = isMine(i);
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
  let mainUrl = blobUrl(i.photoMain || i.thumb), tagUrl = i.photoTag ? blobUrl(i.photoTag) : '';
  view.innerHTML = `
    <header class="top"><a class="back" href="#/">‹ 一覧</a>${mine ? '' : '<span class="sync">相手の服(閲覧のみ)</span>'}</header>
    <div class="photo"><img id="dImg" src="${mainUrl}" alt="">${i.photoTag || i.hasTag ? '<button id="dSwap" class="ghost">タグを見る</button>' : ''}</div>
    <table class="meta">
      ${row('カテゴリ', [i.category, i.sub].filter(Boolean).join(' / '))}${row('サイズ', i.size)}${row('ブランド', i.brand)}
      ${row('購入店', i.shop)}${row('購入時期', i.purchasedOn)}${row('メモ', i.memo)}
    </table>
    ${mine ? `<div class="actions"><a class="btn" href="#/edit/${i.id}">編集</a><button id="dDel" class="btn danger">削除</button></div>` : ''}`;
  // 全体の写真は、無ければ後から取りに行く(サムネイルを先に出す)
  if (!i.photoMain && i.hasMain && navigator.onLine) {
    sync.fetchPhoto(i, 'main').then((b) => { if (seq !== routeSeq) return; mainUrl = blobUrl(b); if (!showTag) $('#dImg').src = mainUrl; }).catch(() => {});
  }
  let showTag = false;
  const swap = $('#dSwap');
  if (swap) swap.onclick = async () => {
    if (!showTag && !tagUrl) {
      try { tagUrl = blobUrl(i.photoTag || await sync.fetchPhoto(i, 'tag')); }
      catch { return toast('タグの写真は、電波のある所で見られます'); }
    }
    showTag = !showTag;
    $('#dImg').src = showTag ? tagUrl : mainUrl;
    swap.textContent = showTag ? '全体を見る' : 'タグを見る';
  };
  const delBtn = $('#dDel');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm('この服を削除します。元に戻せません。')) return;
    await sync.removeLocalAndRemote(i);
    toast('削除しました');
    location.hash = '#/';
    runSync();
  };
}

// ---------- 登録・編集 ----------
async function viewForm(id) {
  const editing = id ? await db.get(id) : null;
  if (id && (!editing || !isMine(editing))) { location.hash = '#/'; return; }
  const items = (await db.all()).filter(isMine);
  const s = editing
    ? { ...editing, mainChanged: false, tagChanged: false }
    : { category: lastAdd.category, sub: lastAdd.sub, brand: '', shop: '', size: '', purchasedOn: '', memo: '', photoMain: null, thumb: null, photoTag: null, hasMain: false, hasTag: false, mainChanged: false, tagChanged: false };
  const brands = jaSort(uniq(items, 'brand')), shops = jaSort(uniq(items, 'shop'));

  view.innerHTML = `
    <header class="top"><a class="back" href="${editing ? '#/item/' + id : '#/'}">‹ 戻る</a><h1>${editing ? '編集' : '登録'}</h1></header>
    <form id="f" autocomplete="off">
      <div class="photos" id="photos"></div>
      <label class="f">カテゴリ</label><div class="chips wrap" id="cats"></div>
      <label class="f">種類(任意)</label><div class="chips wrap" id="subs"></div>
      <label class="f">サイズ</label>
      <div class="chips" id="sizes"></div>
      <input type="text" id="size" placeholder="数字など自由入力(例 27.5 / 160)" value="${esc(s.size)}">
      <label class="f">ブランド</label>
      <input type="text" id="brand" list="brandList" placeholder="ブランド名" value="${esc(s.brand)}">
      <datalist id="brandList">${brands.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <div class="hint" id="hint"></div>
      <label class="f">購入店</label>
      <input type="text" id="shop" list="shopList" placeholder="購入店" value="${esc(s.shop)}">
      <datalist id="shopList">${shops.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <label class="f">購入時期(任意)</label>
      <input type="month" id="purchasedOn" value="${esc(s.purchasedOn)}">
      <label class="f">メモ(任意)</label>
      <textarea id="memo" rows="2">${esc(s.memo)}</textarea>
      ${editing ? '' : '<label class="again"><input type="checkbox" id="again" checked> 続けて登録する</label>'}
      <button class="btn save" type="submit">${editing ? '保存' : '登録'}</button>
    </form>`;

  const f = $('#f');
  const drawPhotos = () => {
    const box = (kind, inner) => `<label class="ph">${inner}<input type="file" accept="image/*" hidden data-kind="${kind}"></label>`;
    const main = s.thumb ? `<img src="${blobUrl(s.thumb)}" alt="">` : '<span>＋ 全体の写真</span>';
    const tag = s.photoTag ? `<img src="${blobUrl(s.photoTag)}" alt="">` : s.hasTag ? '<span>タグ写真あり<br>(変更は タップ)</span>' : '<span>＋ タグ<br>(任意)</span>';
    $('#photos').innerHTML = box('main', main) + box('tag', tag);
  };
  const drawCat = () => {
    $('#cats').innerHTML = Object.keys(CATEGORIES).map((c) => `<button type="button" class="chip${s.category === c ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('#subs').innerHTML = s.category
      ? CATEGORIES[s.category].map((x) => `<button type="button" class="chip${s.sub === x ? ' on' : ''}" data-s="${esc(x)}">${esc(x)}</button>`).join('')
      : '<span class="hint">カテゴリを選ぶと出ます</span>';
  };
  const drawSizes = () => {
    $('#sizes').innerHTML = SIZES.map((x) => `<button type="button" class="chip${s.size === x ? ' on' : ''}" data-z="${x}">${x}</button>`).join('');
  };
  const drawHint = () => {
    const b = s.brand.trim();
    const cnt = {};
    if (b) items.filter((i) => i.brand === b && i.id !== id && i.size).forEach((i) => { cnt[i.size] = (cnt[i.size] || 0) + 1; });
    const keys = Object.keys(cnt).sort(sizeCmp);
    $('#hint').innerHTML = keys.length
      ? `持っている「${esc(b)}」のサイズ: ${keys.map((k) => `<button type="button" class="chip" data-z="${esc(k)}">${esc(k)}×${cnt[k]}</button>`).join(' ')}`
      : '';
  };
  drawPhotos(); drawCat(); drawSizes(); drawHint();

  f.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.c !== undefined) { if (s.category !== t.dataset.c) { s.category = t.dataset.c; s.sub = ''; } drawCat(); }
    else if (t.dataset.s !== undefined) { s.sub = s.sub === t.dataset.s ? '' : t.dataset.s; drawCat(); }
    else if (t.dataset.z !== undefined) { s.size = s.size === t.dataset.z ? '' : t.dataset.z; $('#size').value = s.size; drawSizes(); }
  });
  f.addEventListener('input', (e) => {
    const k = e.target.id;
    if (['size', 'brand', 'shop', 'purchasedOn', 'memo'].includes(k)) {
      s[k] = e.target.value;
      if (k === 'size') drawSizes();
      if (k === 'brand') drawHint();
    }
  });
  f.addEventListener('change', async (e) => {
    const inp = e.target;
    if (!inp.dataset.kind || !inp.files[0]) return;
    try {
      const bmp = await bitmapOf(inp.files[0]);
      if (inp.dataset.kind === 'main') { s.photoMain = await drawBlob(bmp, 1024, 0.72); s.thumb = await drawBlob(bmp, 360, 0.7); s.hasMain = true; s.mainChanged = true; }
      else { s.photoTag = await drawBlob(bmp, 1280, 0.78); s.hasTag = true; s.tagChanged = true; }
      bmp.close?.();
      drawPhotos();
    } catch (err) { console.error(err); toast('写真を読み込めませんでした'); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!s.category) return toast('カテゴリを選んでください');
    if (!s.photoMain && !s.hasMain) return toast('全体の写真を入れてください');
    const now = Date.now();
    const uploaded = editing ? { ...editing.uploaded } : { main: false, thumb: false, tag: false };
    if (s.mainChanged) { uploaded.main = false; uploaded.thumb = false; }
    if (s.tagChanged) uploaded.tag = false;
    const item = {
      id: editing?.id ?? crypto.randomUUID(), owner: me.id, category: s.category, sub: s.sub,
      brand: s.brand.trim(), shop: s.shop.trim(), size: s.size.trim(), purchasedOn: s.purchasedOn, memo: s.memo.trim(),
      photoMain: s.photoMain, thumb: s.thumb, photoTag: s.photoTag, hasMain: true, hasTag: !!(s.photoTag || s.hasTag),
      uploaded, dirty: true, createdAt: editing?.createdAt ?? now, updatedAt: now,
    };
    await db.put(item);
    runSync();
    if (!editing && $('#again').checked) {
      lastAdd = { category: s.category, sub: s.sub };
      toast('登録しました。続けてどうぞ');
      route();
      window.scrollTo(0, 0);
    } else {
      toast('保存しました');
      location.hash = '#/item/' + item.id;
    }
  });
}

// ---------- サイズ(ブランド別) ----------
async function viewSizes() {
  const items = await listFor();
  const brands = jaSort(uniq(items, 'brand'));
  let body;
  if (!brands.length) {
    body = '<p class="empty">ブランドを入れて登録すると、ここにブランド別のサイズが出ます。</p>';
  } else if (sizeBrand && brands.includes(sizeBrand)) {
    const mine = items.filter((i) => i.brand === sizeBrand);
    const mini = (g) => g.map((i) => `<a href="#/item/${i.id}">${i.thumb ? `<img src="${blobUrl(i.thumb)}" alt="">` : ''}<span>${esc(i.sub || i.category)}</span></a>`).join('');
    const groups = uniq(mine, 'size').sort(sizeCmp).map((z) => {
      const g = mine.filter((i) => i.size === z);
      return `<section class="grp"><h3>${esc(z)} <small>${g.length}着</small></h3><div class="mini">${mini(g)}</div></section>`;
    });
    const none = mine.filter((i) => !i.size);
    if (none.length) groups.push(`<section class="grp"><h3>サイズ未入力 <small>${none.length}着</small></h3><div class="mini">${mini(none)}</div></section>`);
    body = `<div class="chips"><button class="chip" id="allBrands">‹ ブランド一覧</button></div><h3>${esc(sizeBrand)}</h3>${groups.join('')}`;
  } else {
    body = `<div class="chips wrap">${brands.map((b) => `<button class="chip" data-b="${esc(b)}">${esc(b)} <small>${items.filter((i) => i.brand === b).length}</small></button>`).join('')}</div>`;
  }
  view.innerHTML = `<header class="top">${seg()}</header><h1 style="margin:4px 0 8px">ブランド別サイズ</h1>${body}`;
  bindSeg();
  $$('[data-b]').forEach((b) => (b.onclick = () => { sizeBrand = b.dataset.b; route(); }));
  const back = $('#allBrands');
  if (back) back.onclick = () => { sizeBrand = ''; route(); };
}

// ---------- 設定 ----------
const toDataUrl = (b) => (b ? new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }) : null);
const fromDataUrl = async (d) => (d ? (await fetch(d)).blob() : null);

async function exportAll() {
  const items = (await db.all()).filter(isMine);
  const out = [];
  for (const i of items) {
    // 端末に無い写真は、書き出し前に取りに行く
    const full = { ...i };
    if (!full.photoMain && full.hasMain) full.photoMain = await sync.fetchPhoto(i, 'main').catch(() => null);
    if (!full.photoTag && full.hasTag) full.photoTag = await sync.fetchPhoto(i, 'tag').catch(() => null);
    out.push({ ...full, photoMain: await toDataUrl(full.photoMain), thumb: await toDataUrl(full.thumb), photoTag: await toDataUrl(full.photoTag) });
  }
  const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items: out })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `closet-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function importAll(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.items)) throw new Error('形式が違います');
  for (const i of data.items) {
    const photoMain = await fromDataUrl(i.photoMain), photoTag = await fromDataUrl(i.photoTag);
    await db.put({ ...i, owner: me.id, photoMain, thumb: await fromDataUrl(i.thumb), photoTag, hasMain: !!photoMain, hasTag: !!photoTag, dirty: true, uploaded: { main: false, thumb: false, tag: false } });
  }
  return data.items.length;
}

async function viewSettings() {
  const items = (await db.all()).filter(isMine);
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const mb = (n) => (n / 1048576).toFixed(1);
  const at = sync.status.at ? new Date(sync.status.at).toLocaleString('ja-JP') : '未実行';
  view.innerHTML = `
    <header class="top"><h1>設定</h1><span class="sync">${syncText()}</span></header>
    <div class="card"><h3>アカウント</h3>
      <p>${me.id === 'me' ? 'この端末のみで使用中(同期なし)' : esc(me.email)}</p>
      <p>最後の同期: ${at}${sync.status.state === 'error' ? `<br><span class="err">${esc(sync.status.message)}</span>` : ''}</p>
      ${me.id === 'me' ? '' : '<div class="actions" style="margin-top:8px"><button class="btn" id="syncNow">今すぐ同期</button><button class="btn danger" id="logout">ログアウト</button></div>'}
    </div>
    <div class="card"><h3>この端末のデータ</h3>
      <p>自分の服 ${items.length}着${est ? ` / 端末の使用量 約${mb(est.usage)}MB` : ''}</p>
      <p>消去されにくい保存: ${persisted ? '有効' : '未設定'}</p>
      ${persisted || !navigator.storage?.persist ? '' : '<button class="btn" id="persist" style="margin-top:8px">消去されにくくする</button>'}
    </div>
    <div class="card"><h3>バックアップ</h3>
      <p>月に1回を目安に書き出しておくと安心です(自分の服のみ)。</p>
      <div class="actions" style="margin-top:8px"><button class="btn" id="exp">書き出す</button><label class="btn danger" style="cursor:pointer">読み込む<input type="file" id="imp" accept="application/json" hidden></label></div>
    </div>`;
  const p = $('#persist');
  if (p) p.onclick = async () => { toast((await navigator.storage.persist()) ? '設定しました' : '端末に断られました'); route(); };
  const sn = $('#syncNow');
  if (sn) sn.onclick = async () => { toast('同期します'); await runSync(); route(); };
  const lo = $('#logout');
  if (lo) lo.onclick = async () => {
    if (await sync.hasPending()) return toast('未送信のデータがあります。同期が済んでからにしてください');
    if (!confirm('ログアウトします。この端末の保存データは消えます(クラウドには残ります)。')) return;
    await sync.signOut();
    await db.clearAll();
    localStorage.removeItem('closet_me');
    me = null;
    location.hash = '#/';
    boot();
  };
  $('#exp').onclick = () => exportAll().catch((e) => toast(e.message));
  $('#imp').onchange = async (e) => {
    try { toast(`${await importAll(e.target.files[0])}着を読み込みました`); route(); runSync(); }
    catch (err) { toast('読み込めませんでした: ' + err.message); }
  };
}

// ---------- ルーティング ----------
const TAB = { '': 'list', item: 'list', edit: 'list', add: 'add', sizes: 'sizes', settings: 'settings' };
async function route() {
  if (!me) return;
  freeUrls();
  routeSeq++;
  const [, page = '', id] = location.hash.split('/');
  $$('#tabs a', document).forEach((a) => a.classList.toggle('on', a.dataset.t === TAB[page]));
  try {
    if (page === 'add') await viewForm();
    else if (page === 'edit') await viewForm(id);
    else if (page === 'item') await viewDetail(id);
    else if (page === 'sizes') await viewSizes();
    else if (page === 'settings') await viewSettings();
    else await viewList();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="err">エラー: ${esc(e.message)}</p>`;
  }
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// ---------- 起動 ----------
async function adoptLocal() {
  // ログイン前に端末内へ登録した服(owner:'me')を、自分の服として送信待ちにする
  for (const i of await db.all()) {
    if (i.owner === 'me') await db.put({ ...i, owner: me.id, dirty: true, hasMain: true, hasTag: !!i.photoTag, uploaded: { main: false, thumb: false, tag: false } });
  }
}
async function boot() {
  const client = await sync.init();
  const s = await sync.currentSession();
  if (s) {
    me = { id: s.user.id, email: s.user.email };
    localStorage.setItem('closet_me', JSON.stringify(me));
  } else if (!client) {
    me = { id: 'me', email: '' };
  } else {
    const cached = JSON.parse(localStorage.getItem('closet_me') || 'null');
    if (cached && !navigator.onLine) me = cached; // 電波が無い時は、前回のログインのまま端末内のデータを見せる
  }
  if (!me) { viewLogin(); return; }
  document.getElementById('tabs').hidden = false;
  if (me.id !== 'me') await adoptLocal();
  route();
  runSync();
}

window.addEventListener('online', () => me && runSync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me) runSync(); });
boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
}
