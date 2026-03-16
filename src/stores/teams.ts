/**
 * Teams Store
 * State management for team operations
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { Team, CreateTeamData, UpdateTeamData } from '@/types/team';

interface TeamsState {
  teams: Team[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchTeams: () => Promise<void>;
  createTeam: (data: CreateTeamData) => Promise<void>;
  updateTeam: (teamId: string, data: UpdateTeamData) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  getTeam: (teamId: string) => Promise<Team | null>;
}

export const useTeamsStore = create<TeamsState>((set) => ({
  teams: [],
  loading: false,
  error: null,

  fetchTeams: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; teams: Team[] }>('/api/teams');
      if (result.success) {
        set({ teams: result.teams, loading: false });
      } else {
        set({ loading: false, error: 'Failed to fetch teams' });
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createTeam: async (data: CreateTeamData) => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; teams: Team[] }>('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (result.success) {
        set({ teams: result.teams, loading: false });
      } else {
        set({ loading: false, error: 'Failed to create team' });
        throw new Error('Failed to create team');
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  updateTeam: async (teamId: string, data: UpdateTeamData) => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; teams: Team[] }>(`/api/teams/${teamId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (result.success) {
        set({ teams: result.teams, loading: false });
      } else {
        set({ loading: false, error: 'Failed to update team' });
        throw new Error('Failed to update team');
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  deleteTeam: async (teamId: string) => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; teams: Team[] }>(`/api/teams/${teamId}`, {
        method: 'DELETE',
      });
      if (result.success) {
        set({ teams: result.teams, loading: false });
      } else {
        set({ loading: false, error: 'Failed to delete team' });
        throw new Error('Failed to delete team');
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  getTeam: async (teamId: string): Promise<Team | null> => {
    try {
      const result = await hostApiFetch<{ success: boolean; team: Team }>(`/api/teams/${teamId}`);
      if (result.success) {
        return result.team;
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch team:', error);
      return null;
    }
  },
}));
