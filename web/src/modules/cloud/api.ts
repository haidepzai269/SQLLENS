// Lớp gọi API cloud (SP023 / Task153).
//
// Chỉ là HTTP: không đụng IndexedDB, không giữ trạng thái. `sync.ts` ghép lớp này với workspace
// cục bộ. Không log gì ở đây: nội dung SQL đi qua đây và Core Rule 7 cấm ghi log SQL.

import { isApiError } from "@/contracts/api-error";

export type CloudEngine = "postgres" | "mysql" | "sqlite";

export type CloudTab = { name: string; sql: string; position: number };

export type CloudProject = {
  id: string;
  name: string;
  engine: CloudEngine;
  tabCount: number;
  createdAt: string;
  updatedAt: string;
  tabs?: CloudTab[];
};

export type CloudProjectPayload = {
  name: string;
  engine: CloudEngine;
  tabs: { name: string; sql: string }[];
  /** Mốc server ở lần đồng bộ trước. Vắng = tạo mới, không có gì để xung đột. */
  baseUpdatedAt?: string;
};

export class CloudApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, CloudApiError.prototype);
  }
}

/** 409: server đã bị máy khác sửa trước. Mang mốc của server để UI hiển thị hai bên. */
export class CloudConflictError extends CloudApiError {
  readonly remoteUpdatedAt: string;

  constructor(remoteUpdatedAt: string) {
    super(409, "conflict", "Dự án trên cloud đã được sửa ở nơi khác");
    this.name = "CloudConflictError";
    this.remoteUpdatedAt = remoteUpdatedAt;
    Object.setPrototypeOf(this, CloudConflictError.prototype);
  }
}

export interface CloudRequestOptions {
  /** Test truyền fetch giả; mặc định fetch của trình duyệt. */
  fetchImpl?: typeof fetch;
}

const BASE = "/api/v1/cloud/projects";

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failureFrom(status: number, body: unknown): CloudApiError {
  const code = isApiError(body) ? body.error.code : "unknown";
  const conflict = (body as { conflict?: { remoteUpdatedAt?: unknown } } | null)?.conflict;
  const remote = conflict?.remoteUpdatedAt;
  if (status === 409 && typeof remote === "string") return new CloudConflictError(remote);
  return new CloudApiError(status, code, `Máy chủ từ chối yêu cầu cloud (${status})`);
}

// Kiểm tối thiểu dữ liệu từ server: đây là dữ liệu qua mạng, không tin kiểu.
function projectFrom(body: unknown): CloudProject {
  const project = (body as { project?: unknown } | null)?.project;
  if (typeof project !== "object" || project === null) {
    throw new CloudApiError(0, "invalid_response", "Máy chủ trả về dữ liệu dự án không hợp lệ");
  }
  const p = project as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.engine !== "string") {
    throw new CloudApiError(0, "invalid_response", "Máy chủ trả về dữ liệu dự án không hợp lệ");
  }
  if (typeof p.updatedAt !== "string" || typeof p.createdAt !== "string") {
    throw new CloudApiError(0, "invalid_response", "Máy chủ thiếu mốc thời gian của dự án");
  }
  const tabs = Array.isArray(p.tabs)
    ? p.tabs.flatMap((tab): CloudTab[] => {
        if (typeof tab !== "object" || tab === null) return [];
        const t = tab as Record<string, unknown>;
        if (typeof t.name !== "string" || typeof t.sql !== "string") return [];
        return [{ name: t.name, sql: t.sql, position: typeof t.position === "number" ? t.position : 0 }];
      })
    : undefined;
  return {
    id: p.id,
    name: p.name,
    engine: p.engine as CloudEngine,
    tabCount: typeof p.tabCount === "number" ? p.tabCount : (tabs?.length ?? 0),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    tabs,
  };
}

async function send(
  method: "GET" | "POST" | "PUT",
  path: string,
  payload: CloudProjectPayload | undefined,
  options: CloudRequestOptions,
): Promise<CloudProject> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await readJson(res);
  if (!res.ok) throw failureFrom(res.status, body);
  return projectFrom(body);
}

/** Đọc một dự án kèm toàn bộ tab theo đúng thứ tự. */
export function getCloudProject(id: string, options: CloudRequestOptions = {}): Promise<CloudProject> {
  return send("GET", `${BASE}/${encodeURIComponent(id)}`, undefined, options);
}

/** Tạo dự án mới trên cloud. Không có `baseUpdatedAt` nên không thể xung đột. */
export function createCloudProject(
  payload: CloudProjectPayload,
  options: CloudRequestOptions = {},
): Promise<CloudProject> {
  return send("POST", BASE, payload, options);
}

/** Ghi đè dự án trên cloud, có điều kiện `baseUpdatedAt` khi đã từng đồng bộ. */
export function updateCloudProject(
  id: string,
  payload: CloudProjectPayload,
  options: CloudRequestOptions = {},
): Promise<CloudProject> {
  return send("PUT", `${BASE}/${encodeURIComponent(id)}`, payload, options);
}

/** Xóa vĩnh viễn dự án trên cloud. Server trả 204, không có thân. */
export async function deleteCloudProject(
  id: string,
  options: CloudRequestOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.ok) return;
  throw failureFrom(res.status, await readJson(res));
}
