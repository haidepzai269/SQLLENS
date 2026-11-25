# Bàn giao Task174: Nối Yjs P2P + ResultBroadcaster + Baton thuần DataChannel + `natWarning` vào `lab-workspace.tsx`

- **Epic / Story:** SP999 / STR118 — Cắm dây SP024 lên Production
- **Worktree:** `C:\Users\admin\.gemini\antigravity\worktrees\82139e6a-71c8-4096-a13b-379c481c37b2\swarm-dev-174-d49c5b4a`
- **Nhánh:** `swarm-dev-174-d49c5b4a`

## 1. Phạm vi file đã triển khai (tuân thủ không chạm `api/`, `room-provider.ts`, `types.ts`)
- `web/src/modules/room/collab/use-lab-room-collab.ts` *(tạo mới)*:
  - Hook `useLabRoomCollab({ remoteProjectId, activeTabId, userId, onRemoteResult, deps })`.
  - Khi `remoteProjectId` hoặc `userId` là `null`: reset `useBatonStore` (nếu cần), trả `{ collabExtension: null, broadcastResult: null }`, 0 network call.
  - Khi có `remoteProjectId` và `userId`:
    1. Gọi `GET /api/v1/cloud/projects/${encodeURIComponent(remoteProjectId)}/members` (`credentials: "same-origin"`, `cache: "no-store"`) để lấy `myRole`, `ownerId`, `memberNames`.
    2. Cập nhật `useBatonStore` (`setRoom`, `setMemberNames`, `syncFromServer`).
    3. Khởi tạo `createRoomCollabProvider({ projectId: remoteProjectId, userId })` (hỗ trợ `resolveSignalUrl` qua `deps`) và gọi `provider.connect()`.
    4. Khởi tạo `createResultBroadcaster({ sendControl: provider.sendControl, onControl: provider.onControl, ownerId })`.
    5. Nối `useBatonStore.getState().setTransport({ sendControl: provider.sendControl })` và subscribe `provider.onControl` để đẩy `baton:request` / `baton:grant` / `baton:return` vào `applyControlMessage` (thuần DataChannel, 0 REST call tới `/baton/request`, `/baton/grant`, `/baton/heartbeat`).
    6. Subscribe `broadcaster.onNatWarning((visible) => useBatonStore.getState().setNatWarning(visible))` — đóng dòng nợ Task172.
    7. Subscribe `broadcaster.onResult((res) => onRemoteResult?.(res))` và báo `broadcaster.reportPeerConnected()` khi có peer qua `awareness` / `getPeerIds()`.
    8. Tạo `collabExtension` qua `createTabCollabExtension(provider.doc, activeTabId, provider.awareness, { readOnly: myRole === "viewer" })`.
    9. Cleanup đầy đủ `broadcaster.destroy()`, `provider.destroy()`, `setTransport(null)`, `reset()` khi unmount hoặc đổi `remoteProjectId` / `userId`.
- `web/src/modules/room/collab/use-lab-room-collab.test.ts` *(tạo mới)*: 4 unit test bao phủ AC1–AC4 và luồng `broadcastResult` / `onRemoteResult`.
- `web/src/components/sql-editor/sql-editor.tsx` & `web/src/components/sql-editor/sql-editor-impl.tsx`:
  - Thêm prop tùy chọn `collabExtension?: Extension | null`.
  - Dùng `Compartment` riêng (`collabCompartment`) và `useEffect` phụ thuộc `[view, collabCompartment, collabExtension, extensions]` để `view.dispatch({ effects: collabCompartment.reconfigure(collabExtension ?? []) })` cả khi `collabExtension` đổi lẫn khi `extensions` đổi (`uiw` reconfigure), không dựng lại `EditorView` và không làm mất `collabExtension` sau DDL.
- `web/src/modules/lab/lab-workspace.tsx`:
  - Nối `useLabRoomCollab` với `remoteProjectId = activeProject?.cloud?.remoteId ?? null`, `activeTab?.id ?? null`, `user?.id ?? null`.
  - Truyền `collabExtension` vào `<SqlEditor />`.
  - Phát `P2pExecutionResult` qua `broadcastResult` sau khi `run(...)` hoàn tất (hoặc gặp `sql_error`) và hiển thị kết quả từ xa qua `onRemoteResult` (gọi `setOwner(engine)` để không bị `mine = owner === engine` che mất nếu trước đó vừa đổi engine).

## 2. Kết quả kiểm chứng thực tế & Số đo
- **Unit test riêng `use-lab-room-collab.test.ts`:** `4/4 passed` (261ms).
- **`npm run check` (`web/`):** PASS 100%:
  - `check:i18n`: PASS
  - `eslint`: 0 errors (3 warnings có sẵn ở `e2e/plan-explain.spec.ts` và `room-provider.test.ts`)
  - `tsc --noEmit`: 0 errors
  - `vitest run`: **138 passed | 2 skipped (140 files)**, **1583 passed | 18 skipped (1601 tests)** trong `285.50s` (tăng +4 test mới so với mốc 1579 của Task172; 2 file skip là `conflict-sim/golden/golden.test.ts` và `capacity.pg.test.ts` do không đặt `T051_DATABASE_URL`/`T055_DATABASE_URL`).
- **`API_ORIGIN=http://127.0.0.1:8080 npm run build` (`web/`):** PASS 100%:
  - `Compiled successfully in 12.1s`
  - `Finished TypeScript in 14.3s`
  - `Generating static pages using 11 workers (84/84) in 8.7s`

## 3. Đối chiếu Tiêu chí Nghiệm thu (AC1–AC6)
- **AC1:** Dự án local thường (`cloud.remoteId` không có) -> 0 request `/members`, 0 WebSocket, `collabExtension = null`, toàn bộ test cũ PASS -> **ĐẠT**.
- **AC2:** Dự án có `cloud.remoteId` -> gọi `/members`, set `baton-store`, nối `RoomCollabProvider` + `ResultBroadcaster`, trả `collabExtension` (`readOnly: true` khi `viewer`) -> **ĐẠT**.
- **AC3:** Luồng Baton (`requestBaton` / `grantBaton` / `returnBaton`) đi 100% qua `provider.sendControl` (P2P DataChannel), 0 REST call tới `/baton/request`, `/baton/grant`, `/baton/heartbeat` -> **ĐẠT**.
- **AC4:** `broadcaster.onNatWarning` cập nhật `useBatonStore.getState().natWarning`, cleanup gọi đủ `destroy()` và `reset()` -> **ĐẠT**.
- **AC5:** `npm run check` và `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS 100% -> **ĐẠT**.
- **AC6:** File bàn giao này tại `c:\SQLLens\_bmad-output\SP999\STR118\Task174\ban_giao_task174.md` -> **ĐẠT**.
