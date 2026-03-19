import type { IncomingMessage, ServerResponse } from 'http';
import * as taskConfig from '../../utils/task-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { TaskExecutor } from '../../services/task-executor';

// Global task executor instance map (one per gateway manager)
const taskExecutors = new WeakMap<HostApiContext['gatewayManager'], TaskExecutor>();

function getTaskExecutor(ctx: HostApiContext): TaskExecutor {
  let executor = taskExecutors.get(ctx.gatewayManager);
  if (!executor) {
    executor = new TaskExecutor(ctx.gatewayManager);
    taskExecutors.set(ctx.gatewayManager, executor);
  }
  return executor;
}

export async function handleTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // List tasks
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    try {
      const snapshot = await taskConfig.listTasksSnapshot();
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Get task statistics
  if (url.pathname === '/api/tasks/statistics' && req.method === 'GET') {
    try {
      const stats = await taskConfig.getTaskStatistics();
      sendJson(res, 200, { success: true, statistics: stats });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Create a new task
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        name: string;
        description: string;
        teamId: string;
        type: taskConfig.TaskType;
      }>(req);

      if (!body.name || typeof body.name !== 'string') {
        sendJson(res, 400, { success: false, error: 'Task name is required' });
        return true;
      }

      if (!body.description || typeof body.description !== 'string') {
        sendJson(res, 400, { success: false, error: 'Task description is required' });
        return true;
      }

      if (!body.teamId || typeof body.teamId !== 'string') {
        sendJson(res, 400, { success: false, error: 'Team ID is required' });
        return true;
      }

      if (!body.type || !['file', 'app'].includes(body.type)) {
        sendJson(res, 400, { success: false, error: 'Valid task type is required (file or app)' });
        return true;
      }

      const snapshot = await taskConfig.createTask(
        body.name,
        body.description,
        body.teamId,
        body.type,
      );
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Handle task-specific routes
  if (url.pathname.startsWith('/api/tasks/')) {
    const suffix = url.pathname.slice('/api/tasks/'.length);
    const parts = suffix.split('/').filter(Boolean);

    // Delete a task
    if (parts.length === 1 && req.method === 'DELETE') {
      try {
        const taskId = decodeURIComponent(parts[0]);
        const snapshot = await taskConfig.deleteTask(taskId);
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        console.error('Failed to delete task:', error);
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Update task description
    if (parts.length === 1 && req.method === 'PATCH') {
      try {
        const taskId = decodeURIComponent(parts[0]);
        const body = await parseJsonBody<{ description: string }>(req);

        if (!body.description || typeof body.description !== 'string') {
          sendJson(res, 400, { success: false, error: 'Task description is required' });
          return true;
        }

        const snapshot = await taskConfig.updateTaskDescription(taskId, body.description);
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        console.error('Failed to update task:', error);
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Get task logs
    if (parts.length === 2 && parts[1] === 'logs' && req.method === 'GET') {
      try {
        const taskId = decodeURIComponent(parts[0]);
        const logs = await taskConfig.getTaskLogs(taskId);
        sendJson(res, 200, { success: true, logs });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Resume a task
    if (parts.length === 2 && parts[1] === 'resume' && req.method === 'POST') {
      // Resume from last checkpoint (continue from where it stopped)
      try {
        const taskId = decodeURIComponent(parts[0]);
        const task = await taskConfig.getTask(taskId);

        if (task.status === 'running') {
          sendJson(res, 400, { success: false, error: 'Task is already running' });
          return true;
        }

        if (!task.executionState) {
          sendJson(res, 400, { success: false, error: 'No execution state found. Use execute to start from beginning.' });
          return true;
        }

        const executor = getTaskExecutor(ctx);

        // Resume task from last checkpoint
        executor
          .resumeTask(
            taskId,
            {
              id: task.id,
              name: task.name,
              description: task.description,
              workspacePath: task.workspacePath || '',
            },
            task.teamId,
            task.executionState,
            async (state) => {
              await taskConfig.updateTaskExecutionState(taskId, state);
              // Notify renderer process about task status change
              if (ctx.mainWindow) {
                ctx.mainWindow.webContents.send('task:status-changed', { taskId, status: state.status });
              }
            }
          )
          .catch((error) => {
            console.error('Task resume error:', error);
          });

        sendJson(res, 200, { success: true, taskId });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
    if (parts.length === 2 && parts[1] === 'execute' && req.method === 'POST') {
      try {
        const taskId = decodeURIComponent(parts[0]);
        const task = await taskConfig.getTask(taskId);

        if (task.status === 'running') {
          sendJson(res, 400, { success: false, error: 'Task is already running' });
          return true;
        }

        const executor = getTaskExecutor(ctx);

        // Execute task asynchronously
        executor
          .executeTask(
            taskId,
            {
              id: task.id,
              name: task.name,
              description: task.description,
              workspacePath: task.workspacePath || '',
            },
            task.teamId,
            task.executionState,
            async (state) => {
              await taskConfig.updateTaskExecutionState(taskId, state);
              // Notify renderer process about task status change
              if (ctx.mainWindow) {
                ctx.mainWindow.webContents.send('task:status-changed', { taskId, status: state.status });
              }
            },
            async () => {
              await taskConfig.incrementTaskVersion(taskId);
            }
          )
          .catch((error) => {
            // Error already handled in executor, just log
            console.error('Task execution error:', error);
          });

        sendJson(res, 200, { success: true, taskId });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Stop a task
    if (parts.length === 2 && parts[1] === 'stop' && req.method === 'POST') {
      try {
        const taskId = decodeURIComponent(parts[0]);
        const executor = getTaskExecutor(ctx);
        await executor.stopTask(
          taskId,
          async () => await taskConfig.getTask(taskId),
          async (state) => {
            await taskConfig.updateTaskExecutionState(taskId, state);
            // Notify renderer process about task status change
            if (ctx.mainWindow) {
              ctx.mainWindow.webContents.send('task:status-changed', { taskId, status: state.status });
            }
          }
        );
        sendJson(res, 200, { success: true, taskId });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Get task execution state
    if (parts.length === 2 && parts[1] === 'execution' && req.method === 'GET') {
      try {
        const taskId = decodeURIComponent(parts[0]);
        const task = await taskConfig.getTask(taskId);
        sendJson(res, 200, {
          success: true,
          executionState: task.executionState || null,
        });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  void ctx;
  return false;
}
