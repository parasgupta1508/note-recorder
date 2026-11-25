// The library's storage: the browser's IndexedDB on this device. Pieces and packs never leave it (and are never part of the code or the repository).
// LIBDB.all() -> pieces, LIBDB.put(list), LIBDB.del(id), LIBDB.packs(), LIBDB.putPack(p), LIBDB.delPack(id) (removes the pack and its pieces). All return promises.
const LIBDB = (() => {
  let db = null;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('tuner-library', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('pieces', { keyPath: 'id' }).createIndex('pack', 'pack'); d.createObjectStore('packs', { keyPath: 'id' }); };
    r.onsuccess = () => { db = r.result; res(db); }; r.onerror = () => rej(r.error || new Error('The library could not be opened on this device.'));
  });
  const run = (store, mode, fn) => open().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode), s = t.objectStore(store); let out; try { out = fn(s); } catch (e) { rej(e); return; } t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('The library is full or unavailable.')); }));
  const all = store => run(store, 'readonly', s => s.getAll());
  return {
    all: () => all('pieces'), packs: () => all('packs'),
    put: list => run('pieces', 'readwrite', s => { for (const p of list) s.put(p); }),
    del: id => run('pieces', 'readwrite', s => s.delete(id)),
    putPack: p => run('packs', 'readwrite', s => s.put(p)),
    delPack: id => open().then(d => new Promise((res, rej) => {
      const t = d.transaction(['pieces', 'packs'], 'readwrite'), ix = t.objectStore('pieces').index('pack'), c = ix.openKeyCursor(IDBKeyRange.only(id));
      c.onsuccess = () => { const cur = c.result; if (cur) { t.objectStore('pieces').delete(cur.primaryKey); cur.continue(); } };
      t.objectStore('packs').delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    })),
  };
})();
