// Bộ autosave gộp ghi (debounce) cho workspace.
// Giúp thao tác gõ phím liên tục không tạo hàng trăm giao dịch IndexedDB.
// Flush tự động khi pagehide hoặc khi người dùng chủ động yêu cầu.
//
// ## Bộ này KHÔNG theo dõi "key nào còn nợ"
//
// Các bản trước giữ `failedKeys` + `keyEpoch` + `inFlightKeys` ở đây để nhớ key nào ghi hỏng. Cách
// đó sinh lỗi mới ở 5/8 vòng review (N1, N2, N6, 4b) vì mỗi tập là một bản sao thủ công của một sự
// thật đã có sẵn trên đĩa, và bản sao đó phải được cập nhật đúng ở mọi đường — mỗi đường bỏ sót là
// một lần kẹt vĩnh viễn hoặc một lần đẩy bản cũ lên cloud.
//
// Nay `flushWorkspace()` trong `hydrate.ts` tự ĐO bằng cách đối chiếu đĩa với store. Bộ này chỉ còn
// đúng một việc: gộp nhiều lần gọi `schedule` thành một lần `save`.

export interface AutosaveOptions<T = unknown> {
  save: (key: string, payload: T) => Promise<void>;
  delayMs?: number;
  onError?: (error: unknown, key: string, payload: T) => void;
  onSuccess?: (key: string, payload: T) => void;
}

export interface Autosave<T = unknown> {
  schedule: (key: string, payload: T) => void;
  flush: () => Promise<void>;
  /** Bỏ phần đang chờ của một key (hoặc tất cả) mà không ghi, dùng khi bản ghi đã bị xóa. */
  cancel: (key?: string) => void;
  dispose: () => Promise<void>;
  isPending: (key?: string) => boolean;
}

interface PendingItem<T> {
  payload: T;
  timer: ReturnType<typeof setTimeout>;
}

export function createAutosave<T = unknown>(options: AutosaveOptions<T>): Autosave<T> {
  const { save, delayMs = 300, onError, onSuccess } = options;

  const pending = new Map<string, PendingItem<T>>();
  const inFlight = new Set<Promise<void>>();
  let isDisposed = false;

  const onPageHide = () => {
    void flush();
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", onPageHide);
  }

  async function runSave(key: string, payload: T): Promise<void> {
    try {
      await save(key, payload);
      onSuccess?.(key, payload);
    } catch (err) {
      onError?.(err, key, payload);
    }
  }

  function schedule(key: string, payload: T): void {
    if (isDisposed) return;

    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      const item = pending.get(key);
      if (!item) return;
      pending.delete(key);
      const p = runSave(key, item.payload);
      inFlight.add(p);
      void p.finally(() => inFlight.delete(p));
    }, delayMs);

    pending.set(key, { payload, timer });
  }

  /**
   * Bản ghi vừa bị xóa (tab/project) phải bỏ luôn phần đang chờ, nếu không lần ghi debounce sẽ chạy
   * sau lệnh xóa và làm bản ghi sống lại trong IndexedDB.
   *
   * Không cần dọn "dấu lỗi" nào: không còn dấu nào để dọn.
   */
  function cancel(key?: string): void {
    if (key === undefined) {
      for (const item of pending.values()) clearTimeout(item.timer);
      pending.clear();
      return;
    }
    const item = pending.get(key);
    if (item) {
      clearTimeout(item.timer);
      pending.delete(key);
    }
  }

  /**
   * Ghi ngay phần đang chờ và chờ cả các lượt đang bay.
   *
   * Nuốt lỗi vào `onError` (không ném): bên gọi không dùng kết quả này để phán quyết "đã xuống đĩa"
   * — việc đó do `flushWorkspace()` đo bằng cách đối chiếu đĩa với store.
   */
  async function flush(): Promise<void> {
    if (pending.size === 0 && inFlight.size === 0) {
      return;
    }

    const tasks: Array<{ key: string; payload: T }> = [];
    for (const [key, item] of pending.entries()) {
      clearTimeout(item.timer);
      tasks.push({ key, payload: item.payload });
    }
    pending.clear();

    const currentInFlight = Array.from(inFlight);
    const newPromises = tasks.map(async ({ key, payload }) => {
      const p = runSave(key, payload);
      inFlight.add(p);
      try {
        await p;
      } finally {
        inFlight.delete(p);
      }
    });

    await Promise.all([...currentInFlight, ...newPromises]);
  }

  async function dispose(): Promise<void> {
    if (isDisposed) {
      return;
    }
    isDisposed = true;

    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("pagehide", onPageHide);
    }

    await flush();
  }

  function isPending(key?: string): boolean {
    if (key !== undefined) {
      return pending.has(key);
    }
    return pending.size > 0 || inFlight.size > 0;
  }

  return { schedule, flush, cancel, dispose, isPending };
}
