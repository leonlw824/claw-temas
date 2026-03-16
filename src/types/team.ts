/**
 * Team Types
 * Frontend types for team management
 */

// Special END node constant
export const END_NODE_ID = '__END__';
export const END_AGENT_ID = '__END__';

export interface TeamNode {
  id: string;
  agentId: string;
  position: { x: number; y: number };
}

export interface TeamEdge {
  id: string;
  source: string;
  target: string;
  description?: string;
  sourcePort?: string;
  targetPort?: string;
  rollback?: boolean;  // Enable rollback - allows target node to send work back to source
}

export interface TeamWorkflow {
  nodes: TeamNode[];
  edges: TeamEdge[];
}

export interface Team {
  id: string;
  name: string;
  workflow: TeamWorkflow;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamData {
  name: string;
  workflow: TeamWorkflow;
}

export interface UpdateTeamData {
  name?: string;
  workflow?: TeamWorkflow;
}
