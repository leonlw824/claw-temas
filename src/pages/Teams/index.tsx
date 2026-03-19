/**
 * Teams Page
 * Manages team workflows
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeamsStore } from '@/stores/teams';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Edit, Trash2, RefreshCw, Plus, FileEdit, ListPlus, User, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Team, TeamWorkflow, TeamNode, TeamEdge } from '@/types/team';
import { END_NODE_ID, END_AGENT_ID } from '@/types/team';
import { useNavigate } from 'react-router-dom';

/**
 * Get nodes in topological order based on edges
 * For simple linear workflow visualization in team card
 */
function getTopologicalOrder(nodes: TeamNode[], edges: TeamEdge[]): TeamNode[] {
  if (nodes.length === 0) return [];

  // Find start node (node with no incoming edges, excluding END node)
  const incomingEdges = new Map<string, string[]>();
  const outgoingEdges = new Map<string, string[]>();

  // Initialize
  nodes.forEach(node => {
    incomingEdges.set(node.id, []);
    outgoingEdges.set(node.id, []);
  });

  // Build edge maps
  edges.forEach(edge => {
    const incoming = incomingEdges.get(edge.target) || [];
    incoming.push(edge.source);
    incomingEdges.set(edge.target, incoming);

    const outgoing = outgoingEdges.get(edge.source) || [];
    outgoing.push(edge.target);
    outgoingEdges.set(edge.source, outgoing);
  });

  // Find start nodes (no incoming edges)
  const startNodes = nodes.filter(node => {
    const incoming = incomingEdges.get(node.id) || [];
    return incoming.length === 0;
  });

  // BFS traversal
  const visited = new Set<string>();
  const result: TeamNode[] = [];
  const queue = [...startNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;

    visited.add(current.id);
    result.push(current);

    const outgoing = outgoingEdges.get(current.id) || [];
    for (const nextId of outgoing) {
      if (!visited.has(nextId)) {
        const nextNode = nodes.find(n => n.id === nextId);
        if (nextNode) {
          queue.push(nextNode);
        }
      }
    }
  }

  // Add any remaining unvisited nodes (shouldn't happen in valid workflow)
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      result.push(node);
    }
  });

  return result;
}

