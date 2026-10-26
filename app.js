import { CATEGORIES } from './categories.js';
import * as db from './db.js';

const view = document.getElementById('view');
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'フリー'];
const $ = (sel, root = view) => root.querySelector(sel);
const $$ = (sel, root = view) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let urls = [];
const blobUrl = (b) => { if (!b) return ''; const u = URL.createObjectURL(b); urls.push(u); return u; };
const freeUrls = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };

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
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}

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

// ---------- 一覧 ----------
async function viewList() {
  const items = await db.all();
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
  view.innerHTML = `
    <header class="top"><div class="seg"><button class="on">自分</button><button disabled>相手(準備中)</button></div></header>
    <div class="chips">${chip('cat', '', 'すべて', !filter.cat)}${Object.keys(CATEGORIES).map((c) => chip('cat', c, c, filter.cat === c)).join('')}</div>
    ${filter.cat ? `<div class="chips">${chip('sub', '', '全部', !filter.sub)}${CATEGORIES[filter.cat].map((s) => chip('sub', s, s, filter.sub === s)).join('')}</div>` : ''}
    <div class="row">
      <select id="fBrand"><option value="">ブランド: すべて</option>${brands.map((b) => opt(b, filter.brand)).join('')}</select>
      <select id="fSize"><option value="">サイズ: すべて</option>${sizes.map((z) => opt(z, filter.size)).join('')}</select>
    </div>
    <p class="count">${shown.length}着${shown.length !== items.length ? `(全${items.length}着)` : ''}</p>
    ${shown.length
      ? `<div class="grid">${shown.map((i) => `<a class="tile" href="#/item/${i.id}"><img src="${blobUrl(i.thumb)}" alt="">${i.size ? `<span class="badge">${esc(i.size)}</span>` : ''}<span class="cap">${esc(i.brand || i.sub || i.category)}</span></a>`).join('')}</div>`
      : `<p class="empty">${items.length ? '条件に合う服がありません' : 'まだ服がありません。下の「＋登録」から追加します。'}</p>`}`;
  $$('[data-cat]').forEach((b) => (b.onclick = () => { filter.cat = b.dataset.cat; filter.sub = ''; route(); }));
  $$('[data-sub]').forEach((b) => (b.onclick = () => { filter.sub = b.dataset.sub; route(); }));
  $('#fBrand').onchange = (e) => { filter.brand = e.target.value; route(); };
  $('#fSize').onchange = (e) => { filter.size = e.target.value; route(); };
}

// ---------- 詳細 ----------
async function viewDetail(id) {
  const i = await db.get(id);
  if (!i) { location.hash = '#/'; return; }
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
  const mainUrl = blobUrl(i.photoMain), tagUrl = blobUrl(i.photoTag);
  view.innerHTML = `
    <header class="top"><a class="back" href="#/">‹ 一覧</a></header>
    <div class="photo"><img id="dImg" src="${mainUrl}" alt="">${i.photoTag ? '<button id="dSwap" class="ghost">タグを見る</button>' : ''}</div>
    <table class="meta">
      ${row('カテゴリ', [i.category, i.sub].filter(Boolean).join(' / '))}${row('サイズ', i.size)}${row('ブランド', i.brand)}
      ${row('購入店', i.shop)}${row('購入時期', i.purchasedOn)}${row('メモ', i.memo)}
    </table>
    <div class="actions"><a class="btn" href="#/edit/${i.id}">編集</a><button id="dDel" class="btn danger">削除</button></div>`;
  let showTag = false;
  const swap = $('#dSwap');
  if (swap) swap.onclick = () => {
    showTag = !showTag;
    $('#dImg').src = showTag ? tagUrl : mainUrl;
    swap.textContent = showTag ? '全体を見る' : 'タグを見る';
  };
  $('#dDel').onclick = async () => {
    if (!confirm('この服を削除します。元に戻せません。')) return;
    await db.del(i.id);
    toast('削除しました');
    location.hash = '#/';
  };
}

