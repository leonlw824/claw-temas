/**
 * Task Execution Engine
 * Manages task execution based on team workflow
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { appendFile, mkdir } from 'fs/promises';
import { GatewayManager } from '../gateway/manager';
import { getTeam, type TeamNode, type TeamEdge } from '../utils/team-config';
import { logger } from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────

export interface TaskExecutionNode {
  nodeId: string;
  agentId: string;
  status: 'waiting' | 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'stopped';
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  rolledBack?: boolean; // Whether this node triggered a rollback
  rollbackFeedback?: string; // Feedback from successor node when rollback was requested
}

export interface TaskExecutionState {
  taskId: string;
  status: 'waiting' | 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  currentNodes: string[];
  completedNodes: string[];
  failedNodes: string[];
  nodeResults: Record<string, TaskExecutionNode>;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskContext {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
}

interface ExecutionContext {
  taskId: string;
  state: TaskExecutionState;
  abortController: AbortController;
}

interface NodeInput {
  nodeId: string;
  agentId: string;
  output: string;
  edgeDescription?: string;
  rollback?: boolean;
  isRollbackFeedback?: boolean; // True if this output is feedback from a successor node requesting rollback
}

// ── Execution Graph ──────────────────────────────────────────────

class ExecutionGraph {
  private graph: Map<string, Set<string>> = new Map();
  private reverseGraph: Map<string, Set<string>> = new Map();
  private inDegree: Map<string, number> = new Map();
  private nodeMap: Map<string, TeamNode> = new Map();
  private edgeMap: Map<string, TeamEdge[]> = new Map(); // source -> edges

  constructor(nodes: TeamNode[], edges: TeamEdge[]) {
    // Initialize nodes
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
      this.graph.set(node.id, new Set());
      this.reverseGraph.set(node.id, new Set());
      this.inDegree.set(node.id, 0);
    }

    // Build graph and in-degree
    for (const edge of edges) {
      this.graph.get(edge.source)?.add(edge.target);
      this.reverseGraph.get(edge.target)?.add(edge.source);
      this.inDegree.set(edge.target, (this.inDegree.get(edge.target) || 0) + 1);

      // Store edges for later retrieval
      if (!this.edgeMap.has(edge.source)) {
        this.edgeMap.set(edge.source, []);
      }
      this.edgeMap.get(edge.source)!.push(edge);
    }
  }

  /**
   * Get initial nodes (nodes with in-degree 0)
   */
  getInitialNodes(): TeamNode[] {
    return Array.from(this.inDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([nodeId, _]) => this.nodeMap.get(nodeId)!);
  }

  /**
   * Get predecessor nodes for a given node
   */
  getPredecessorNodes(nodeId: string): TeamNode[] {
    const predecessors = this.reverseGraph.get(nodeId) || new Set();
    return Array.from(predecessors).map((id) => this.nodeMap.get(id)!);
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): TeamNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  /**
   * Get successor node IDs for a given node
   */
  getSuccessorNodeIds(nodeId: string): string[] {
    return Array.from(this.graph.get(nodeId) || []);
  }

  /**
   * Get edge description from source to target
   */
  getEdgeDescription(source: string, target: string): string | undefined {
    const edges = this.edgeMap.get(source) || [];
    const edge = edges.find((e) => e.target === target);
    return edge?.description;
  }

  /**
   * Check if edge has rollback enabled
   */
  hasRollback(source: string, target: string): boolean {
    const edges = this.edgeMap.get(source) || [];
    const edge = edges.find((e) => e.target === target);
    return edge?.rollback === true;
  }

  /**
   * Get next nodes after completing a node
   */
  getNextNodesAfterCompletion(completedNodeId: string, completedNodes: Set<string>): TeamNode[] {
    const nextNodes: TeamNode[] = [];
    for (const successorId of this.graph.get(completedNodeId) || []) {
      // Check if all predecessors are completed
      const predecessors = this.reverseGraph.get(successorId) || new Set();
      const allPredecessorsCompleted = Array.from(predecessors).every((pred) =>
        completedNodes.has(pred)
      );

      if (allPredecessorsCompleted) {
        nextNodes.push(this.nodeMap.get(successorId)!);
      }
    }
    return nextNodes;
  }

  /**
   * Check for cycles in the graph
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recStack.add(nodeId);

      for (const neighbor of this.graph.get(nodeId) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodeMap.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }
}

// ── Message Builder ──────────────────────────────────────────────

class TaskMessageBuilder {
  buildFirstNodeMessage(
    task: TaskContext,
    currentNodeId: string,
    nextNodeIds: string[],
    graph: ExecutionGraph,
    hasRollback: boolean,
    rollbackFeedback?: string
  ): string {
    const currentNode = graph.getNode(currentNodeId);
    const nextNodes = nextNodeIds.map(id => graph.getNode(id)).filter(Boolean);

    const nextNodesText = nextNodes.length > 0
      ? nextNodes.map(n => n?.agentId).join(', ')
      : 'END';

    // If this node has rollback feedback, emphasize the need for revision
    const revisionInstruction = rollbackFeedback
      ? `\n\n## IMPORTANT - Revision Required\n\nYou are being re-executed because a subsequent team member reviewed your work and requested revisions.\n\n## Review Feedback\n${rollbackFeedback}`
      : '';

    const rollbackInstruction = hasRollback
      ? '\n\n**Important**: Rollback is enabled on this connection. After reviewing the previous result, if you determine that the previous agent needs to redo their work, include "rollback: true" in your output.".'
      : '';

    return `# Task Information
Task Name: ${task.name}
Task ID: ${task.id}
Working Directory: ${task.workspacePath}
Description: ${task.description}

Current Node: ${currentNode?.agentId || currentNodeId}
Next Node(s): ${nextNodesText}${revisionInstruction}${rollbackInstruction}

As a team member, complete your designated work according to your position in the workflow.`;
  }

  buildSubsequentNodeMessage(
    task: TaskContext,
    currentNodeId: string,
    nextNodeIds: string[],
    previousInputs: NodeInput[],
    graph: ExecutionGraph,
    hasRollback: boolean,
    hasRollbackFeedback: boolean // New parameter to indicate if this node has rollback feedback
  ): string {
    const currentNode = graph.getNode(currentNodeId);
    const nextNodes = nextNodeIds.map(id => graph.getNode(id)).filter(Boolean);
    const prevNodes = previousInputs.map(input => graph.getNode(input.nodeId)).filter(Boolean);

    const nextNodesText = nextNodes.length > 0
      ? nextNodes.map(n => n?.agentId).join(', ')
      : 'END';
    const prevNodesText = prevNodes.map(n => n?.agentId).join(', ');

    const previousOutputs = previousInputs
      .map((input, index) => {
        const edgeDesc = input.edgeDescription ? `\nInstruction: ${input.edgeDescription}` : '';
        const rollbackNote = input.rollback ? `\nRollback Enabled: If issues found, output must include "rollback: true/false"` : '';
        const resultLabel = input.isRollbackFeedback ? 'Review Feedback (requires revision)' : 'Result';
        return `## Previous Agent ${index + 1} (${input.agentId})
${resultLabel}: ${input.output}${edgeDesc}${rollbackNote}`;
      })
      .join('\n\n');

    // If this node has rollback feedback, emphasize the need for revision
    const revisionInstruction = hasRollbackFeedback
      ? '\n\n**IMPORTANT**: You are being re-executed because a subsequent agent requested revisions based on your previous output. Please carefully review the feedback above and revise your work accordingly.'
      : '';

    const rollbackInstruction = hasRollback
      ? '\n\n**Important**: Rollback is enabled on this connection. After reviewing the previous result, if you determine that the previous agent needs to redo their work, include "rollback: true" in your output.".'
      : '';

    return `# Task Information
Task Name: ${task.name}
Task ID: ${task.id}
Working Directory: ${task.workspacePath}
Description: ${task.description}

Current Node: ${currentNode?.agentId || currentNodeId}
Next Node(s): ${nextNodesText}
Previous Node(s): ${prevNodesText}

${previousOutputs}${revisionInstruction}${rollbackInstruction}

As a team member, complete your designated work according to your position in the workflow.`;
  }
}

// ── Agent Chat Session ───────────────────────────────────────────

interface ChatMessageEvent {
  message: Record<string, unknown>;
}

interface ChatResponseEvent {
  sessionKey?: string;
  sessionId?: string;
  messages?: Array<{
    role: string;
    content?: unknown;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

class AgentChatSession {
  constructor(
    private agentId: string,
    private taskId: string,
    private gatewayManager: GatewayManager
  ) {}

  async sendMessageAndWaitForReply(
    message: string,
    abortSignal: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const sessionKey = `session-${this.taskId}`;
      let isAborted = false;
      let isResolved = false;
      let isFinal = false;
      let expectedRunId: string | null = null;

      // Handle abort
      const abortHandler = () => {
        if (isResolved) return;
        isAborted = true;
        this.gatewayManager.rpc('chat.abort', { sessionKey }).catch((err) => {
          logger.warn('Failed to abort chat session:', err);
        });
        isResolved = true;
        reject(new Error('Task execution aborted'));
      };

      abortSignal.addEventListener('abort', abortHandler);

      // Subscribe to chat:message events
      const handleChatMessage = (event: ChatMessageEvent) => {
        if (isResolved || isAborted) return;

        const messageData = event.message;

        // Check sessionKey
        if (messageData.sessionKey !== sessionKey) {
          return;
        }

        // Validate runId if we have one
        if (expectedRunId !== null && messageData.runId !== null && messageData.runId !== expectedRunId) {
          logger.warn('RunId mismatch, ignoring message', {
            expected: expectedRunId,
            received: messageData.runId,
          });
          return;
        }

        // Handle final state
        if (messageData.state === 'final') {
          isFinal = true
          logger.info('Received final state', {
            agentId: this.agentId,
            hasMessage: !!messageData.message,
          });
          // Extract from message field
          if (messageData.message !== null && messageData.message !== undefined) {
            const result = this.extractText(messageData.message);
            if (result) {
              isResolved = true;
              abortSignal.removeEventListener('abort', abortHandler);
              this.gatewayManager.off('chat:message', handleChatMessage);
              this.gatewayManager.off('chat:history', handleChatResponse);
              logger.info('Chat session completed', {
                agentId: this.agentId,
                source: 'final.message',
                resultLength: result.length,
              });
              resolve(result);
              return;
            }
          }
          // No message in final event
          logger.debug('Final state without message, waiting for chat:history', {
            agentId: this.agentId,
            runId: expectedRunId,
          });
        }

        // Handle error state
        if (messageData.state === 'error') {
          isResolved = true;
          abortSignal.removeEventListener('abort', abortHandler);
          this.gatewayManager.off('chat:message', handleChatMessage);
          this.gatewayManager.off('chat:history', handleChatResponse);

          const errorMessage = messageData.error
            ? String(messageData.error)
            : 'Chat error';

          logger.error('Chat error', {
            agentId: this.agentId,
            error: errorMessage,
          });
          reject(new Error(errorMessage));
        }
      };

      // Subscribe to chat:history event (from type: "res" messages)
      const handleChatResponse = (event: ChatResponseEvent) => {
        logger.debug('handleChatResponse called', {
          agentId: this.agentId,
          isResolved,
          isAborted,
          isFinal,
        });

        if (isResolved || isAborted || !isFinal) return;

        // Check sessionKey
        if (event.sessionKey !== sessionKey) {
          return;
        }

        logger.info('Received chat:history', {
          agentId: this.agentId,
          messagesCount: event.messages?.length || 0,
        });

        if (Array.isArray(event.messages) && event.messages.length > 0) {
          // Get last message with role === "assistant"
          const lastAssistant = [...event.messages]
            .reverse()
            .find((m) => m.role === 'assistant');

          if (lastAssistant && lastAssistant.content) {
            const result = this.extractText(lastAssistant.content);
            if (result) {
              isResolved = true;
              abortSignal.removeEventListener('abort', abortHandler);
              this.gatewayManager.off('chat:message', handleChatMessage);
              this.gatewayManager.off('chat:history', handleChatResponse);
              logger.info('Chat session completed', {
                agentId: this.agentId,
                source: 'chat:history',
                resultLength: result.length,
              });
              resolve(result);
              return;
            }
          }
        }

        logger.warn('No assistant message found in chat:history', {
          agentId: this.agentId,
        });
      };

      this.gatewayManager.on('chat:message', handleChatMessage);
      this.gatewayManager.on('chat:history', handleChatResponse);

      // Send message
      logger.info('Sending chat message', {
        agentId: this.agentId,
        sessionKey,
        messageLength: message.length,
      });

      this.gatewayManager
        .rpc('chat.send', {
          sessionKey,
          message,
          deliver: true,
          idempotencyKey: this.generateId(),
        })
        .then((response) => {
          // Try to extract runId from chat.send response (started state)
          if (response && typeof response === 'object' && 'runId' in response) {
            const runId = (response as { runId: string }).runId;
            if (runId && !expectedRunId) {
              expectedRunId = runId;
              logger.info('Captured runId from chat.send response', {
                agentId: this.agentId,
                runId: expectedRunId,
              });
            }
          }
        })
        .catch((err) => {
          if (isResolved) return;
          isResolved = true;
          abortSignal.removeEventListener('abort', abortHandler);
          this.gatewayManager.off('chat:message', handleChatMessage);
          logger.error('Failed to send chat message', {
            agentId: this.agentId,
            error: err,
          });
          reject(err);
        });
    });
  }

  private extractText(content: unknown): string {
    // Handle null or undefined
    if (content === null || content === undefined) {
      return '';
    }

    if (typeof content === 'string') {
      return content;
    }

    // Handle message object with role and content array
    // Format: { role: "assistant", content: [{ type: "text", text: "..." }], timestamp: ... }
    if (
      typeof content === 'object' &&
      'content' in content &&
      Array.isArray((content as { content: unknown }).content)
    ) {
      const contentArray = (content as { content: unknown[] }).content;
      return contentArray
        .map((item: unknown) => {
          if (
            item &&
            typeof item === 'object' &&
            'type' in item &&
            item.type === 'text' &&
            'text' in item
          ) {
            return String(item.text);
          }
          return '';
        })
        .join('');
    }

    // Handle content array directly
    // Format: [{ type: "text", text: "..." }, { type: "thinking", thinking: "..." }, ...]
    // Only extract type === "text", ignore type === "thinking"
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (
            item &&
            typeof item === 'object' &&
            'type' in item &&
            item.type === 'text' && // ← Only extract type === "text"
            'text' in item
          ) {
            return String(item.text);
          }
          return ''; // Ignore type === "thinking" and other types
        })
        .join('');
    }

    // Handle simple text object
    // Format: { type: "text", text: "..." }
    if (
      typeof content === 'object' &&
      'type' in content &&
      content.type === 'text' &&
      'text' in content
    ) {
      return String(content.text);
    }

    // Fallback: try to convert to string if possible
    if (typeof content === 'number' || typeof content === 'boolean') {
      return String(content);
    }

    // Unknown type - log warning and return empty
    logger.warn('extractText received unknown content type', {
      type: typeof content,
      keys: typeof content === 'object' ? Object.keys(content) : null,
      content: JSON.stringify(content).substring(0, 200),
    });
    return '';
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ── Task Executor ────────────────────────────────────────────────

export class TaskExecutor extends EventEmitter {
  private activeExecutions = new Map<string, ExecutionContext>();
  private messageBuilder = new TaskMessageBuilder();

  constructor(private gatewayManager: GatewayManager) {
    super();
  }

  /**
   * Execute a task
   */
  async executeTask(
    taskId: string,
    taskContext: TaskContext,
    teamId: string,
    existingState: TaskExecutionState | undefined,
    updateState: (state: TaskExecutionState) => Promise<void>,
    incrementVersion: () => Promise<void>
  ): Promise<void> {
    // Increment version and reset execution state on each run
    await incrementVersion();

    // Load team configuration
    const team = await getTeam(teamId);
    const { nodes, edges } = team.workflow;

    if (nodes.length === 0) {
      throw new Error('Team workflow has no nodes');
    }

    // Build execution graph
    const graph = new ExecutionGraph(nodes, edges);

    // Check for cycles
    if (graph.hasCycle()) {
      throw new Error('Team workflow contains cycles');
    }

    // Always initialize fresh execution state (re-run from beginning)
    const nodeResults: Record<string, TaskExecutionNode> = {};
    for (const node of nodes) {
      nodeResults[node.id] = {
        nodeId: node.id,
        agentId: node.agentId,
        status: 'waiting',
      };
    }

    const executionState: TaskExecutionState = {
      taskId,
      status: 'running',
      currentNodes: [],
      completedNodes: [],
      failedNodes: [],
      nodeResults,
      startedAt: new Date().toISOString(),
    };

    const abortController = new AbortController();
    const executionContext: ExecutionContext = {
      taskId,
      state: executionState,
      abortController,
    };

    this.activeExecutions.set(taskId, executionContext);

    try {
      // Update state
      await updateState(executionState);

      // Log task start
      await this.appendTaskLog(
        taskId,
        taskContext.workspacePath,
        `Task started: ${taskContext.name} (ID: ${taskId})`
      );

      // Start execution from initial nodes
      const initialNodes = graph.getInitialNodes();
      await this.executeNodesSequentially(
        initialNodes,
        taskContext,
        graph,
        executionContext,
        updateState
      );

      // Check final status
      if (executionState.failedNodes.length > 0) {
        executionState.status = 'failed';
      } else if (abortController.signal.aborted) {
        executionState.status = 'stopped';
      } else {
        executionState.status = 'completed';
      }

      executionState.completedAt = new Date().toISOString();
      executionState.currentNodes = [];

      // Log task completion
      await this.appendTaskLog(
        taskId,
        taskContext.workspacePath,
        `Task ${taskContext.name} execution completed, final status: ${executionState.status}`
      );

      await updateState(executionState);
    } catch (error) {
      // Check if this was an abort (user stopped the task)
      if (abortController.signal.aborted) {
        executionState.status = 'stopped';
      } else {
        executionState.status = 'failed';
      }
      executionState.completedAt = new Date().toISOString();
      executionState.currentNodes = [];

      // Log task termination
      await this.appendTaskLog(
        taskId,
        taskContext.workspacePath,
        `Task ${taskContext.name} terminated, final status: ${executionState.status}, error: ${error instanceof Error ? error.message : String(error)}`
      );

      await updateState(executionState);
      throw error;
    } finally {
      this.activeExecutions.delete(taskId);
    }
  }

  /**
   * Stop task execution
   */
  async stopTask(
    taskId: string,
    getTask: () => Promise<{ status: string; executionState?: TaskExecutionState }>,
    updateState: (state: TaskExecutionState) => Promise<void>
  ): Promise<void> {
    const context = this.activeExecutions.get(taskId);

    if (!context) {
      // Task is not in active executions
      // Check if the task file still shows it as running
      const task = await getTask();

      if (task.status === 'running' && task.executionState) {
        // Task file shows running but execution context is gone
        // This can happen if the app crashed or restarted
        // Update the state to stopped
        const state = task.executionState;
        state.status = 'stopped';
        state.completedAt = new Date().toISOString();
        state.currentNodes = [];
        await updateState(state);
        logger.info('Task marked as stopped (execution context lost)', { taskId });
      } else {
        logger.info('Task not running, nothing to stop', { taskId });
      }
      return;
    }

    // Task is actively running, send abort signal
    context.abortController.abort();

    // Abort agent chat sessions for currently running nodes
    for (const nodeId of context.state.currentNodes) {
      const nodeResult = context.state.nodeResults[nodeId];
      if (nodeResult && nodeResult.agentId) {
        const sessionKey = `session-${taskId}`;
        this.gatewayManager.rpc('chat.abort', { sessionKey }).catch((err) => {
          logger.warn('Failed to abort chat session:', err);
        });
      }
    }

    // Immediately update running nodes to stopped status for UI feedback
    const state = context.state;
    const stoppedAt = new Date().toISOString();
    for (const nodeId of state.currentNodes) {
      const nodeResult = state.nodeResults[nodeId];
      if (nodeResult && nodeResult.status === 'running') {
        nodeResult.status = 'stopped';
        nodeResult.completedAt = stoppedAt;
      }
    }

    // Update overall task state
    state.status = 'stopped';
    state.completedAt = stoppedAt;
    state.currentNodes = [];

    // Immediately notify UI about the stopped state
    await updateState(state);

    logger.info('Task execution stopped', {
      taskId,
      stoppedNodes: Object.keys(state.nodeResults).filter(
        id => state.nodeResults[id]?.status === 'stopped'
      )
    });
  }

  /**
   * Resume task execution from last checkpoint
   */
  async resumeTask(
    taskId: string,
    taskContext: TaskContext,
    teamId: string,
    existingState: TaskExecutionState,
    updateState: (state: TaskExecutionState) => Promise<void>
  ): Promise<void> {
    // Load team configuration
    const team = await getTeam(teamId);
    const { nodes, edges } = team.workflow;

    if (nodes.length === 0) {
      throw new Error('Team workflow has no nodes');
    }

    // Build execution graph
    const graph = new ExecutionGraph(nodes, edges);

    // Check for cycles
    if (graph.hasCycle()) {
      throw new Error('Team workflow contains cycles');
    }

    // Resume from existing state
    const executionState: TaskExecutionState = {
      ...existingState,
      status: 'running',
      completedAt: undefined, // Clear completion time
    };

    const abortController = new AbortController();
    const executionContext: ExecutionContext = {
      taskId,
      state: executionState,
      abortController,
    };

    this.activeExecutions.set(taskId, executionContext);

    try {
      // Update state to running
      await updateState(executionState);

      // Find next nodes to execute (nodes that have all dependencies completed)
      const completedSet = new Set(executionState.completedNodes);
      const nextNodes: TeamNode[] = [];

      for (const node of nodes) {
        // Skip already completed or failed nodes
        if (completedSet.has(node.id) || executionState.failedNodes.includes(node.id)) {
          continue;
        }

        // Check if all dependencies are met
        const predecessors = graph.getPredecessorNodes(node.id);
        const allPredecessorsCompleted = predecessors.every(pred =>
          completedSet.has(pred.id)
        );

        if (allPredecessorsCompleted) {
          nextNodes.push(node);
        }
      }

      if (nextNodes.length === 0) {
        // No more nodes to execute
        executionState.status = executionState.failedNodes.length > 0 ? 'failed' : 'completed';
        executionState.completedAt = new Date().toISOString();
        executionState.currentNodes = [];
        await updateState(executionState);
        return;
      }

      // Continue execution from next nodes
      await this.executeNodesSequentially(
        nextNodes,
        taskContext,
        graph,
        executionContext,
        updateState
      );

      // Check final status
      if (executionState.failedNodes.length > 0) {
        executionState.status = 'failed';
      } else if (abortController.signal.aborted) {
        executionState.status = 'stopped';
      } else {
        executionState.status = 'completed';
      }

      executionState.completedAt = new Date().toISOString();
      executionState.currentNodes = [];

      // Log task completion
      await this.appendTaskLog(
        taskId,
        taskContext.workspacePath,
        `Task ${taskContext.name} execution completed (resumed), final status: ${executionState.status}`
      );

      await updateState(executionState);
    } catch (error) {
      // Check if this was an abort (user stopped the task)
      if (abortController.signal.aborted) {
        executionState.status = 'stopped';
      } else {
        executionState.status = 'failed';
      }
      executionState.completedAt = new Date().toISOString();
      executionState.currentNodes = [];

      // Log task termination
      await this.appendTaskLog(
        taskId,
        taskContext.workspacePath,
        `Task ${taskContext.name} terminated (resumed), final status: ${executionState.status}, error: ${error instanceof Error ? error.message : String(error)}`
      );

      await updateState(executionState);
      throw error;
    } finally {
      this.activeExecutions.delete(taskId);
    }
  }

  /**
   * Execute nodes sequentially (handle dependencies)
   */
  private async executeNodesSequentially(
    nodes: TeamNode[],
    taskContext: TaskContext,
    graph: ExecutionGraph,
    context: ExecutionContext,
    updateState: (state: TaskExecutionState) => Promise<void>
  ): Promise<void> {
    if (nodes.length === 0) return;

    logger.info('Executing nodes batch', {
      taskId: context.taskId,
      nodeIds: nodes.map(n => n.id),
      nodeAgents: nodes.map(n => n.agentId)
    });

    // Execute all nodes in parallel
    const results = await Promise.allSettled(
      nodes.map((node) =>
        this.executeNode(node, taskContext, graph, context, updateState)
      )
    );

    // Collect completed and failed nodes
    const completedNodes = new Set(context.state.completedNodes);
    const nextBatch = new Set<TeamNode>();

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const node = nodes[i];

      if (result.status === 'fulfilled') {
        completedNodes.add(node.id);

        // Find next nodes that can be executed
        const nextNodes = graph.getNextNodesAfterCompletion(node.id, completedNodes);
        logger.info('Next nodes after completion', {
          taskId: context.taskId,
          completedNodeId: node.id,
          nextNodeIds: nextNodes.map(n => n.id),
          nextNodeAgents: nextNodes.map(n => n.agentId)
        });
        nextNodes.forEach((n) => nextBatch.add(n));
      } else {
        // Node failed, skip
        logger.error(`Node execution failed: ${node.id}`, result.reason);
      }
    }

    // Continue with next batch
    if (nextBatch.size > 0 && !context.abortController.signal.aborted) {
      logger.info('Starting next batch', {
        taskId: context.taskId,
        batchSize: nextBatch.size,
        nodeIds: Array.from(nextBatch).map(n => n.id)
      });
      await this.executeNodesSequentially(
        Array.from(nextBatch),
        taskContext,
        graph,
        context,
        updateState
      );
    } else {
      logger.info('No more nodes to execute', {
        taskId: context.taskId,
        aborted: context.abortController.signal.aborted
      });
    }
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: TeamNode,
    taskContext: TaskContext,
    graph: ExecutionGraph,
    context: ExecutionContext,
    updateState: (state: TaskExecutionState) => Promise<void>
  ): Promise<void> {
    const { state, abortController } = context;

    // Check if aborted
    if (abortController.signal.aborted) {
      throw new Error('Execution aborted');
    }

    // Check if this is the END node - mark as completed immediately
    if (node.id === '__END__') {
      const nodeResult: TaskExecutionNode = {
        nodeId: node.id,
        agentId: node.agentId,
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        output: 'Task workflow completed',
      };

      state.nodeResults[node.id] = nodeResult;
      if (!state.completedNodes.includes(node.id)) {
        state.completedNodes.push(node.id);
      }
      await updateState(state);

      logger.info('END node reached, task completed', {
        taskId: context.taskId,
      });

      return;
    }

    // Check if this node was previously stopped (resuming)
    const existingResult = state.nodeResults[node.id];
    const isResuming = existingResult?.status === 'stopped';

    // Initialize node result
    const nodeResult: TaskExecutionNode = {
      nodeId: node.id,
      agentId: node.agentId,
      status: 'running',
      startedAt: isResuming ? existingResult?.startedAt : new Date().toISOString(),
    };

    // Preserve rollbackFeedback if it exists (from a previous rollback request)
    if (existingResult?.rollbackFeedback) {
      nodeResult.rollbackFeedback = existingResult.rollbackFeedback;
    }

    state.nodeResults[node.id] = nodeResult;
    state.currentNodes.push(node.id);
    await updateState(state);

    try {
      let message: string;

      if (isResuming) {
        // Resuming from stopped state, just send continue
        message = 'The previous task was aborted, so I didn\'t get the results. Please continue running it. If you already have the results, please copy and output the previous results.';
      } else {
        // Build message for first-time execution
        const predecessors = graph.getPredecessorNodes(node.id);
        const successorIds = graph.getSuccessorNodeIds(node.id);

        // Check if this node has rollback feedback (regardless of whether it's first or subsequent node)
        const currentNodeResult = state.nodeResults[node.id];
        const hasRollbackFeedback = currentNodeResult?.rollbackFeedback;

        if (hasRollbackFeedback) {
          // This node is being re-executed due to rollback from a successor
          // Build message using the rollback feedback (review comments from successor)
          message = `# Task Information
Task Name: ${taskContext.name}
Task ID: ${taskContext.id}
Working Directory: ${taskContext.workspacePath}
Description: ${taskContext.description}

Current Node: ${node.agentId}

## IMPORTANT - Revision Required

You are being re-executed because a subsequent team member reviewed your work and requested revisions.

## Review Feedback
${currentNodeResult.rollbackFeedback}

Please carefully review the feedback above and revise your work accordingly. As a team member, complete your designated work according to your position in the workflow.`;
        } else if (predecessors.length === 0) {
          // First node (normal execution or with rollback feedback)
          // Check if any outgoing edges have rollback enabled
          const hasRollback = successorIds.some(successorId => graph.hasRollback(node.id, successorId));
          const rollbackFeedback = currentNodeResult?.rollbackFeedback;
          message = this.messageBuilder.buildFirstNodeMessage(
            taskContext,
            node.id,
            successorIds,
            graph,
            hasRollback,
            rollbackFeedback
          );
        } else {
          // Subsequent node (normal execution, no rollback feedback)
          // Build message from predecessors
          const previousInputs: NodeInput[] = predecessors.map((pred) => ({
            nodeId: pred.id,
            agentId: pred.agentId,
            output: state.nodeResults[pred.id]?.output || '',
            edgeDescription: graph.getEdgeDescription(pred.id, node.id),
            rollback: graph.hasRollback(pred.id, node.id),
          }));

          const hasRollback = previousInputs.some(input => input.rollback === true);

          message = this.messageBuilder.buildSubsequentNodeMessage(
            taskContext,
            node.id,
            successorIds,
            previousInputs,
            graph,
            hasRollback,
            false // No rollback feedback for normal execution
          );
        }
      }

      logger.info('Starting node execution', {
        taskId: context.taskId,
        nodeId: node.id,
        agentId: node.agentId,
        isResuming
      });

      // Log node start
      await this.appendTaskLog(
        context.taskId,
        taskContext.workspacePath,
        `Agent ${node.agentId} executing task, sending message: ${JSON.stringify({ message: message.substring(0, 200) + (message.length > 200 ? '...' : '') })}`
      );

      // Always create a new session for each message to avoid event listener conflicts
      // But use the same sessionKey to maintain conversation continuity
      const session = new AgentChatSession(node.agentId, context.taskId, this.gatewayManager);
      const output = await session.sendMessageAndWaitForReply(
        message,
        abortController.signal
      );

      logger.info('Node execution reply received', {
        taskId: context.taskId,
        nodeId: node.id,
        agentId: node.agentId,
        outputLength: output.length
      });

      // Update node result
      nodeResult.status = 'completed';
      nodeResult.completedAt = new Date().toISOString();
      nodeResult.output = output;

      // Clear rollback feedback after successful execution (if it was set)
      if (nodeResult.rollbackFeedback) {
        delete nodeResult.rollbackFeedback;
      }

      // Check if rollback is requested (extract from output)
      const predecessors = graph.getPredecessorNodes(node.id);
      const hasRollbackEdge = predecessors.some(pred => graph.hasRollback(pred.id, node.id));
      let shouldRollback = false;

      if (hasRollbackEdge) {
        // Try to extract rollback value from output
        const rollbackMatch = output.match(/rollback\s*:\s*(true|false)/i);
        if (rollbackMatch) {
          shouldRollback = rollbackMatch[1].toLowerCase() === 'true';
          logger.info('Rollback value extracted', {
            taskId: context.taskId,
            nodeId: node.id,
            agentId: node.agentId,
            shouldRollback,
          });
        }
      }

      // Log node completion
      await this.appendTaskLog(
        context.taskId,
        taskContext.workspacePath,
        `Agent ${node.agentId} execution completed, result: ${JSON.stringify({ output: output.substring(0, 200) + (output.length > 200 ? '...' : ''), rollback: shouldRollback || undefined })}`
      );

      // Handle rollback
      if (shouldRollback) {
        // Rollback requested - remove this node from completed and mark predecessors for re-execution
        logger.info('Rollback requested, re-executing predecessor nodes', {
          taskId: context.taskId,
          nodeId: node.id,
          predecessorIds: predecessors.map(p => p.id),
        });

        // Log rollback
        await this.appendTaskLog(
          context.taskId,
          taskContext.workspacePath,
          `Agent ${node.agentId} requested rollback, re-executing previous agents: ${predecessors.map(p => p.agentId).join(', ')}`
        );

        // IMPORTANT: Store current node's output as rollback feedback for predecessors
        // This allows predecessors to see the review/feedback from the current node
        for (const pred of predecessors) {
          // Store current node's output in a special rollback field
          if (state.nodeResults[pred.id]) {
            state.nodeResults[pred.id].rollbackFeedback = output;
          }
        }

        // Remove predecessors from completed list (they will be re-executed)
        state.completedNodes = state.completedNodes.filter(id => !predecessors.some(p => p.id === id));

        // Keep current node in completed state but don't proceed to next nodes
        // The predecessors will be re-added to the execution queue
        state.currentNodes = state.currentNodes.filter((id) => id !== node.id);
        if (!state.completedNodes.includes(node.id)) {
          state.completedNodes.push(node.id);
        }

        // Store rollback flag in node result for tracking
        nodeResult.rolledBack = true;

        await updateState(state);

        // Re-execute predecessor nodes
        await this.executeNodesSequentially(
          predecessors,
          taskContext,
          graph,
          context,
          updateState
        );

        return; // Exit early, don't proceed to successors
      }

      // Normal completion - update state
      state.currentNodes = state.currentNodes.filter((id) => id !== node.id);
      // Add to completedNodes only if not already present
      if (!state.completedNodes.includes(node.id)) {
        state.completedNodes.push(node.id);
      }
      await updateState(state);

      logger.info('Node execution completed and state updated', {
        taskId: context.taskId,
        nodeId: node.id,
        agentId: node.agentId,
        currentNodes: state.currentNodes,
        completedNodes: state.completedNodes
      });
    } catch (error) {
      // Check if this was an abort (task stopped) or session already ended
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAborted = abortController.signal.aborted || errorMessage.includes('aborted');
      const isSessionEnded = errorMessage.includes('session') &&
                            (errorMessage.includes('ended') ||
                             errorMessage.includes('completed') ||
                             errorMessage.includes('already') ||
                             errorMessage.includes('not found'));

      // If session already ended successfully, treat as stopped not failed
      const shouldTreatAsStopped = isAborted || isSessionEnded;

      nodeResult.status = shouldTreatAsStopped ? 'stopped' : 'failed';
      nodeResult.completedAt = new Date().toISOString();
      nodeResult.error = errorMessage;

      state.currentNodes = state.currentNodes.filter((id) => id !== node.id);

      if (shouldTreatAsStopped) {
        // Don't add to failedNodes if stopped or session already ended
        logger.info('Node execution stopped', {
          taskId: context.taskId,
          nodeId: node.id,
          agentId: node.agentId,
          reason: isSessionEnded ? 'session already ended' : 'aborted',
        });
        // Log stopped status
        await this.appendTaskLog(
          context.taskId,
          taskContext.workspacePath,
          `Agent ${node.agentId} execution stopped, reason: ${isSessionEnded ? 'session already ended' : 'task aborted'}`
        );
      } else {
        // Add to failedNodes only if not already present
        if (!state.failedNodes.includes(node.id)) {
          state.failedNodes.push(node.id);
        }
        logger.error('Node execution failed', {
          taskId: context.taskId,
          nodeId: node.id,
          agentId: node.agentId,
          error: nodeResult.error,
        });
        // Log failure
        await this.appendTaskLog(
          context.taskId,
          taskContext.workspacePath,
          `Agent ${node.agentId} execution failed, error: ${JSON.stringify({ error: errorMessage.substring(0, 200) + (errorMessage.length > 200 ? '...' : '') })}`
        );
      }

      await updateState(state);
      throw error;
    }
  }

  /**
   * Append log entry to global task log
   */
  private async appendTaskLog(
    taskId: string,
    workspacePath: string,
    logEntry: string
  ): Promise<void> {
    const logsDir = join(workspacePath, 'logs');
    await mkdir(logsDir, { recursive: true });

    const logPath = join(logsDir, `${taskId}.log`);
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${logEntry}\n`;

    try {
      await appendFile(logPath, logLine, 'utf-8');
    } catch (error) {
      logger.warn('Failed to append task log', { taskId, error });
    }
  }
}
