import type { IncomingMessage, ServerResponse } from 'http';
import * as teamConfig from '../../utils/team-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleTeamRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // List teams
  if (url.pathname === '/api/teams' && req.method === 'GET') {
    try {
      const snapshot = await teamConfig.listTeamsSnapshot();
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Create a new team
  if (url.pathname === '/api/teams' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        name: string;
        workflow: teamConfig.TeamWorkflow;
      }>(req);

      if (!body.name || typeof body.name !== 'string') {
        sendJson(res, 400, { success: false, error: 'Team name is required' });
        return true;
      }

      if (!body.workflow) {
        sendJson(res, 400, { success: false, error: 'Team workflow is required' });
        return true;
      }

      const snapshot = await teamConfig.createTeam(body.name, body.workflow);
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Handle team-specific routes
  if (url.pathname.startsWith('/api/teams/')) {
    const suffix = url.pathname.slice('/api/teams/'.length);
    const parts = suffix.split('/').filter(Boolean);

    // Get a specific team
    if (parts.length === 1 && req.method === 'GET') {
      try {
        const teamId = decodeURIComponent(parts[0]);
        const team = await teamConfig.getTeam(teamId);
        sendJson(res, 200, { success: true, team });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Update a team
    if (parts.length === 1 && req.method === 'PUT') {
      try {
        const teamId = decodeURIComponent(parts[0]);
        const body = await parseJsonBody<{
          name?: string;
          workflow?: teamConfig.TeamWorkflow;
        }>(req);

        const snapshot = await teamConfig.updateTeam(teamId, body);
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Delete a team
    if (parts.length === 1 && req.method === 'DELETE') {
      try {
        const teamId = decodeURIComponent(parts[0]);
        const snapshot = await teamConfig.deleteTeam(teamId);
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  void ctx;
  return false;
}