// ---------- 登録・編集 ----------
async function viewForm(id) {
  const editing = id ? await db.get(id) : null;
  if (id && !editing) { location.hash = '#/'; return; }
  const items = await db.all();
  const s = editing
    ? { ...editing }
    : { category: lastAdd.category, sub: lastAdd.sub, brand: '', shop: '', size: '', purchasedOn: '', memo: '', photoMain: null, thumb: null, photoTag: null };
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
    const box = (kind, b, label) => `<label class="ph">${b ? `<img src="${blobUrl(b)}" alt="">` : `<span>${label}</span>`}<input type="file" accept="image/*" hidden data-kind="${kind}"></label>`;
    $('#photos').innerHTML = box('main', s.thumb, '＋ 全体の写真') + box('tag', s.photoTag, '＋ タグ<br>(任意)');
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
      if (inp.dataset.kind === 'main') { s.photoMain = await drawBlob(bmp, 1024, 0.72); s.thumb = await drawBlob(bmp, 360, 0.7); }
      else s.photoTag = await drawBlob(bmp, 1280, 0.78);
      bmp.close?.();
      drawPhotos();
    } catch (err) { console.error(err); toast('写真を読み込めませんでした'); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!s.category) return toast('カテゴリを選んでください');
    if (!s.photoMain) return toast('全体の写真を入れてください');
    const now = Date.now();
    const item = {
      id: editing?.id ?? crypto.randomUUID(), owner: 'me', category: s.category, sub: s.sub,
      brand: s.brand.trim(), shop: s.shop.trim(), size: s.size.trim(), purchasedOn: s.purchasedOn, memo: s.memo.trim(),
      photoMain: s.photoMain, thumb: s.thumb, photoTag: s.photoTag, createdAt: editing?.createdAt ?? now, updatedAt: now,
    };
    await db.put(item);
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
  const items = await db.all();
  const brands = jaSort(uniq(items, 'brand'));
  let body;
  if (!brands.length) {
    body = '<p class="empty">ブランドを入れて登録すると、ここにブランド別のサイズが出ます。</p>';
  } else if (sizeBrand && brands.includes(sizeBrand)) {
    const mine = items.filter((i) => i.brand === sizeBrand);
    const mini = (g) => g.map((i) => `<a href="#/item/${i.id}"><img src="${blobUrl(i.thumb)}" alt=""><span>${esc(i.sub || i.category)}</span></a>`).join('');
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
  view.innerHTML = `<header class="top"><h1>ブランド別サイズ</h1></header>${body}`;
  $$('[data-b]').forEach((b) => (b.onclick = () => { sizeBrand = b.dataset.b; route(); }));
  const back = $('#allBrands');
  if (back) back.onclick = () => { sizeBrand = ''; route(); };
}

// ---------- 設定 ----------
const toDataUrl = (b) => (b ? new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }) : null);
const fromDataUrl = async (d) => (d ? (await fetch(d)).blob() : null);

async function exportAll() {
  const items = await db.all();
  const out = [];
  for (const i of items) out.push({ ...i, photoMain: await toDataUrl(i.photoMain), thumb: await toDataUrl(i.thumb), photoTag: await toDataUrl(i.photoTag) });
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: out })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `closet-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function importAll(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.items)) throw new Error('形式が違います');
  for (const i of data.items) await db.put({ ...i, photoMain: await fromDataUrl(i.photoMain), thumb: await fromDataUrl(i.thumb), photoTag: await fromDataUrl(i.photoTag) });
  return data.items.length;
}

async function viewSettings() {
  const items = await db.all();
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const mb = (n) => (n / 1048576).toFixed(1);
  view.innerHTML = `
    <header class="top"><h1>設定</h1></header>
    <div class="card"><h3>この端末のデータ</h3>
      <p>${items.length}着${est ? ` / 使用 約${mb(est.usage)}MB` : ''}</p>
      <p>消去されにくい保存: ${persisted ? '有効' : '未設定'}</p>
      ${persisted || !navigator.storage?.persist ? '' : '<button class="btn" id="persist" style="margin-top:8px">消去されにくくする</button>'}
    </div>
    <div class="card"><h3>バックアップ</h3>
      <p>月に1回を目安に書き出しておくと安心です。</p>
      <div class="actions" style="margin-top:8px"><button class="btn" id="exp">書き出す</button><label class="btn danger" style="cursor:pointer">読み込む<input type="file" id="imp" accept="application/json" hidden></label></div>
    </div>
    <div class="card"><h3>2人での共有</h3><p>まだ有効ではありません。次の段階で追加します(相手の服は閲覧のみ)。</p></div>`;
  const p = $('#persist');
  if (p) p.onclick = async () => { toast((await navigator.storage.persist()) ? '設定しました' : '端末に断られました'); route(); };
  $('#exp').onclick = () => exportAll().catch((e) => toast(e.message));
  $('#imp').onchange = async (e) => {
    try { toast(`${await importAll(e.target.files[0])}着を読み込みました`); route(); }
    catch (err) { toast('読み込めませんでした: ' + err.message); }
  };
}

// ---------- ルーティング ----------
const TAB = { '': 'list', item: 'list', edit: 'list', add: 'add', sizes: 'sizes', settings: 'settings' };
async function route() {
  freeUrls();
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
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
}
