/**
 * Apps Store
 * State management for application operations
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { AppConfig, AppManifest } from '@/types/app';

interface AppsState {
  apps: Record<string, AppConfig>;
  loading: boolean;
  error: string | null;

  // Actions
  fetchApps: () => Promise<void>;
  toggleApp: (appId: string, enabled: boolean) => Promise<void>;
  uninstallApp: (appId: string) => Promise<void>;
  getAppManifest: (appId: string) => Promise<AppManifest>;
  getAppEntry: (appId: string) => Promise<string>;
}

export const useAppsStore = create<AppsState>((set) => ({
  apps: {},
  loading: false,
  error: null,

  fetchApps: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; apps: Record<string, AppConfig> }>('/api/apps');
      if (result.success) {
        set({ apps: result.apps, loading: false });
      } else {
        set({ loading: false, error: 'Failed to fetch apps' });
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  toggleApp: async (appId: string, enabled: boolean) => {
    try {
      const result = await hostApiFetch<{ success: boolean; apps: Record<string, AppConfig> }>(
        `/api/apps/${encodeURIComponent(appId)}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }
      );
      if (result.success) {
        set({ apps: result.apps });
      }
    } catch (error) {
      console.error('Failed to toggle app:', error);
      throw error;
    }
  },

  uninstallApp: async (appId: string) => {
    try {
      const result = await hostApiFetch<{ success: boolean; apps: Record<string, AppConfig> }>(
        `/api/apps/${encodeURIComponent(appId)}`,
        { method: 'DELETE' }
      );
      if (result.success) {
        set({ apps: result.apps });
      }
    } catch (error) {
      console.error('Failed to uninstall app:', error);
      throw error;
    }
  },

  getAppManifest: async (appId: string): Promise<AppManifest> => {
    const result = await hostApiFetch<{ success: boolean; manifest: AppManifest }>(
      `/api/apps/${encodeURIComponent(appId)}/manifest`
    );
    if (!result.success) {
      throw new Error('Failed to get app manifest');
    }
    return result.manifest;
  },

  getAppEntry: async (appId: string): Promise<string> => {
    return hostApiFetch<string>(`/api/apps/${encodeURIComponent(appId)}/entry`);
  },
}));
