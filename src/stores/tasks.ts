/**
 * Tasks Store
 * State management for task operations
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { Task, CreateTaskData, TaskStatistics } from '@/types/task';

interface TasksState {
  tasks: Task[];
  statistics: TaskStatistics | null;
  loading: boolean;
  error: string | null;

  // Actions
  fetchTasks: () => Promise<void>;
  fetchStatistics: () => Promise<void>;
  createTask: (data: CreateTaskData) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  getTaskLogs: (taskId: string) => Promise<string[]>;
  executeTask: (taskId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  statistics: null,
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; tasks: Task[] }>('/api/tasks');
      if (result.success) {
        set({ tasks: result.tasks, loading: false });
      } else {
        set({ loading: false, error: 'Failed to fetch tasks' });
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  fetchStatistics: async () => {
    try {
      const result = await hostApiFetch<{ success: boolean; statistics: TaskStatistics }>(
        '/api/tasks/statistics',
      );
      if (result.success) {
        set({ statistics: result.statistics });
      }
    } catch (error) {
      console.error('Failed to fetch task statistics:', error);
    }
  },

  createTask: async (data: CreateTaskData) => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; tasks: Task[] }>('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (result.success) {
        set({ tasks: result.tasks, loading: false });
        await get().fetchStatistics();
      } else {
        set({ loading: false, error: 'Failed to create task' });
        throw new Error('Failed to create task');
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  deleteTask: async (taskId: string) => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; tasks: Task[] }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      });
      if (result.success) {
        set({ tasks: result.tasks, loading: false });
        await get().fetchStatistics();
      } else {
        set({ loading: false, error: 'Failed to delete task' });
        throw new Error('Failed to delete task');
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  getTaskLogs: async (taskId: string): Promise<string[]> => {
    try {
      const result = await hostApiFetch<{ success: boolean; logs: string[] }>(`/api/tasks/${encodeURIComponent(taskId)}/logs`);
      if (result.success) {
        return result.logs;
      }
      return [];
    } catch (error) {
      console.error('Failed to fetch task logs:', error);
      return [];
    }
  },

  executeTask: async (taskId: string) => {
    try {
      const result = await hostApiFetch<{ success: boolean; taskId: string }>(
        `/api/tasks/${encodeURIComponent(taskId)}/execute`,
        {
          method: 'POST',
        }
      );
      if (result.success) {
        // Refresh tasks to get updated status
        await get().fetchTasks();
        await get().fetchStatistics();
      } else {
        throw new Error('Failed to execute task');
      }
    } catch (error) {
      console.error('Failed to execute task:', error);
      throw error;
    }
  },

  stopTask: async (taskId: string) => {
    try {
      const result = await hostApiFetch<{ success: boolean; taskId: string }>(
        `/api/tasks/${encodeURIComponent(taskId)}/stop`,
        {
          method: 'POST',
        }
      );
      if (result.success) {
        // Refresh tasks to get updated status
        await get().fetchTasks();
        await get().fetchStatistics();
      } else {
        throw new Error('Failed to stop task');
      }
    } catch (error) {
      console.error('Failed to stop task:', error);
      throw error;
    }
  },

  resumeTask: async (taskId: string) => {
    try {
      const result = await hostApiFetch<{ success: boolean; taskId: string }>(
        `/api/tasks/${encodeURIComponent(taskId)}/resume`,
        {
          method: 'POST',
        }
      );
      if (result.success) {
        // Refresh tasks to get updated status
        await get().fetchTasks();
        await get().fetchStatistics();
      } else {
        throw new Error('Failed to resume task');
      }
    } catch (error) {
      console.error('Failed to resume task:', error);
      throw error;
    }
  },
}));
