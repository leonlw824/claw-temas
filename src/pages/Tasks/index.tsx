/**
 * Tasks Page
 * Manages task execution
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTasksStore } from '@/stores/tasks';
import { useTeamsStore } from '@/stores/teams';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Play, Square, FileText, ScrollText, Trash2, RefreshCw, Plus, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { WorkflowVisualization } from '@/components/WorkflowVisualization';
import type { Task, TaskStatus, CreateTaskData, TaskType } from '@/types/task';
import type { Team } from '@/types/team';

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation('tasks');

  const variants: Record<TaskStatus, string> = {
    waiting: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    pending: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700',
    running: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
    completed: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700',
    failed: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700',
    stopped: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700',
  };

  return (
    <Badge variant="outline" className={cn('font-medium', variants[status])}>
      {t(`status.${status}`)}
    </Badge>
  );
}

function TaskCard({ task, team, agents, onStart, onStop, onResume, onViewResult, onViewLogs, onDelete, onOpenWorkspace, onReExecute }: {
  task: Task;
  team: Team | undefined;
  agents: { id: string; name: string }[];
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  onViewResult: () => void;
  onViewLogs: () => void;
  onDelete: () => void;
  onOpenWorkspace: () => void;
  onReExecute: () => void;
}) {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();
  const { switchSession, getSessionForAgent, newSessionForAgent } = useChatStore();

  const teamName = team?.name || task.teamId;

  // Calculate execution time
  const executionTime = task.startedAt && task.completedAt
    ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)
    : null;

  const formatExecutionTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  // Get current working nodes
  const currentNodes = task.executionState?.currentNodes || [];
  const currentAgents = currentNodes.map(nodeId => {
    const nodeResult = task.executionState?.nodeResults[nodeId];
    const agentId = nodeResult?.agentId;
    if (!agentId) return null;
    const agent = agents.find(a => a.id === agentId);
    const status = nodeResult?.status || 'waiting';
    return { id: agentId, name: agent?.name || agentId, status };
  }).filter(Boolean);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'running':
        return 'text-blue-600 dark:text-blue-400';
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      case 'stopped':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const handleAgentClick = (agentId: string) => {
    // 检查该 agent 是否已有 session
    const existingSession = getSessionForAgent(agentId);
    if (existingSession) {
      // 如果存在，切换到该 session
      switchSession(existingSession.key);
    } else {
      // 如果不存在，创建新的 session
      const newKey = newSessionForAgent(agentId);
      switchSession(newKey);
    }
    // 导航到聊天页面
    navigate('/');
  };

  return (
    <div className="rounded-lg border bg-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{task.name}</h3>
              <TaskStatusBadge status={task.status} />
            </div>
            {executionTime !== null && (task.status === 'completed' || task.status === 'failed') && (
              <div className="text-xs text-muted-foreground">
                {t('taskCard.executionTime')}: {formatExecutionTime(executionTime)}
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{task.description}</p>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('taskCard.team')}:</span>
              <span>{teamName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('taskCard.type')}:</span>
              <span>{t(`taskTypes.${task.type}`)}</span>
            </div>
            {task.workspacePath && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('taskCard.workspace')}:</span>
                <span className="truncate max-w-[300px]" title={task.workspacePath}>
                  {task.workspacePath}
                </span>
                <button
                  onClick={onOpenWorkspace}
                  className="ml-1 p-1 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                  title={t('taskCard.openWorkspace')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {currentAgents.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('taskCard.currentNodes')}:</span>
                <div className="flex flex-wrap gap-1">
                  {currentAgents.map((agent, index) => (
                    <button
                      key={index}
                      onClick={() => handleAgentClick(agent!.id)}
                      className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1"
                      title={t('taskCard.clickToViewChat')}
                    >
                      <span>{agent!.name}</span>
                      <span className={cn('font-medium', getStatusColor(agent!.status))}>
                        ({t(`status.${agent!.status}`)})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('taskCard.createdAt')}:</span>
              <span>{new Date(task.createdAt).toLocaleString()}</span>
            </div>
            {task.startedAt && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('taskCard.startedAt')}:</span>
                <span>{new Date(task.startedAt).toLocaleString()}</span>
              </div>
            )}
            {task.completedAt && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('taskCard.completedAt')}:</span>
                <span>{new Date(task.completedAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-3">
            {/* Show Re-execute button for completed/failed tasks */}
            {task.status === 'completed' || task.status === 'failed' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onReExecute}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                {t('taskCard.reExecute')}
              </Button>
            ) : task.status === 'stopped' ? (
              /* Show Resume button if task is stopped */
              <Button
                size="sm"
                variant="outline"
                onClick={onResume}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {t('taskCard.resume')}
              </Button>
            ) : (
              /* Show Start button for other statuses */
              <Button
                size="sm"
                variant="outline"
                onClick={onStart}
                disabled={task.status === 'running'}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {t('taskCard.start')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={task.status !== 'running'}
            >
              <Square className="h-3.5 w-3.5 mr-1.5" />
              {t('taskCard.stop')}
            </Button>
            <Button size="sm" variant="outline" onClick={onViewResult}>
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              {t('taskCard.viewResult')}
            </Button>
            <Button size="sm" variant="outline" onClick={onViewLogs}>
              <ScrollText className="h-3.5 w-3.5 mr-1.5" />
              {t('taskCard.viewLogs')}
            </Button>
            <Button size="sm" variant="outline" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t('taskCard.delete')}
            </Button>
          </div>

          {/* Workflow Visualization */}
          {team && (
            <WorkflowVisualization
              nodes={team.workflow.nodes}
              edges={team.workflow.edges}
              nodeResults={task.executionState?.nodeResults || {}}
              agents={agents}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatisticsCard({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className={cn('text-2xl font-bold mb-1', colorClass)}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export function Tasks() {
  const { t } = useTranslation(['tasks', 'common']);
  const location = useLocation();
  const tasks = useTasksStore(s => s.tasks);
  const statistics = useTasksStore(s => s.statistics);
  const loading = useTasksStore(s => s.loading);
  const fetchTasks = useTasksStore(s => s.fetchTasks);
  const fetchStatistics = useTasksStore(s => s.fetchStatistics);
  const createTask = useTasksStore(s => s.createTask);
  const updateTaskDescription = useTasksStore(s => s.updateTaskDescription);
  const deleteTask = useTasksStore(s => s.deleteTask);
  const getTaskLogs = useTasksStore(s => s.getTaskLogs);
  const executeTask = useTasksStore(s => s.executeTask);
  const stopTask = useTasksStore(s => s.stopTask);
  const resumeTask = useTasksStore(s => s.resumeTask);

  const teams = useTeamsStore(s => s.teams);
  const fetchTeams = useTeamsStore(s => s.fetchTeams);

  const agents = useAgentsStore(s => s.agents);
  const fetchAgents = useAgentsStore(s => s.fetchAgents);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [reExecuteDialogOpen, setReExecuteDialogOpen] = useState(false);
  const [reExecuteTask, setReExecuteTask] = useState<Task | null>(null);
  const [reExecuteDescription, setReExecuteDescription] = useState('');

  const [formData, setFormData] = useState<CreateTaskData>({
    name: '',
    description: '',
    teamId: '',
    type: 'file',
  });

  useEffect(() => {
    void fetchTasks();
    void fetchStatistics();
    void fetchTeams();
    void fetchAgents();

    // Listen for task status changes from main process
    const unsubscribe = window.electron.ipcRenderer.on('task:status-changed', () => {
      // Refresh tasks when any task status changes
      void fetchTasks();
      void fetchStatistics();
    });

    return () => {
      unsubscribe();
    };
  }, [fetchTasks, fetchStatistics, fetchTeams, fetchAgents]);

  // 如果从团队页面导航过来，预设团队ID
  useEffect(() => {
    if (location.state && typeof location.state === 'object' && 'teamId' in location.state) {
      const { teamId } = location.state as { teamId: string };
      setFormData(prev => ({ ...prev, teamId }));
      setCreateDialogOpen(true);
    }
  }, [location.state]);

  const handleRefresh = () => {
    void fetchTasks();
    void fetchStatistics();
  };

  const handleCreateTask = async () => {
    if (!formData.name.trim() || !formData.description.trim() || !formData.teamId || !formData.type) {
      toast.error(t('toast.fillAllFields'));
      return;
    }

    try {
      await createTask(formData);
      setCreateDialogOpen(false);
      setFormData({ name: '', description: '', teamId: '', type: 'file' });
      toast.success(t('toast.taskCreated'));
    } catch (error) {
      toast.error(t('toast.taskCreateFailed', { error: String(error) }));
    }
  };

  const handleDeleteTask = async () => {
    if (!taskToDelete) return;

    try {
      await deleteTask(taskToDelete.id);
      setTaskToDelete(null);
      toast.success(t('toast.taskDeleted'));
    } catch (error) {
      toast.error(t('toast.taskDeleteFailed', { error: String(error) }));
    }
  };

  const handleViewLogs = async (task: Task) => {
    setSelectedTask(task);
    const taskLogs = await getTaskLogs(task.id);
    setLogs(taskLogs);
    setLogsDialogOpen(true);
  };

  const handleViewResult = (task: Task) => {
    setSelectedTask(task);
    setResultDialogOpen(true);
  };

  const handleStartTask = async (task: Task) => {
    try {
      await executeTask(task.id);
      toast.success(t('toast.taskStarted'));
    } catch (error) {
      toast.error(t('toast.taskStartFailed', { error: String(error) }));
    }
  };

  const handleStopTask = async (task: Task) => {
    try {
      await stopTask(task.id);
      toast.success(t('toast.taskStopped'));
    } catch (error) {
      toast.error(t('toast.taskStopFailed', { error: String(error) }));
    }
  };

  const handleResumeTask = async (task: Task) => {
    try {
      await resumeTask(task.id);
      toast.success(t('toast.taskResumed'));
    } catch (error) {
      toast.error(t('toast.taskResumeFailed', { error: String(error) }));
    }
  };

  const handleOpenWorkspace = async (task: Task) => {
    if (!task.workspacePath) {
      toast.error(t('toast.noWorkspacePath'));
      return;
    }

    try {
      await window.electron.ipcRenderer.invoke('shell:openPath', task.workspacePath);
    } catch (error) {
      toast.error(t('toast.openWorkspaceFailed', { error: String(error) }));
    }
  };

  const handleReExecuteOpen = (task: Task) => {
    setReExecuteTask(task);
    setReExecuteDescription(task.description);
    setReExecuteDialogOpen(true);
  };

  const handleReExecuteConfirm = async () => {
    if (!reExecuteTask || !reExecuteDescription.trim()) {
      toast.error(t('toast.fillAllFields'));
      return;
    }

    try {
      // Update the task description instead of creating a new task
      await updateTaskDescription(reExecuteTask.id, reExecuteDescription);

      setReExecuteDialogOpen(false);
      setReExecuteTask(null);
      setReExecuteDescription('');
      toast.success(t('toast.taskReExecuted'));

      // Auto-execute the updated task
      await executeTask(reExecuteTask.id);
    } catch (error) {
      toast.error(t('toast.taskReExecuteFailed', { error: String(error) }));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
              {t('refresh')}
            </Button>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('newTask')}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Statistics Overview */}
        {statistics && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
            <StatisticsCard label={t('statistics.total')} value={statistics.total} colorClass="text-foreground" />
            <StatisticsCard label={t('statistics.waiting')} value={statistics.waiting} colorClass="text-slate-600" />
            <StatisticsCard label={t('statistics.pending')} value={statistics.pending} colorClass="text-gray-600" />
            <StatisticsCard label={t('statistics.running')} value={statistics.running} colorClass="text-blue-600" />
            <StatisticsCard label={t('statistics.completed')} value={statistics.completed} colorClass="text-green-600" />
            <StatisticsCard label={t('statistics.failed')} value={statistics.failed} colorClass="text-red-600" />
            <StatisticsCard label={t('statistics.stopped')} value={statistics.stopped} colorClass="text-yellow-600" />
          </div>
        )}

        {/* Task List */}
        {tasks.length === 0 && !loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            {t('noTasks')}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {tasks.map(task => {
              const team = teams.find(t => t.id === task.teamId);
              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  team={team}
                  agents={agents}
                  onStart={() => handleStartTask(task)}
                  onStop={() => handleStopTask(task)}
                  onResume={() => handleResumeTask(task)}
                  onViewResult={() => handleViewResult(task)}
                  onViewLogs={() => handleViewLogs(task)}
                  onDelete={() => setTaskToDelete(task)}
                  onOpenWorkspace={() => handleOpenWorkspace(task)}
                  onReExecute={() => handleReExecuteOpen(task)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Create Task Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createDialog.title')}</DialogTitle>
            <DialogDescription>{t('createDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="task-name">{t('createDialog.nameLabel')}</Label>
              <Input
                id="task-name"
                placeholder={t('createDialog.namePlaceholder')}
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-description">{t('createDialog.descriptionLabel')}</Label>
              <Textarea
                id="task-description"
                placeholder={t('createDialog.descriptionPlaceholder')}
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-type">{t('createDialog.typeLabel')}</Label>
              <Select
                id="task-type"
                value={formData.type}
                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as TaskType }))}
              >
                <option value="file">{t('taskTypes.file')}</option>
                <option value="app">{t('taskTypes.app')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-team">{t('createDialog.teamLabel')}</Label>
              {teams.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">
                  {t('createDialog.noTeams')}
                </div>
              ) : (
                <Select
                  id="task-team"
                  value={formData.teamId}
                  onChange={(e) => setFormData(prev => ({ ...prev, teamId: e.target.value }))}
                >
                  <option value="">{t('createDialog.teamPlaceholder')}</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateDialogOpen(false); setFormData({ name: '', description: '', teamId: '', type: 'file' }); }}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleCreateTask} disabled={teams.length === 0}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!taskToDelete}
        title={t('deleteDialog.title')}
        message={t('deleteDialog.message', { name: taskToDelete?.name })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={handleDeleteTask}
        onCancel={() => setTaskToDelete(null)}
      />

      {/* Logs Dialog */}
      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('logsDialog.title', { name: selectedTask?.name })}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {logs.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                {t('logsDialog.noLogs')}
              </div>
            ) : (
              <div className="rounded-lg bg-muted p-4 font-mono text-xs space-y-1">
                {logs.map((log, index) => (
                  <div key={index} className="whitespace-pre-wrap break-all">
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogsDialogOpen(false)}>
              {t('common:actions.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result Dialog */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('resultDialog.title', { name: selectedTask?.name })}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {!selectedTask?.result ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                {t('resultDialog.noResult')}
              </div>
            ) : (
              <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap break-words">
                {selectedTask.result}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResultDialogOpen(false)}>
              {t('common:actions.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Re-execute Dialog */}
      <Dialog open={reExecuteDialogOpen} onOpenChange={setReExecuteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reExecuteDialog.title')}</DialogTitle>
            <DialogDescription>{t('reExecuteDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="task-name-readonly">{t('createDialog.nameLabel')}</Label>
              <Input
                id="task-name-readonly"
                value={reExecuteTask?.name || ''}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-description-edit">{t('createDialog.descriptionLabel')}</Label>
              <Textarea
                id="task-description-edit"
                placeholder={t('createDialog.descriptionPlaceholder')}
                value={reExecuteDescription}
                onChange={e => setReExecuteDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-team-readonly">{t('createDialog.teamLabel')}</Label>
              <Input
                id="task-team-readonly"
                value={teams.find(t => t.id === reExecuteTask?.teamId)?.name || ''}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-type-readonly">{t('createDialog.typeLabel')}</Label>
              <Input
                id="task-type-readonly"
                value={reExecuteTask?.type ? t(`taskTypes.${reExecuteTask.type}`) : ''}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReExecuteDialogOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleReExecuteConfirm}>
              {t('common:actions.execute')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
