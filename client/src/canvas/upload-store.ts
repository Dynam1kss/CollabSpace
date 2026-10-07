import { createId } from '@paralleldrive/cuid2';
import { create } from 'zustand';
import { humanSize } from './file-layout';

// заготовки карток, поки файл іде на сервер. Навмисно НЕ обʼєкти дошки:
// недовантажений файл не має летіти сусідам і лягати в історію. Картка
// зʼявляється в документі лише коли файл уже на сервері — звідси й один крок
// undo на картку
export interface PendingUpload {
  id: string;
  name: string;
  size: number;
  // куди ляже картка, координати дошки
  x: number;
  y: number;
  progress: number;
  error: string | null;
  cancel: () => void;
}

interface UploadState {
  uploads: PendingUpload[];
  add: (upload: Omit<PendingUpload, 'id' | 'progress' | 'error'>) => string;
  setProgress: (id: string, progress: number) => void;
  fail: (id: string, message: string) => void;
  remove: (id: string) => void;
}

// скільки помилка висить перед тим, як зникнути сама
const ERROR_HIDE_MS = 6000;

export const useUploadStore = create<UploadState>((set, get) => ({
  uploads: [],
  add: (upload) => {
    const id = createId();
    set((s) => ({ uploads: [...s.uploads, { ...upload, id, progress: 0, error: null }] }));
    return id;
  },
  setProgress: (id, progress) =>
    set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, progress } : u)) })),
  fail: (id, message) => {
    set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, error: message } : u)) }));
    window.setTimeout(() => get().remove(id), ERROR_HIDE_MS);
  },
  remove: (id) => set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) })),
}));

export function uploadLabel(upload: PendingUpload) {
  return upload.error ?? `${humanSize(upload.size)} · ${Math.round(upload.progress * 100)}%`;
}
