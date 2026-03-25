/**
 * Application API Routes
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson, parseJsonBody } from '../route-utils';
import * as appConfig from '../../utils/app-config';

export async function handleAppRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // List all apps
  if (url.pathname === '/api/apps' && req.method === 'GET') {
    try {
      const snapshot = await appConfig.listApps();
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Install an app
  if (url.pathname === '/api/apps' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        appId: string;
        name: string;
        type: appConfig.AppType;
        description?: string;
        icon?: string;
        version?: string;
        author?: string;
      }>(req);

      if (!body.appId || !body.name || !body.type) {
        sendJson(res, 400, { success: false, error: 'Missing required fields' });
        return true;
      }

      const appConfigData: appConfig.AppConfig = {
        name: body.name,
        type: body.type,
        enabled: true,
        description: body.description,
        icon: body.icon,
        version: body.version,
        author: body.author,
      };

      const snapshot = await appConfig.installApp(body.appId, appConfigData);
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Handle app-specific routes
  if (url.pathname.startsWith('/api/apps/')) {
    const suffix = url.pathname.slice('/api/apps/'.length);
    const parts = suffix.split('/').filter(Boolean);

    // Get app manifest
    if (parts.length === 2 && parts[1] === 'manifest' && req.method === 'GET') {
      try {
        const appId = decodeURIComponent(parts[0]);
        const manifest = await appConfig.readAppManifest(appId);
        sendJson(res, 200, { success: true, manifest });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Get app entry (HTML or JS)
    if (parts.length === 2 && parts[1] === 'entry' && req.method === 'GET') {
      try {
        const appId = decodeURIComponent(parts[0]);
        const manifest = await appConfig.readAppManifest(appId);
        const content = await appConfig.readAppEntry(appId);

        // Determine content type based on entry file extension or manifest type
        let contentType = 'text/html; charset=utf-8';
        if (manifest.entry.endsWith('.js') || manifest.type === 'component') {
          contentType = 'application/javascript; charset=utf-8';
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Toggle app enabled
    if (parts.length === 2 && parts[1] === 'toggle' && req.method === 'POST') {
      try {
        const appId = decodeURIComponent(parts[0]);
        const body = await parseJsonBody<{ enabled: boolean }>(req);

        if (typeof body.enabled !== 'boolean') {
          sendJson(res, 400, { success: false, error: 'Missing enabled field' });
          return true;
        }

        const snapshot = await appConfig.toggleAppEnabled(appId, body.enabled);
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    // Uninstall an app
    if (parts.length === 1 && req.method === 'DELETE') {
      try {
        const appId = decodeURIComponent(parts[0]);
        const snapshot = await appConfig.uninstallApp(appId);
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
