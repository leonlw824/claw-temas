/**
 * Workflow Visualization Component
 * Displays team workflow with status-based line colors
 */
import { useMemo } from 'react';
import type { TeamNode, TeamEdge } from '@/types/team';
import type { TaskExecutionNode } from '@/types/task';
import { cn } from '@/lib/utils';

interface WorkflowVisualizationProps {
  nodes: TeamNode[];
  edges: TeamEdge[];
  nodeResults: Record<string, TaskExecutionNode>;
  agents: { id: string; name: string }[];
}

export function WorkflowVisualization({
  nodes,
  edges,
  nodeResults,
  agents,
}: WorkflowVisualizationProps) {
  // Calculate node positions and normalize to SVG viewport
  const { normalizedNodes, svgWidth, svgHeight } = useMemo(() => {
    if (nodes.length === 0) {
      return { normalizedNodes: [], svgWidth: 400, svgHeight: 100 };
    }

    const minX = Math.min(...nodes.map(n => n.position.x));
    const maxX = Math.max(...nodes.map(n => n.position.x));
    const minY = Math.min(...nodes.map(n => n.position.y));
    const maxY = Math.max(...nodes.map(n => n.position.y));

    const padding = 80;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    const normalized = nodes.map(node => ({
      ...node,
      x: node.position.x - minX + padding,
      y: node.position.y - minY + padding,
    }));

    return {
      normalizedNodes: normalized,
      svgWidth: width,
      svgHeight: height,
    };
  }, [nodes]);

  // Get edge status based on source node status
  // When source node is running, the outgoing edge flows
  // When source node is completed, the outgoing edge becomes solid
  const getEdgeStatus = (edge: TeamEdge): 'waiting' | 'running' | 'completed' | 'failed' | 'stopped' => {
    const sourceNode = nodeResults[edge.source];

    // Edge flows when source node is running
    if (sourceNode?.status === 'running') {
      return 'running';
    }

    // Edge becomes solid when source node is completed
    if (sourceNode?.status === 'completed') {
      return 'completed';
    }

    // Edge shows failed when source node failed
    if (sourceNode?.status === 'failed') {
      return 'failed';
    }

    // Edge shows stopped when source node stopped
    if (sourceNode?.status === 'stopped') {
      return 'stopped';
    }

    // Default: waiting (source node not started yet)
    return 'waiting';
  };

  const getNodeStatus = (nodeId: string): 'waiting' | 'running' | 'completed' | 'failed' | 'stopped' => {
    const result = nodeResults[nodeId];
    if (!result) return 'waiting';
    // Map all possible statuses to the five valid ones
    if (result.status === 'pending' || result.status === 'skipped') {
      return 'waiting';
    }
    if (result.status === 'stopped') {
      return 'stopped';
    }
    return result.status;
  };

  const getAgentName = (agentId: string): string => {
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || agentId;
  };

  // Get line color class based on status
  const getLineClass = (status: 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'): string => {
    switch (status) {
      case 'running':
        return 'stroke-blue-500';
      case 'completed':
        return 'stroke-green-500';
      case 'failed':
        return 'stroke-red-500';
      case 'stopped':
        return 'stroke-yellow-500';
      default:
        return 'stroke-gray-300 dark:stroke-gray-600';
    }
  };

  // Get node color class based on status
  const getNodeClass = (status: 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'): string => {
    switch (status) {
      case 'running':
        return 'fill-blue-500 stroke-blue-700';
      case 'completed':
        return 'fill-green-500 stroke-green-700';
      case 'failed':
        return 'fill-red-500 stroke-red-700';
      case 'stopped':
        return 'fill-yellow-500 stroke-yellow-700';
      default:
        return 'fill-gray-300 stroke-gray-500 dark:fill-gray-600 dark:stroke-gray-700';
    }
  };

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
        No workflow configured
      </div>
    );
  }

  return (
    <div className="mt-3 border rounded-lg p-3 bg-muted/30">
      <style>{`
        @keyframes dash {
          to {
            stroke-dashoffset: -20;
          }
        }
        .workflow-line-running {
          stroke-dasharray: 8 4;
          animation: dash 1s linear infinite;
        }
      `}</style>
      <svg
        width="100%"
        height="180"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto"
      >
        {/* Draw edges */}
        {edges.map(edge => {
          const sourceNode = normalizedNodes.find(n => n.id === edge.source);
          const targetNode = normalizedNodes.find(n => n.id === edge.target);
          if (!sourceNode || !targetNode) return null;

          const edgeStatus = getEdgeStatus(edge);
          const lineClass = getLineClass(edgeStatus);
          const isRunning = edgeStatus === 'running';

          return (
            <g key={edge.id}>
              <line
                x1={sourceNode.x}
                y1={sourceNode.y}
                x2={targetNode.x}
                y2={targetNode.y}
                className={cn('stroke-[4]', lineClass, isRunning && 'workflow-line-running')}
                strokeWidth="4"
              />
              {/* Arrow head */}
              <polygon
                points={`${targetNode.x},${targetNode.y} ${targetNode.x - 12},${targetNode.y - 8} ${targetNode.x - 12},${targetNode.y + 8}`}
                className={cn(lineClass.replace('stroke-', 'fill-').replace('animate-pulse', ''))}
                transform={`rotate(${Math.atan2(targetNode.y - sourceNode.y, targetNode.x - sourceNode.x) * 180 / Math.PI}, ${targetNode.x}, ${targetNode.y})`}
              />
            </g>
          );
        })}

        {/* Draw nodes */}
        {normalizedNodes.map(node => {
          const nodeStatus = getNodeStatus(node.id);
          const nodeClass = getNodeClass(nodeStatus);
          const agentName = getAgentName(node.agentId);

          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={30}
                className={cn('stroke-[3]', nodeClass)}
              />
              <text
                x={node.x}
                y={node.y + 45}
                textAnchor="middle"
                className="text-sm fill-current font-medium"
              >
                {agentName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
