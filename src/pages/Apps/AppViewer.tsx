/**
 * App Viewer Page
 * Displays an application using either Component or iframe rendering
 * Supports dynamic loading of compiled extension apps (UMD format)
 */
import { useEffect, useState } from 'react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppsStore } from '@/stores/apps';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { ComponentType } from 'react';

export function AppViewer() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('apps');
  const { apps, fetchApps, getAppEntry, getAppManifest } = useAppsStore();
  const [loading, setLoading] = useState(true);
  const [appContent, setAppContent] = useState<string>('');
  const [externalUrl, setExternalUrl] = useState<string>('');
  const [AppComponent, setAppComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apps || Object.keys(apps).length === 0) {
      void fetchApps();
    }
  }, [apps, fetchApps]);

  useEffect(() => {
    if (!appId) return;

    const app = apps[appId];
    if (!app) return;

    const loadApp = async () => {
      setLoading(true);
      setError(null);

      try {
        if (app.type === 'internal') {
          // Setup globals for UMD modules
          (window as any).React = React;
          (window as any).ReactDOM = ReactDOM;
          (window as any).process = { env: { NODE_ENV: 'production' } };

          // Load UMD component
          const jsCode = await getAppEntry(appId);

          // Infer global name: hello-world -> HelloWorldApp
          const globalName = appId
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('') + 'App';

          // Execute script
          const script = document.createElement('script');
          script.textContent = jsCode;
          document.head.appendChild(script);

          // Get component from window
          const component = (window as any)[globalName];

          // Cleanup
          document.head.removeChild(script);

          if (!component) {
            throw new Error(`Component not found: ${globalName}`);
          }

          setAppComponent(() => component);
        } else {
          // For external apps, get URL from manifest
          const manifest = await getAppManifest(appId);
          if (manifest.url) {
            // Direct URL - use webview for external sites (bypasses CORS)
            setExternalUrl(manifest.url);
          } else {
            // Load HTML content
            const html = await getAppEntry(appId);
            setAppContent(html);
          }
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    void loadApp();
  }, [appId, apps, getAppEntry, getAppManifest]);

  const app = appId ? apps[appId] : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-destructive">Failed to load app: {error}</p>
        <Button onClick={() => navigate('/apps')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Apps
        </Button>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">App not found</p>
        <Button onClick={() => navigate('/apps')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Apps
        </Button>
      </div>
    );
  }

  // Render component-based apps
  if (app.type === 'internal' && AppComponent) {
    return (
      <div className="flex flex-col h-full -m-6">
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-background z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/apps')}
            className="rounded-full"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{app.icon || '👋'}</span>
            <h2 className="text-lg font-semibold">{app.name}</h2>
            <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
              {t('internal')}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <AppComponent />
        </div>
      </div>
    );
  }

  // Render iframe-based apps
  return (
    <div className="flex flex-col h-full -m-6">
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-background z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/apps')}
          className="rounded-full"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{app.icon || '📦'}</span>
          <h2 className="text-lg font-semibold">{app.name}</h2>
          <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-2 py-1 rounded">
            {t('external')}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {externalUrl ? (
          // Use webview for external URLs (bypasses CORS)
          <webview
            src={externalUrl}
            className="w-full h-full border-none"
            style={{ width: '100%', height: '100%' }}
            allowpopups="true"
          />
        ) : (
          <iframe
            srcDoc={appContent}
            className="w-full h-full border-none"
            title={app.name}
            sandbox="allow-scripts allow-forms allow-modals"
          />
        )}
      </div>
    </div>
  );
}

export default AppViewer;