// Workflow Editor Component
function WorkflowEditor({ workflow, agents, onSave, onCancel }: {
  workflow: TeamWorkflow;
  agents: { id: string; name: string }[];
  onSave: (workflow: TeamWorkflow) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('teams');

  // Initialize END node if not present
  const initializeWorkflow = (wf: TeamWorkflow): TeamWorkflow => {
    const hasEndNode = wf.nodes.some(n => n.id === END_NODE_ID);
    if (hasEndNode) {
      return wf;
    }

    // Add END node at default position
    let endNodePosition: { x: number; y: number };

    if (wf.nodes.length === 0) {
      // No nodes yet, place END node in center-right of initial view
      endNodePosition = { x: 400, y: 200 };
    } else {
      // Calculate average position of existing nodes
      const avgX = wf.nodes.reduce((sum, n) => sum + n.position.x, 0) / wf.nodes.length;
      const avgY = wf.nodes.reduce((sum, n) => sum + n.position.y, 0) / wf.nodes.length;
      // Place END node to the right of average position
      endNodePosition = { x: avgX + 200, y: avgY };
    }

    const endNode: TeamNode = {
      id: END_NODE_ID,
      agentId: END_AGENT_ID,
      position: endNodePosition,
    };

    return {
      nodes: [...wf.nodes, endNode],
      edges: wf.edges,
    };
  };

  const initializedWorkflow = initializeWorkflow(workflow);
  const [nodes, setNodes] = useState<TeamNode[]>(initializedWorkflow.nodes);
  const [edges, setEdges] = useState<TeamEdge[]>(initializedWorkflow.edges);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [edgeDescription, setEdgeDescription] = useState('');
  const [edgeRollback, setEdgeRollback] = useState(false);
  const [connecting, setConnecting] = useState<{ from: string; fromPort: string } | null>(null);
  const [draggedAgent, setDraggedAgent] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredPort, setHoveredPort] = useState<{ nodeId: string; port: string } | null>(null);

  // 连接点位置计算
  const getPortPosition = (node: TeamNode, port: string) => {
    const centerX = node.position.x + 30;
    const centerY = node.position.y + 30;
    const radius = 30;

    switch (port) {
      case 'top':
        return { x: centerX, y: centerY - radius };
      case 'right':
        return { x: centerX + radius, y: centerY };
      case 'bottom':
        return { x: centerX, y: centerY + radius };
      case 'left':
        return { x: centerX - radius, y: centerY };
      default:
        return { x: centerX, y: centerY };
    }
  };

  // 查找最近的连接点
  const findNearestPort = (x: number, y: number, excludeNodeId?: string): { nodeId: string; port: string; distance: number } | null => {
    let nearest: { nodeId: string; port: string; distance: number } | null = null;

    nodes.forEach(node => {
      if (node.id === excludeNodeId) return;

      ['top', 'right', 'bottom', 'left'].forEach(port => {
        const portPos = getPortPosition(node, port);
        const distance = Math.sqrt(
          Math.pow(portPos.x - x, 2) + Math.pow(portPos.y - y, 2)
        );

        if (!nearest || distance < nearest.distance) {
          nearest = { nodeId: node.id, port, distance };
        }
      });
    });

    return nearest;
  };

  const handleDragStart = (agentId: string) => {
    setDraggedAgent(agentId);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedAgent) return;

    const canvas = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - canvas.left;
    const y = e.clientY - canvas.top;

    // 检查是否已存在
    if (nodes.some(n => n.agentId === draggedAgent)) {
      toast.error(t('workflowEditor.agentAlreadyAdded'));
      setDraggedAgent(null);
      return;
    }

    const newNode: TeamNode = {
      id: `node-${Date.now()}`,
      agentId: draggedAgent,
      position: { x, y },
    };

    setNodes([...nodes, newNode]);
    setDraggedAgent(null);
  };

  const handleNodeDragStart = (nodeId: string, e: React.MouseEvent) => {
    if (connecting) return; // 连接模式下不允许拖动
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const startPos = { ...node.position };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      setNodes(prev => prev.map(n =>
        n.id === nodeId
          ? { ...n, position: { x: startPos.x + dx, y: startPos.y + dy } }
          : n
      ));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleStartConnection = (nodeId: string, port: string) => {
    setConnecting({ from: nodeId, fromPort: port });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const canvas = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - canvas.left;
    const y = e.clientY - canvas.top;
    setMousePos({ x, y });

    if (connecting) {
      // 查找最近的连接点
      const fromNode = nodes.find(n => n.id === connecting.from);
      if (!fromNode) return;

      const nearest = findNearestPort(x, y, connecting.from);
      if (nearest && nearest.distance < 30) {
        setHoveredPort({ nodeId: nearest.nodeId, port: nearest.port });
      } else {
        setHoveredPort(null);
      }
    }
  };

  const handleCompleteConnection = (toNodeId: string, toPort: string) => {
    if (!connecting || connecting.from === toNodeId) {
      return;
    }

    // 检查是否已存在连接
    const existingEdge = edges.find(e =>
      e.source === connecting.from &&
      e.target === toNodeId
    );

    if (existingEdge) {
      toast.error(t('workflowEditor.connectionExists'));
      return;
    }

    const newEdge: TeamEdge = {
      id: `edge-${Date.now()}`,
      source: connecting.from,
      target: toNodeId,
      description: '',
      sourcePort: connecting.fromPort,
      targetPort: toPort,
    };

    setEdges([...edges, newEdge]);
    setConnecting(null);
    setHoveredPort(null);

    // 立即打开编辑对话框
    setSelectedEdge(newEdge.id);
    setEdgeDescription('');
  };

  const handleCancelConnection = () => {
    setConnecting(null);
    setHoveredPort(null);
  };

  const handleRemoveNode = (nodeId: string) => {
    // Prevent removing END node
    if (nodeId === END_NODE_ID) {
      toast.error(t('workflowEditor.cannotRemoveEndNode'));
      return;
    }
    setNodes(nodes.filter(n => n.id !== nodeId));
    setEdges(edges.filter(e => e.source !== nodeId && e.target !== nodeId));
  };

  const handleRemoveEdge = (edgeId: string) => {
    setEdges(edges.filter(e => e.id !== edgeId));
    setSelectedEdge(null);
  };

  const handleEditEdge = (edgeId: string) => {
    const edge = edges.find(e => e.id === edgeId);
    if (edge) {
      setSelectedEdge(edgeId);
      setEdgeDescription(edge.description || '');
      setEdgeRollback(edge.rollback || false);
    }
  };

  const handleSaveEdgeDescription = () => {
    if (!selectedEdge) return;

    setEdges(edges.map(e =>
      e.id === selectedEdge
        ? { ...e, description: edgeDescription, rollback: edgeRollback }
        : e
    ));
    setSelectedEdge(null);
    setEdgeDescription('');
    setEdgeRollback(false);
  };

  const handleSave = () => {
    // Validate: must have at least one node connecting to END node
    const hasConnectionToEnd = edges.some(e => e.target === END_NODE_ID);
    if (!hasConnectionToEnd) {
      toast.error(t('workflowEditor.mustConnectToEnd'));
      return;
    }

    // Validate: all nodes must have at least one connection (incoming or outgoing)
    const unconnectedNodes = nodes.filter(node => {
      // Skip END node from this check (it only needs incoming connections)
      if (node.id === END_NODE_ID) {
        return false;
      }

      const hasIncoming = edges.some(e => e.target === node.id);
      const hasOutgoing = edges.some(e => e.source === node.id);
      return !hasIncoming && !hasOutgoing;
    });

    if (unconnectedNodes.length > 0) {
      const unconnectedAgentNames = unconnectedNodes
        .map(node => agentNamesMap[node.agentId])
        .join('、');
      toast.error(t('workflowEditor.nodesNotConnected', { agents: unconnectedAgentNames }));
      return;
    }

    onSave({ nodes, edges });
  };

  const agentNamesMap = Object.fromEntries([
    ...agents.map(a => [a.id, a.name]),
    [END_AGENT_ID, t('workflowEditor.endNode')], // Add END node name
  ]);

  return (
    <div className="flex h-full">
      {/* Left sidebar - Agent list */}
      <div className="w-64 border-r p-4 overflow-y-auto bg-muted/30">
        <h3 className="text-sm font-semibold mb-3">{t('workflowEditor.agentList')}</h3>
        <div className="space-y-2">
          {agents.map(agent => (
            <div
              key={agent.id}
              draggable
              onDragStart={() => handleDragStart(agent.id)}
              className="flex items-center gap-2 p-2 rounded-lg border bg-card hover:bg-accent cursor-move transition-colors"
            >
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm truncate">{agent.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right canvas - Workflow area */}
      <div className="flex-1 flex flex-col">
        <div
          className="flex-1 relative bg-background overflow-auto"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCancelConnection}
        >
          {/* SVG for edges */}
          <svg className="absolute inset-0 w-full h-full min-w-[1200px] min-h-[800px] pointer-events-none">
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="currentColor" className="text-muted-foreground" />
              </marker>
            </defs>

            {/* Render edges */}
            {edges.map(edge => {
              const source = nodes.find(n => n.id === edge.source);
              const target = nodes.find(n => n.id === edge.target);
              if (!source || !target) return null;

              const sourcePos = getPortPosition(source, edge.sourcePort || 'right');
              const targetPos = getPortPosition(target, edge.targetPort || 'left');

              const x1 = sourcePos.x;
              const y1 = sourcePos.y;
              const x2 = targetPos.x;
              const y2 = targetPos.y;

              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;

              return (
                <g key={edge.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="currentColor"
                    strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                    className="text-muted-foreground pointer-events-auto cursor-pointer"
                    onClick={() => handleEditEdge(edge.id)}
                  />
                  {edge.description && (
                    <g>
                      {/* Deliverable box */}
                      <foreignObject
                        x={midX - 40}
                        y={midY - 15}
                        width="80"
                        height="30"
                        className="pointer-events-auto"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="w-full h-full border-2 border-dashed border-primary/50 bg-background rounded px-2 py-1 cursor-pointer flex items-center justify-center"
                              onClick={() => handleEditEdge(edge.id)}
                            >
                              <span className="text-[10px] text-foreground truncate">
                                {edge.description}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">{edge.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </foreignObject>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Connecting line */}
            {connecting && (
              <>
                {(() => {
                  const fromNode = nodes.find(n => n.id === connecting.from);
                  if (!fromNode) return null;

                  const fromPos = getPortPosition(fromNode, connecting.fromPort);
                  let toPos = mousePos;

                  // 如果有悬停的连接点，吸附到该点
                  if (hoveredPort) {
                    const toNode = nodes.find(n => n.id === hoveredPort.nodeId);
                    if (toNode) {
                      toPos = getPortPosition(toNode, hoveredPort.port);
                    }
                  }

                  return (
                    <line
                      x1={fromPos.x}
                      y1={fromPos.y}
                      x2={toPos.x}
                      y2={toPos.y}
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="4"
                      markerEnd="url(#arrowhead)"
                      className="text-primary pointer-events-none"
                    />
                  );
                })()}
              </>
            )}
          </svg>

          {/* Render nodes */}
          {nodes.map(node => {
            const isConnecting = connecting !== null;
            const isSourceNode = connecting?.from === node.id;
            const isEndNode = node.id === END_NODE_ID;

            return (
              <div
                key={node.id}
                className="absolute group"
                style={{
                  left: node.position.x,
                  top: node.position.y,
                  width: 60,
                  height: 60,
                }}
              >
                <div
                  className={cn(
                    "w-full h-full rounded-full border-2 flex items-center justify-center relative",
                    isEndNode
                      ? "bg-green-500/20 border-green-500"
                      : "bg-primary/10 border-primary",
                    !isConnecting ? "cursor-move" : "cursor-default"
                  )}
                  onMouseDown={(e) => {
                    if (!isConnecting) {
                      handleNodeDragStart(node.id, e);
                    }
                  }}
                >
                  {isEndNode ? (
                    <span className="text-xl font-bold text-green-600">END</span>
                  ) : (
                    <User className="h-6 w-6 text-primary" />
                  )}

                  {/* 连接模式下显示连接点 */}
                  {isConnecting && !isSourceNode && (
                    <>
                      {['top', 'right', 'bottom', 'left'].map(port => {
                        const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === port;
                        const portStyle = {
                          top: port === 'top' ? '-4px' : port === 'bottom' ? 'auto' : '50%',
                          bottom: port === 'bottom' ? '-4px' : 'auto',
                          left: port === 'left' ? '-4px' : port === 'right' ? 'auto' : '50%',
                          right: port === 'right' ? '-4px' : 'auto',
                          transform:
                            port === 'top' || port === 'bottom' ? 'translateX(-50%)' :
                            port === 'left' || port === 'right' ? 'translateY(-50%)' : 'none',
                        };

                        return (
                          <button
                            key={port}
                            className={cn(
                              "absolute w-3 h-3 rounded-full border-2 border-primary transition-all z-10",
                              isHovered ? "bg-primary scale-150" : "bg-background"
                            )}
                            style={portStyle}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompleteConnection(node.id, port);
                            }}
                          />
                        );
                      })}
                    </>
                  )}

                  {/* 非连接模式下显示操作按钮 */}
                  {!isConnecting && (
                    <>
                      {/* Connection handles for each direction */}
                      {['top', 'right', 'bottom', 'left'].map(port => {
                        const portStyle = {
                          top: port === 'top' ? '-8px' : port === 'bottom' ? 'auto' : '50%',
                          bottom: port === 'bottom' ? '-8px' : 'auto',
                          left: port === 'left' ? '-8px' : port === 'right' ? 'auto' : '50%',
                          right: port === 'right' ? '-8px' : 'auto',
                          transform:
                            port === 'top' || port === 'bottom' ? 'translateX(-50%)' :
                            port === 'left' || port === 'right' ? 'translateY(-50%)' : 'none',
                        };

                        return (
                          <button
                            key={port}
                            className="absolute w-5 h-5 rounded-full bg-primary text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-bold z-10"
                            style={portStyle}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartConnection(node.id, port);
                            }}
                            title={t('workflowEditor.connect')}
                          >
                            +
                          </button>
                        );
                      })}

                      {/* Remove button - hide for END node */}
                      {!isEndNode && (
                        <button
                          className="absolute -right-1 -top-1 w-5 h-5 rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveNode(node.id);
                          }}
                          title={t('workflowEditor.remove')}
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="text-[10px] text-center mt-1 truncate px-1">
                  {agentNamesMap[node.agentId]}
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <User className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p className="text-sm">{t('workflowEditor.dragAgents')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="border-t p-4 flex justify-between items-center bg-muted/30">
          <div className="text-sm text-muted-foreground">
            {nodes.length} {t('workflowEditor.agents')}, {edges.length} {t('workflowEditor.connections')}
            {connecting && (
              <span className="ml-2 text-primary">({t('workflowEditor.connectingMode')})</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSave}>
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      </div>

      {/* Edge description dialog */}
      <Dialog open={!!selectedEdge} onOpenChange={(open) => {
        if (!open) {
          setSelectedEdge(null);
          setEdgeDescription('');
          setEdgeRollback(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workflowEditor.editConnection')}</DialogTitle>
            <DialogDescription>{t('workflowEditor.editConnectionDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('workflowEditor.instruction')}</Label>
              <Textarea
                placeholder={t('workflowEditor.instructionPlaceholder')}
                value={edgeDescription}
                onChange={(e) => setEdgeDescription(e.target.value)}
                rows={3}
              />
            </div>
            {(() => {
              const currentEdge = edges.find(e => e.id === selectedEdge);
              if (!currentEdge) return null;

              // Don't show rollback option if target is END node
              if (currentEdge.target === END_NODE_ID) return null;

              return (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edge-rollback"
                    checked={edgeRollback}
                    onCheckedChange={(checked: boolean | 'indeterminate') => setEdgeRollback(checked === true)}
                  />
                  <label
                    htmlFor="edge-rollback"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t('workflowEditor.enableRollback')}
                  </label>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              const edgeId = selectedEdge;
              setSelectedEdge(null);
              if (edgeId) handleRemoveEdge(edgeId);
            }}>
              {t('workflowEditor.removeConnection')}
            </Button>
            <Button onClick={handleSaveEdgeDescription}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamCard({ team, agents, onEdit, onRename, onDelete, onCreateTask }: {
  team: Team;
  agents: { id: string; name: string }[];
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
}) {
  const { t } = useTranslation('teams');

  const agentNamesMap = Object.fromEntries(agents.map(a => [a.id, a.name]));

  // 渲染缩略流程图
  const renderMiniWorkflow = () => {
    const { nodes, edges } = team.workflow;

    if (nodes.length === 0) {
      return (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          {t('teamCard.emptyWorkflow')}
        </div>
      );
    }

    // Sort nodes by workflow execution order (topological sort)
    const sortedNodes = getTopologicalOrder(nodes, edges);

    // 简单的缩略图布局
    return (
      <div className="h-24 flex items-center justify-center gap-2 overflow-hidden">
        {sortedNodes.slice(0, 5).map((node, idx) => (
          <div key={node.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center",
                node.id === END_NODE_ID ? "bg-green-500/20" : "bg-primary/10"
              )}>
                {node.id === END_NODE_ID ? (
                  <span className="text-[8px] font-bold text-green-600">END</span>
                ) : (
                  <User className="h-4 w-4 text-primary" />
                )}
              </div>
              <span className="text-[9px] mt-1 truncate max-w-[40px]">
                {agentNamesMap[node.agentId] || node.agentId}
              </span>
            </div>
            {idx < Math.min(sortedNodes.length - 1, 4) && (
              <ArrowRight className="h-3 w-3 text-muted-foreground mx-1" />
            )}
          </div>
        ))}
        {sortedNodes.length > 5 && (
          <span className="text-xs text-muted-foreground">+{sortedNodes.length - 5}</span>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border bg-card hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold mb-2 truncate">{team.name}</h3>
            <div className="text-xs text-muted-foreground">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{t('teamCard.members')}:</span>
                <span className="truncate">{team.workflow.nodes.filter(n => n.id !== END_NODE_ID).length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('teamCard.createdAt')}:</span>
                <span>{new Date(team.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Action buttons with tooltips */}
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit}>
                  <Edit className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('teamCard.edit')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRename}>
                  <FileEdit className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('teamCard.rename')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCreateTask}>
                  <ListPlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('teamCard.createTask')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('teamCard.delete')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Mini workflow visualization */}
      <div className="p-3 bg-muted/30">
        {renderMiniWorkflow()}
      </div>
    </div>
  );
}

export function Teams() {
  const { t } = useTranslation(['teams', 'common']);
  const navigate = useNavigate();
  const teams = useTeamsStore(s => s.teams);
  const loading = useTeamsStore(s => s.loading);
  const fetchTeams = useTeamsStore(s => s.fetchTeams);
  const createTeam = useTeamsStore(s => s.createTeam);
  const updateTeam = useTeamsStore(s => s.updateTeam);
  const deleteTeam = useTeamsStore(s => s.deleteTeam);

  const agents = useAgentsStore(s => s.agents);
  const fetchAgents = useAgentsStore(s => s.fetchAgents);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    void fetchTeams();
    void fetchAgents();
  }, [fetchTeams, fetchAgents]);

  const handleRefresh = () => {
    void fetchTeams();
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      toast.error(t('toast.enterTeamName'));
      return;
    }

    try {
      // 创建一个空的工作流
      const workflow: TeamWorkflow = {
        nodes: [],
        edges: [],
      };
      await createTeam({ name: teamName, workflow });
      setCreateDialogOpen(false);
      setTeamName('');
      toast.success(t('toast.teamCreated'));
    } catch (error) {
      toast.error(t('toast.teamCreateFailed', { error: String(error) }));
    }
  };

  const handleEditTeam = (team: Team) => {
    setSelectedTeam(team);
    setEditDialogOpen(true);
  };

  const handleSaveWorkflow = async (workflow: TeamWorkflow) => {
    if (!selectedTeam) return;

    try {
      await updateTeam(selectedTeam.id, { workflow });
      setEditDialogOpen(false);
      setSelectedTeam(null);
      toast.success(t('toast.teamUpdated'));
    } catch (error) {
      toast.error(t('toast.teamUpdateFailed', { error: String(error) }));
    }
  };

  const handleRenameTeam = (team: Team) => {
    setSelectedTeam(team);
    setTeamName(team.name);
    setRenameDialogOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (!selectedTeam || !teamName.trim()) return;

    try {
      await updateTeam(selectedTeam.id, { name: teamName });
      setRenameDialogOpen(false);
      setTeamName('');
      setSelectedTeam(null);
      toast.success(t('toast.teamUpdated'));
    } catch (error) {
      toast.error(t('toast.teamUpdateFailed', { error: String(error) }));
    }
  };

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return;

    try {
      await deleteTeam(teamToDelete.id);
      setTeamToDelete(null);
      toast.success(t('toast.teamDeleted'));
    } catch (error) {
      toast.error(t('toast.teamDeleteFailed', { error: String(error) }));
    }
  };

  const handleCreateTask = (team: Team) => {
    // 导航到任务页面，并传递团队ID
    navigate('/tasks', { state: { teamId: team.id, teamName: team.name } });
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
              {t('newTeam')}
            </Button>
          </div>
        </div>
      </div>

      {/* Team List */}
      <div className="flex-1 overflow-auto p-6">
        {teams.length === 0 && !loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            {t('noTeams')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                agents={agents}
                onEdit={() => handleEditTeam(team)}
                onRename={() => handleRenameTeam(team)}
                onDelete={() => setTeamToDelete(team)}
                onCreateTask={() => handleCreateTask(team)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Team Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createDialog.title')}</DialogTitle>
            <DialogDescription>{t('createDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="team-name">{t('createDialog.nameLabel')}</Label>
              <Input
                id="team-name"
                placeholder={t('createDialog.namePlaceholder')}
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateDialogOpen(false); setTeamName(''); }}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleCreateTeam}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Team Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open);
        if (!open) setSelectedTeam(null);
      }}>
        <DialogContent className="max-w-6xl h-[85vh] p-0 flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>{t('editDialog.title')}: {selectedTeam?.name}</DialogTitle>
            <DialogDescription>{t('editDialog.description')}</DialogDescription>
          </DialogHeader>
          {selectedTeam && (
            <WorkflowEditor
              workflow={selectedTeam.workflow}
              agents={agents}
              onSave={handleSaveWorkflow}
              onCancel={() => {
                setEditDialogOpen(false);
                setSelectedTeam(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Rename Team Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('renameDialog.title')}</DialogTitle>
            <DialogDescription>{t('renameDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-team-name">{t('renameDialog.nameLabel')}</Label>
              <Input
                id="rename-team-name"
                placeholder={t('renameDialog.namePlaceholder')}
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRenameDialogOpen(false); setTeamName(''); setSelectedTeam(null); }}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleRenameSubmit}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!teamToDelete}
        title={t('deleteDialog.title')}
        message={t('deleteDialog.message', { name: teamToDelete?.name })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={handleDeleteTeam}
        onCancel={() => setTeamToDelete(null)}
      />
    </div>
  );
}
