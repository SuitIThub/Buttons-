import {
  NavSettings,
  Page,
  RuntimeState,
  Scene,
  SensorInfo,
  Settings,
  StatusResponse,
  VariableDef,
} from "./types";

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => req<StatusResponse>("/api/status"),

  getSettings: () => req<Settings>("/api/settings"),
  updateSettings: (patch: Partial<Settings>) =>
    req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  getNav: () => req<NavSettings>("/api/nav"),
  updateNav: (patch: Partial<NavSettings>) =>
    req<NavSettings>("/api/nav", { method: "PUT", body: JSON.stringify(patch) }),

  pullConfig: () => req<{ config: unknown }>("/api/config/pull", { method: "POST" }),
  getSensors: () => req<SensorInfo[]>("/api/sensors"),

  importConfig: (data: unknown) =>
    req<{ ok: boolean }>("/api/import", { method: "POST", body: JSON.stringify(data) }),
  deploy: () =>
    req<{ ok: boolean; pages: number; buttons: number; displays: number }>("/api/deploy", {
      method: "POST",
    }),

  getPages: () => req<Page[]>("/api/pages"),
  createPage: (page: Partial<Page>) =>
    req<Page>("/api/pages", { method: "POST", body: JSON.stringify(page) }),
  updatePage: (id: string, page: Partial<Page>) =>
    req<Page>(`/api/pages/${id}`, { method: "PUT", body: JSON.stringify(page) }),
  deletePage: (id: string) => req<{ ok: boolean }>(`/api/pages/${id}`, { method: "DELETE" }),
  reorderPages: (orderedIds: string[]) =>
    req<Page[]>("/api/pages/reorder", { method: "POST", body: JSON.stringify({ orderedIds }) }),

  getScenes: () => req<Scene[]>("/api/scenes"),
  getScene: (id: string) => req<Scene>(`/api/scenes/${id}`),
  createScene: (scene: Partial<Scene>) =>
    req<Scene>("/api/scenes", { method: "POST", body: JSON.stringify(scene) }),
  updateScene: (id: string, scene: Partial<Scene>) =>
    req<Scene>(`/api/scenes/${id}`, { method: "PUT", body: JSON.stringify(scene) }),
  deleteScene: (id: string) => req<{ ok: boolean }>(`/api/scenes/${id}`, { method: "DELETE" }),
  runGroup: (sceneId: string, groupId: string) =>
    req<{ ok: boolean }>(`/api/scenes/${sceneId}/groups/${groupId}/run`, { method: "POST" }),

  getVariables: () => req<VariableDef[]>("/api/variables"),
  setVariables: (variables: VariableDef[]) =>
    req<VariableDef[]>("/api/variables", { method: "PUT", body: JSON.stringify({ variables }) }),
  setVariableValue: (name: string, value: unknown) =>
    req<{ ok: boolean }>(`/api/variables/${encodeURIComponent(name)}/value`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  renameVariable: (name: string, newName: string) =>
    req<{ ok: boolean; variables: VariableDef[] }>(
      `/api/variables/${encodeURIComponent(name)}/rename`,
      { method: "POST", body: JSON.stringify({ newName }) },
    ),

  searchIcons: (q: string, limit = 120) =>
    req<{ icons: { name: string; path: string }[]; total: number }>(
      `/api/icons?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  lookupIcons: (names: string[]) =>
    req<{ icons: { name: string; path: string }[]; total: number }>(
      `/api/icons?names=${encodeURIComponent(names.join(","))}`,
    ),

  runtimeState: () => req<RuntimeState>("/api/runtime/state"),
  restartRuntime: () => req<{ ok: boolean }>("/api/runtime/restart", { method: "POST" }),
  preview: (payload: { expression?: string; template?: string }) =>
    req<{ ok: boolean; result?: unknown; error?: string }>("/api/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
