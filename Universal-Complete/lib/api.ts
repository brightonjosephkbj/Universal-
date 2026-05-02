import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_KEY = 'universal_server_url';
export const DEFAULT_SERVER = 'https://universal-server.onrender.com';

export async function getServerUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(SERVER_KEY);
    return stored || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

export async function setServerUrl(url: string) {
  await AsyncStorage.setItem(SERVER_KEY, url);
}

async function request<T>(method: string, path: string, body?: object): Promise<T> {
  const base = await getServerUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const get   = <T>(path: string) => request<T>('GET', path);
const post  = <T>(path: string, body?: object) => request<T>('POST', path, body);
const patch = <T>(path: string, body?: object) => request<T>('PATCH', path, body);
const del   = <T>(path: string) => request<T>('DELETE', path);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Download {
  id: string;
  url: string;
  title: string;
  platform: string;
  format: string;
  quality: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;
  speed: number;
  eta: number;
  file_path: string | null;
  file_size: number;
  thumbnail: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface LibraryItem {
  id: string;
  download_id: string | null;
  title: string;
  type: 'video' | 'audio' | 'podcast' | 'image';
  source: string | null;
  format: string | null;
  quality: string | null;
  file_size: number;
  file_path: string;
  duration: number | null;
  thumbnail: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  created_at: string;
}

export interface VideoInfo {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  platform: string;
  description: string | null;
  viewCount: number | null;
  likeCount: number | null;
}

export interface Conversion {
  id: string;
  library_item_id: string;
  tool: string;
  output_format: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  output_path: string | null;
  output_size: number;
  error_message: string | null;
  options: string;
  created_at: string;
  updated_at: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const api = {
  health: () => get<{ status: string; version: string }>('/health'),
  info:   (url: string) => post<VideoInfo>('/api/info', { url }),

  downloads: {
    list:    (status?: string) => get<Download[]>(`/api/downloads${status ? `?status=${status}` : ''}`),
    active:  () => get<Download[]>('/api/downloads/active'),
    get:     (id: string) => get<Download>(`/api/downloads/${id}`),
    create:  (data: { url: string; format: string; quality: string }) =>
      post<Download>('/api/downloads', data),
    pause:   (id: string) => post<{ success: boolean }>(`/api/downloads/${id}/pause`),
    resume:  (id: string) => post<{ success: boolean }>(`/api/downloads/${id}/resume`),
    cancel:  (id: string) => del<{ success: boolean }>(`/api/downloads/${id}`),
    fileUrl: async (id: string) => `${await getServerUrl()}/api/downloads/${id}/file`,
  },

  library: {
    list: (params?: { type?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.type) qs.set('type', params.type);
      if (params?.q)    qs.set('q', params.q);
      const q = qs.toString();
      return get<LibraryItem[]>(`/api/library${q ? `?${q}` : ''}`);
    },
    stats:     () => get<{ total: number; byType: { type: string; count: number }[]; totalSize: number }>('/api/library/stats'),
    get:       (id: string) => get<LibraryItem>(`/api/library/${id}`),
    update:    (id: string, data: Partial<LibraryItem>) => patch<LibraryItem>(`/api/library/${id}`, data),
    delete:    (id: string) => del<{ success: boolean }>(`/api/library/${id}`),
    streamUrl: async (id: string) => `${await getServerUrl()}/api/library/${id}/stream`,
  },

  tools: {
    check: () => get<{ ffmpeg: boolean }>('/api/tools/check'),

    conversions: {
      list:   (status?: string) => get<Conversion[]>(`/api/tools/conversions${status ? `?status=${status}` : ''}`),
      get:    (id: string) => get<Conversion>(`/api/tools/conversions/${id}`),
      delete: (id: string) => del<{ success: boolean }>(`/api/tools/conversions/${id}`),
      fileUrl: async (id: string) => `${await getServerUrl()}/api/tools/conversions/${id}/file`,
    },

    videoToAudio: (libraryItemId: string, outputFormat: string) =>
      post<{ id: string; status: string }>('/api/tools/video-to-audio', { libraryItemId, outputFormat }),

    formatConvert: (libraryItemId: string, outputFormat: string) =>
      post<{ id: string; status: string }>('/api/tools/format-convert', { libraryItemId, outputFormat }),

    trim: (libraryItemId: string, startTime: number, endTime: number, outputFormat?: string) =>
      post<{ id: string; status: string }>('/api/tools/trim', { libraryItemId, startTime, endTime, outputFormat }),

    compress: (libraryItemId: string, quality: 'high' | 'medium' | 'low') =>
      post<{ id: string; status: string }>('/api/tools/compress', { libraryItemId, quality }),

    merge: (libraryItemIds: string[], outputFormat: string) =>
      post<{ id: string; status: string }>('/api/tools/merge', { libraryItemIds, outputFormat }),

    thumbnail: (libraryItemId: string, timestamp: number) =>
      post<{ id: string; status: string }>('/api/tools/thumbnail', { libraryItemId, timestamp }),
  },

  settings: {
    get:  () => get<Record<string, any>>('/api/settings'),
    set:  (data: Record<string, any>) => post<{ success: boolean }>('/api/settings', data),
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSpeed(mbps: number): string {
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(mbps * 1024).toFixed(0)} KB/s`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function platformColor(platform: string): string {
  const map: Record<string, string> = {
    youtube:    '#FF0000',
    tiktok:     '#69C9D0',
    instagram:  '#E1306C',
    twitter:    '#1DA1F2',
    soundcloud: '#FF5500',
    vimeo:      '#1AB7EA',
    facebook:   '#1877F2',
  };
  return map[platform] || '#00B4D8';
}

export function platformIcon(platform: string): string {
  const map: Record<string, string> = {
    youtube:    '▶',
    tiktok:     '♪',
    instagram:  '◈',
    twitter:    '𝕏',
    soundcloud: '☁',
    vimeo:      '◉',
    facebook:   'f',
  };
  return map[platform] || '◎';
}
