// 端末内保存(IndexedDB)。初版はこれだけで動く。2人分の同期は次の段階で足す。
const NAME = 'closet';
const STORE = 'clothes';
let opened;

function open() {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

const wrap = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function store(mode) {
  return (await open()).transaction(STORE, mode).objectStore(STORE);
}

export const all = async () => wrap((await store('readonly')).getAll());
export const get = async (id) => wrap((await store('readonly')).get(id));
export const put = async (item) => wrap((await store('readwrite')).put(item));
export const del = async (id) => wrap((await store('readwrite')).delete(id));
