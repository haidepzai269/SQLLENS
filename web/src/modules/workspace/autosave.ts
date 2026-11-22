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
  /**
   * Còn key nào có dữ liệu chưa xuống đĩa vì lượt ghi trước hỏng không.
   *
   * Dùng thay cho việc đọc `saveState` của store: `saveState` là trạng thái TỨC THỜI, bị đặt về
   * `idle` bởi bất kỳ lượt ghi thành công nào — kể cả của key khác — nên không dùng làm bằng
   * chứng "mọi thứ đã xuống đĩa" được.
   */
  hasPendingFailures: () => boolean;
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
  /**
   * ĐẾM số lượt ghi chưa settle của từng key, không phải tập hợp.
   *
   * Cùng một key có thể có NHIỀU lượt ghi cùng bay (gõ liên tục vượt qua cả debounce và flush).
   * Dùng `Set<string>` thì lượt thứ nhất settle là xoá mất key, `forgetEpochIfIdle` tưởng key rảnh
   * và xoá luôn thế hệ, rồi lượt thứ hai hỏng muộn thấy `0 === 0` nên dựng lại dấu lỗi cho một key
   * đã chết — nút Lưu cloud chết tới khi F5 (reviewer vòng 7, N1).
   */
  const inFlightKeys = new Map<string, number>();
  let isDisposed = false;
  // Key nào đang có dữ liệu CHƯA xuống đĩa vì lượt ghi gần nhất của nó hỏng.
  //
  // Phải theo TỪNG KEY, không phải một biến "lỗi gần nhất": một lượt ghi thành công của key khác
  // (tab khác, hoặc hàng project) không chứng minh gì về key đang hỏng. Dùng biến vô hướng thì
  // "tab A ghi hỏng → tab B ghi được → bấm Lưu" sẽ đẩy bản cũ của A lên cloud và báo thành công.
  const failedKeys = new Set<string>();
  /**
   * Thế hệ của từng key, tăng mỗi khi key bị huỷ hoặc được xếp lịch lại.
   *
   * Cần vì một lượt ghi có thể còn ĐANG BAY khi `cancel(key)` chạy (người dùng đóng tab đúng lúc
   * transaction chưa commit). Lượt ghi đó hỏng MUỘN, sau `cancel`, và nếu cứ `failedKeys.add(key)`
   * thì dấu lỗi sống lại trên một key đã chết — bản ghi không còn nên không bao giờ ghi lại được,
   * `hasPendingFailures()` đúng vĩnh viễn và nút Lưu cloud chết tới khi F5.
   *
   * Mỗi lượt ghi nhớ thế hệ lúc nó bắt đầu; ghi xong mà thế hệ đã đổi thì kết quả của nó không
   * còn nghĩa (key đã bị huỷ, hoặc đã có lượt ghi mới hơn), nên bỏ qua.
   */
  const keyEpoch = new Map<string, number>();

  const epochOf = (key: string): number => keyEpoch.get(key) ?? 0;
  const bumpEpoch = (key: string): void => {
    keyEpoch.set(key, epochOf(key) + 1);
  };
  /**
   * Dọn thế hệ của key không còn gì để bảo vệ: không chờ ghi, không đang bay, không có lỗi.
   *
   * Không dọn thì Map phình mãi theo số tab/dự án người dùng từng mở trong một phiên. Xoá được vì
   * thế hệ chỉ có nghĩa so với một lượt ghi đang bay của CÙNG key; không còn lượt nào thì 0 là đủ.
   */
  const forgetEpochIfIdle = (key: string): void => {
    if (!pending.has(key) && !failedKeys.has(key) && !inFlightKeys.has(key)) keyEpoch.delete(key);
  };

  /** Đánh dấu một lượt ghi của `key` bắt đầu bay. */
  const beginFlight = (key: string): void => {
    inFlightKeys.set(key, (inFlightKeys.get(key) ?? 0) + 1);
  };
  /** Đánh dấu một lượt ghi của `key` đã settle; chỉ nhả key khi không còn lượt nào. */
  const endFlight = (key: string): void => {
    const left = (inFlightKeys.get(key) ?? 1) - 1;
    if (left > 0) inFlightKeys.set(key, left);
    else inFlightKeys.delete(key);
    forgetEpochIfIdle(key);
  };

  const onPageHide = () => {
    void flush();
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", onPageHide);
  }

  async function executeSave(key: string, payload: T, epoch: number): Promise<void> {
    try {
      await save(key, payload);
      // Key NÀY đã xuống đĩa: xóa dấu lỗi của chính nó. Không đụng key khác.
      if (epoch === epochOf(key)) failedKeys.delete(key);
      onSuccess?.(key, payload);
    } catch (err) {
      // Nhớ lại: đây là đường debounce, lỗi bị nuốt vào `onError`. Không nhớ thì lần bấm Lưu
      // sau (khi `pending` đã rỗng) sẽ tưởng mọi thứ đã xuống đĩa và đẩy bản cũ lên cloud.
      //
      // Bỏ qua nếu thế hệ đã đổi: key đã bị huỷ (tab bị đóng) trong lúc lượt ghi còn bay. Ghi dấu
      // lúc này là dấu lỗi vĩnh viễn trên bản ghi không còn tồn tại.
      if (epoch === epochOf(key)) failedKeys.add(key);
      onError?.(err, key, payload);
    }
  }

  function schedule(key: string, payload: T): void {
    if (isDisposed) return;

    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Đổi thế hệ cho MỖI lượt xếp lịch mới.
    //
    // Không bump ở đây thì hai lượt ghi cùng key dùng chung một thế hệ, và lượt CŨ settle muộn sẽ
    // xoá dấu lỗi THẬT của lượt MỚI: ghi "BẢN CŨ" → ghi "BẢN MỚI" → "BẢN MỚI" hỏng thật → "BẢN CŨ"
    // thành công muộn → `failedKeys.delete(key)` → `flushStrict` tuyên bố xong trong khi bản mới
    // chưa bao giờ xuống đĩa. Đó đúng là bug gốc của Task154 (reviewer vòng 7, N2).
    bumpEpoch(key);

    const timer = setTimeout(async () => {
      pending.delete(key);
      const epoch = epochOf(key);
      beginFlight(key);
      const promise = executeSave(key, payload, epoch);
      inFlight.add(promise);
      try {
        await promise;
      } finally {
        inFlight.delete(promise);
        endFlight(key);
      }
    }, delayMs);

    pending.set(key, { payload, timer });
  }

  // Bản ghi vừa bị xóa (tab/project) phải bỏ luôn phần đang chờ, nếu không lần ghi
  // debounce sẽ chạy sau lệnh xóa và làm bản ghi sống lại trong IndexedDB.
  //
  // Xóa luôn dấu lỗi của key: bản ghi không còn thì "dữ liệu chưa xuống đĩa" của nó cũng hết
  // nghĩa. Không xóa thì một lần ghi hỏng trước khi xóa tab sẽ làm `hasPendingFailures()` đúng
  // vĩnh viễn, và mọi lần bấm Lưu sau đó đều bị chặn — tính năng lưu cloud chết hẳn cho tới khi
  // tải lại trang.
  function cancel(key?: string): void {
    if (key === undefined) {
      for (const [pendingKey, item] of pending.entries()) {
        clearTimeout(item.timer);
        pending.delete(pendingKey);
      }
      // Phải gom ĐỦ mọi key còn sống, không chỉ key đã có mặt trong `keyEpoch`: key đang bay mà
      // chưa từng bị bump thì không có trong Map, nên lặp riêng `keyEpoch` sẽ bỏ sót nó và kết quả
      // muộn của nó ghi dấu lỗi trở lại (reviewer vòng 7, N6). `Array.from` vì `bumpEpoch` ghi vào
      // chính Map đang lặp.
      const known = new Set<string>([...keyEpoch.keys(), ...pending.keys(), ...failedKeys, ...inFlightKeys.keys()]);
      for (const knownKey of known) bumpEpoch(knownKey);
      failedKeys.clear();
      for (const knownKey of known) forgetEpochIfIdle(knownKey);
      return;
    }
    // Đổi thế hệ TRƯỚC khi xóa dấu: lượt ghi đang bay của key này sẽ thấy thế hệ lệch và bỏ qua.
    bumpEpoch(key);
    failedKeys.delete(key);
    const item = pending.get(key);
    if (item) {
      clearTimeout(item.timer);
      pending.delete(key);
    }
    forgetEpochIfIdle(key);
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
      const epoch = epochOf(key);
      beginFlight(key);
      const p = executeSave(key, payload, epoch);
      inFlight.add(p);
      try {
        await p;
      } finally {
        inFlight.delete(p);
        endFlight(key);
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
   * để ghi nên sẽ "thành công" trong khi dữ liệu mới nhất chưa bao giờ xuống đĩa. Vì vậy nhớ key
   * nào còn hỏng, và chỉ xóa dấu khi chính key đó ghi được.
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
      const epoch = epochOf(key);
      beginFlight(key);
      const p = (async () => {
        try {
          await save(key, payload);
          if (epoch === epochOf(key)) failedKeys.delete(key);
          onSuccess?.(key, payload);
        } catch (err) {
          if (epoch === epochOf(key)) failedKeys.add(key);
          errors.push(err);
          onError?.(err, key, payload);
        }
      })();
      inFlight.add(p);
      try {
        await p;
      } finally {
        inFlight.delete(p);
        endFlight(key);
      }
    });

    await Promise.all([...currentInFlight, ...newPromises]);

    if (errors.length > 0) throw errors[0];
    // Key nào đã hỏng ở lượt trước mà lần này không được ghi lại thì vẫn phải báo: bấm Lưu lúc
    // `pending` rỗng (vì lượt debounce đã chạy và hỏng) không được coi là "mọi thứ đã xuống đĩa".
    // Dùng `failedKeys` chứ không phải "lỗi gần nhất": lượt ghi thành công của key KHÁC không
    // chứng minh gì về key này.
    if (failedKeys.size > 0) {
      throw new Error("Còn dữ liệu chưa ghi được xuống máy");
    }
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

  function hasPendingFailures(): boolean {
    return failedKeys.size > 0;
  }

  return {
    schedule,
    flush,
    flushStrict,
    cancel,
    hasPendingFailures,
    dispose,
    isPending,
  };
}
