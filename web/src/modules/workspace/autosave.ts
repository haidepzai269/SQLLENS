// Bộ autosave gộp ghi (debounce) cho workspace.
// Giúp thao tác gõ phím liên tục không tạo hàng trăm giao dịch IndexedDB.
// Flush tự động khi pagehide hoặc khi người dùng chủ động yêu cầu.

export interface AutosaveOptions<T = unknown> {
  save: (key: string, payload: T) => Promise<void>;
  delayMs?: number;
  onError?: (error: unknown, key: string, payload: T) => void;
  onSuccess?: (key: string, payload: T) => void;
}

export interface Autosave<T = unknown> {
  schedule: (key: string, payload: T) => void;
  flush: () => Promise<void>;
  /**
   * Như `flush` nhưng NÉM lỗi ghi đầu tiên thay vì nuốt vào `onError`. Dùng khi bên gọi phải biết
   * dữ liệu đã thật sự xuống đĩa chưa rồi mới quyết định bước tiếp (ví dụ đẩy lên cloud).
   */
  flushStrict: () => Promise<void>;
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
  // Lỗi ghi gần nhất chưa được xóa bởi một lượt ghi thành công. Xem `flushStrict`.
  let lastFailure: unknown;

  const onPageHide = () => {
    void flush();
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", onPageHide);
  }

  async function executeSave(key: string, payload: T): Promise<void> {
    try {
      await save(key, payload);
      // Ghi được rồi thì lỗi cũ không còn nghĩa: đĩa đã nhận bản mới nhất.
      lastFailure = undefined;
      onSuccess?.(key, payload);
    } catch (err) {
      // Nhớ lại: đây là đường debounce, lỗi bị nuốt vào `onError`. Không nhớ thì lần bấm Lưu
      // sau (khi `pending` đã rỗng) sẽ tưởng mọi thứ đã xuống đĩa và đẩy bản cũ lên cloud.
      lastFailure = err;
      onError?.(err, key, payload);
    }
  }

  function schedule(key: string, payload: T): void {
    if (isDisposed) return;

    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
      pending.delete(key);
      const promise = executeSave(key, payload);
      inFlight.add(promise);
      try {
        await promise;
      } finally {
        inFlight.delete(promise);
      }
    }, delayMs);

    pending.set(key, { payload, timer });
  }

  // Bản ghi vừa bị xóa (tab/project) phải bỏ luôn phần đang chờ, nếu không lần ghi
  // debounce sẽ chạy sau lệnh xóa và làm bản ghi sống lại trong IndexedDB.
  function cancel(key?: string): void {
    if (key === undefined) {
      for (const [pendingKey, item] of pending.entries()) {
        clearTimeout(item.timer);
        pending.delete(pendingKey);
      }
      return;
    }
    const item = pending.get(key);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(key);
  }

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
      const p = executeSave(key, payload);
      inFlight.add(p);
      try {
        await p;
      } finally {
        inFlight.delete(p);
      }
    });

    await Promise.all([...currentInFlight, ...newPromises]);
  }

  /**
   * `executeSave` nuốt lỗi vào `onError` nên `flush()` resolve dù ghi hỏng. `flushStrict` chạy
   * lại cùng đường nhưng gom lỗi ra ngoài: bên gọi phải dừng khi dữ liệu chưa xuống đĩa, thay vì
   * tưởng đã tươi rồi đọc ra bản cũ.
   *
   * Quan trọng: lỗi ghi TRƯỚC ĐÓ cũng phải làm ném, không chỉ lỗi trong chính lượt này. Đĩa đầy
   * lúc đang gõ thì lượt debounce hỏng và `pending` rỗng; lúc bấm Lưu, `flushStrict` không có gì
   * để ghi nên sẽ "thành công" trong khi dữ liệu mới nhất chưa bao giờ xuống đĩa. Vì vậy nhớ lại
   * lỗi gần nhất cho tới khi có một lượt ghi thành công.
   */
  async function flushStrict(): Promise<void> {
    const errors: unknown[] = [];

    const tasks: Array<{ key: string; payload: T }> = [];
    for (const [key, item] of pending.entries()) {
      clearTimeout(item.timer);
      tasks.push({ key, payload: item.payload });
    }
    pending.clear();

    const currentInFlight = Array.from(inFlight);

    const newPromises = tasks.map(async ({ key, payload }) => {
      const p = (async () => {
        try {
          await save(key, payload);
          onSuccess?.(key, payload);
        } catch (err) {
          errors.push(err);
          onError?.(err, key, payload);
        }
      })();
      inFlight.add(p);
      try {
        await p;
      } finally {
        inFlight.delete(p);
      }
    });

    await Promise.all([...currentInFlight, ...newPromises]);

    if (errors.length > 0) {
      lastFailure = errors[0];
      throw errors[0];
    }
    // Không có lượt ghi nào trong lần này: vẫn phải báo lỗi còn treo từ lượt trước, nếu không
    // "gõ khi đĩa đầy rồi bấm Lưu" sẽ đẩy bản cũ lên cloud và báo thành công.
    if (lastFailure !== undefined && tasks.length === 0) throw lastFailure;
    lastFailure = undefined;
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

  return {
    schedule,
    flush,
    flushStrict,
    cancel,
    dispose,
    isPending,
  };
}
