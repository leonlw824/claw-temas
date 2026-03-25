/**
 * Apps Page
 * Displays installed applications
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppsStore } from '@/stores/apps';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Package, RefreshCw, Power, PowerOff, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function Apps() {
  const { t } = useTranslation('apps');
  const navigate = useNavigate();
  const { apps, loading, fetchApps, toggleApp, uninstallApp } = useAppsStore();
  const [togglingAppId, setTogglingAppId] = useState<string | null>(null);

  useEffect(() => {
    void fetchApps();
  }, [fetchApps]);

  const handleToggle = async (appId: string, currentEnabled: boolean) => {
    setTogglingAppId(appId);
    try {
      await toggleApp(appId, !currentEnabled);
      toast.success(currentEnabled ? t('toast.appDisabled') : t('toast.appEnabled'));
    } catch (error) {
      toast.error(t('toast.toggleFailed', { error: String(error) }));
    } finally {
      setTogglingAppId(null);
    }
  };

  const handleUninstall = async (appId: string) => {
    if (!confirm(t('confirmUninstall'))) return;

    try {
      await uninstallApp(appId);
      toast.success(t('toast.appUninstalled'));
    } catch (error) {
      toast.error(t('toast.uninstallFailed', { error: String(error) }));
    }
  };

  const handleOpenApp = (appId: string, enabled: boolean) => {
    if (!enabled) {
      toast.error(t('toast.appDisabled'));
      return;
    }
    navigate(`/apps/${appId}`);
  };

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const appEntries = Object.entries(apps);

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1
              className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight"
              style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
            >
              {t('pageTitle')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => void fetchApps()}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {appEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">{t('noApps')}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {appEntries.map(([appId, app]) => (
                <Card
                  key={appId}
                  className={cn(
                    'p-5 hover:shadow-md transition-all cursor-pointer',
                    !app.enabled && 'opacity-60'
                  )}
                  onClick={() => handleOpenApp(appId, app.enabled)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="text-3xl">{app.icon || '📦'}</div>
                      <div>
                        <h3 className="font-semibold text-base">{app.name}</h3>
                        <p className="text-xs text-muted-foreground">v{app.version || '1.0.0'}</p>
                      </div>
                    </div>
                    <Badge variant={app.type === 'internal' ? 'default' : 'secondary'}>
                      {app.type === 'internal' ? t('internal') : t('external')}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {app.description || t('noDescription')}
                  </p>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={app.enabled ? 'outline' : 'default'}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggle(appId, app.enabled);
                      }}
                      disabled={togglingAppId === appId}
                      className="flex-1"
                    >
                      {app.enabled ? (
                        <>
                          <Power className="h-3.5 w-3.5 mr-2" />
                          {t('disable')}
                        </>
                      ) : (
                        <>
                          <PowerOff className="h-3.5 w-3.5 mr-2" />
                          {t('enable')}
                        </>
                      )}
                    </Button>
                    {app.type === 'external' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleUninstall(appId);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Apps;
