import { SAVE_DB_NAME, SAVE_DB_VERSION } from '../core/config';
import { deserializeSave, serializeSave, validateSave } from './savegame';
import type { SaveV1, WorldListEntry } from './types';

const STORE_WORLDS = 'worlds';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB，无法保存世界'));
      return;
    }
    const request = indexedDB.open(SAVE_DB_NAME, SAVE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORLDS)) {
        db.createObjectStore(STORE_WORLDS, { keyPath: 'meta.id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_WORLDS, mode);
    const store = transaction.objectStore(STORE_WORLDS);
    const result = await operation(store);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务中止'));
    });
    return result;
  } finally {
    db.close();
  }
}

export async function listWorldSaves(): Promise<WorldListEntry[]> {
  return withStore('readonly', async (store) => {
    const saves = (await requestToPromise(store.getAll())) as SaveV1[];
    return saves
      .map((save) => ({
        id: save.meta.id,
        name: save.meta.name,
        seed: save.meta.seed,
        gameMode: save.meta.gameMode,
        difficulty: save.meta.difficulty,
        createdAt: save.meta.createdAt,
        lastPlayed: save.meta.lastPlayed,
        playtimeSeconds: save.meta.playtimeSeconds,
        gameVersion: save.meta.gameVersion,
      }))
      .sort((a, b) => b.lastPlayed - a.lastPlayed);
  });
}

export async function loadWorldSave(id: string): Promise<SaveV1 | null> {
  return withStore('readonly', async (store) => {
    const save = (await requestToPromise(store.get(id))) as SaveV1 | undefined;
    return save ? validateSave(save) : null;
  });
}

export async function writeWorldSave(save: SaveV1): Promise<void> {
  validateSave(save);
  await withStore('readwrite', async (store) => {
    await requestToPromise(store.put(save));
  });
}

export async function deleteWorldSave(id: string): Promise<void> {
  await withStore('readwrite', async (store) => {
    await requestToPromise(store.delete(id));
  });
}

/** Triggers a browser download of the save as JSON. */
export function exportSaveToFile(save: SaveV1): void {
  const blob = new Blob([serializeSave(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${save.meta.name.replace(/[\\/:*?"<>|]+/g, '_')}-${save.meta.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Reads a JSON save file chosen by the user. */
export async function readSaveFile(file: File): Promise<SaveV1> {
  const text = await file.text();
  return deserializeSave(text);
}
