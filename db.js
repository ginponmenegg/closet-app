// 端末内保存(IndexedDB)。クラウドのキャッシュも兼ねる。
const NAME = 'closet';
const STORE = 'clothes';
const META = 'meta';
let opened;

function open() {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

const wrap = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function store(name, mode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const all = async () => wrap((await store(STORE, 'readonly')).getAll());
export const get = async (id) => wrap((await store(STORE, 'readonly')).get(id));
export const put = async (item) => wrap((await store(STORE, 'readwrite')).put(item));
export const del = async (id) => wrap((await store(STORE, 'readwrite')).delete(id));
export const clearAll = async () => wrap((await store(STORE, 'readwrite')).clear());

export const getMeta = async (key) => wrap((await store(META, 'readonly')).get(key));
export const setMeta = async (key, val) => wrap((await store(META, 'readwrite')).put(val, key));
