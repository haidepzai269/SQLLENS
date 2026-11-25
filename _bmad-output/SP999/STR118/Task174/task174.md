# Task174: Nối Yjs P2P + ResultBroadcaster + Baton thuần DataChannel + `natWarning` vào `lab-workspace.tsx`

- **Epic / Story:** SP999 / STR118 — Cắm dây SP024 lên Production
- **Mục tiêu:** Nối toàn bộ lớp cộng tác P2P (`createRoomCollabProvider`, `createTabCollabExtension`, `createResultBroadcaster`, `useBatonStore` thuần DataChannel, `natWarning`) vào `lab-workspace.tsx` khi dự án đang mở có `cloud.remoteId`, đóng dòng nợ Task172 trong `SP999/README.md`, giữ 0 byte SQL gửi lên server và 0 ảnh hưởng dự án local thường.

## Phạm vi file (tuyệt đối không chạm `api/`, `room-provider.ts`, `types.ts`)
- `web/src/modules/room/collab/use-lab-room-collab.ts` *(tạo mới)*
- `web/src/modules/room/collab/use-lab-room-collab.test.ts` *(tạo mới)*
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/components/sql-editor/sql-editor.tsx` *(thêm prop tùy chọn `collabExtension?: Extension | null` qua `Compartment` để gắn/gỡ động không dựng lại `EditorView`)*

## Hợp đồng kỹ thuật chi tiết

### 1. Hook `web/src/modules/room/collab/use-lab-room-collab.ts`
- Đầu vào: `{ remoteProjectId: string | null; activeTabId: string | null; userId: string | null; onRemoteResult?: (res: P2pExecutionResult) => void; deps?: ... }` (có `deps` cho DI unit test).
- Khi `remoteProjectId` hoặc `userId` là `null`:
  - Reset `useBatonStore`, trả về `{ collabExtension: null, broadcastResult: null }`, **0 network call** (bảo toàn 100% dự án local thường).
- Khi có `remoteProjectId` và `userId`:
  1. Gọi `GET /api/v1/cloud/projects/${encodeURIComponent(remoteProjectId)}/members` (`credentials: "same-origin"`, `cache: "no-store"`) lấy danh sách thành viên → xác định `myRole`, `ownerId`, `memberNames`.
  2. Gọi `useBatonStore.getState().setRoom({ projectId: remoteProjectId, myUserId: userId, myRole })`, `setMemberNames(memberNames)`, và `syncFromServer()`.
  3. Khởi tạo `createRoomCollabProvider({ projectId: remoteProjectId, userId })` (hỗ trợ truyền `resolveSignalUrl` qua `deps` nếu cần, mặc định dùng cấu hình hiện có để không phụ thuộc biên dịch chéo với Task173).
  4. Khởi tạo `createResultBroadcaster({ sendControl: provider.sendControl, onControl: provider.onControl, ownerId })`.
  5. Gắn `useBatonStore.getState().setTransport({ sendControl: provider.sendControl })` và subscribe `provider.onControl` để chuyển các control message `baton:request` / `baton:grant` / `baton:return` vào `useBatonStore.getState().applyControlMessage(...)` (**thuần P2P DataChannel**, tuyệt đối không gọi `/baton/request`, `/baton/grant`, `/baton/heartbeat`).
  6. Subscribe `broadcaster.onNatWarning((visible) => useBatonStore.getState().setNatWarning(visible))` — đóng dòng nợ Task172!
  7. Subscribe `broadcaster.onResult((res) => onRemoteResult?.(res))`.
  8. Tạo và trả về `collabExtension` từ `createTabCollabExtension(provider.doc, activeTabId, provider.awareness, { readOnly: myRole === "viewer" })` (khi có `activeTabId`), cùng hàm `broadcastResult`.
  9. Cleanup khi đổi `remoteProjectId`, đổi `userId` hoặc unmount: gọi `broadcaster.destroy()`, `provider.destroy()`, `useBatonStore.getState().reset()`.

### 2. `web/src/components/sql-editor/sql-editor.tsx` & `web/src/modules/lab/lab-workspace.tsx`
- `sql-editor.tsx`: thêm prop tùy chọn `collabExtension?: Extension | null`, dùng `Compartment` riêng (`collabCompartment`) để `view.dispatch({ effects: collabCompartment.reconfigure(collabExtension ?? []) })` — không dựng lại `EditorView`, không làm hỏng test hiện có.
- `lab-workspace.tsx`:
  - Gọi `useLabRoomCollab` với `remoteProjectId = activeProject?.cloud?.remoteId ?? null`, `activeTabId`, `userId = auth.user?.id ?? null`.
  - Truyền `collabExtension` vào `<SqlEditor />`.
  - Khi `handleEditorRun` chạy xong trong phòng (có `broadcastResult`), phát `P2pExecutionResult` qua `broadcastResult(...)`.

## Tiêu chí nghiệm thu (AC1–AC6)
- **AC1:** Dự án local thường (`cloud.remoteId` không có) → 0 request `/members`, 0 WebSocket, `collabExtension = null`, mọi test cũ PASS 100%.
- **AC2:** Dự án có `cloud.remoteId` → tự động gọi `/members`, set `baton-store` (`myRole`, `memberNames`), nối `RoomCollabProvider` + `ResultBroadcaster`, trả `collabExtension` (`readOnly: true` khi `viewer`).
- **AC3:** Luồng Baton (`requestBaton`/`grantBaton`/`returnBaton`) đi 100% qua `provider.sendControl` (P2P DataChannel), **0 request REST** tới `/baton/request`, `/baton/grant`, `/baton/heartbeat`.
- **AC4:** Khi `broadcaster` bắn `natWarning = true` → `useBatonStore.getState().natWarning` tự chuyển `true` (và về `false` khi có peer kết nối); unmount/đổi dự án gọi đủ `destroy()` và `reset()`.
- **AC5:** `npm run check` và `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS 100%.
- **AC6:** Lập `ban_giao_task174.md` tại `_bmad-output/SP999/STR118/Task174/ban_giao_task174.md` đầy đủ số đo.
