import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageWindow,
} from './usage-history';
const DEFAULT_USAGE_FETCH_MAX_ATTEMPTS = 2;
const WINDOWS_USAGE_FETCH_MAX_ATTEMPTS = 3;
const USAGE_FETCH_RETRY_DELAY_MS = 1500;

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const usageFetchMaxAttempts = window.electron.platform === 'win32'
    ? WINDOWS_USAGE_FETCH_MAX_ATTEMPTS
    : DEFAULT_USAGE_FETCH_MAX_ATTEMPTS;

  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);

  type FetchState = {
    status: 'idle' | 'loading' | 'done';
    data: UsageHistoryEntry[];
  };
  type FetchAction =
    | { type: 'start' }
    | { type: 'done'; data: UsageHistoryEntry[] }
    | { type: 'reset' };

  const [fetchState, dispatchFetch] = useReducer(
    (state: FetchState, action: FetchAction): FetchState => {
      switch (action.type) {
        case 'start':
          return { status: 'loading', data: state.data };
        case 'done':
          return { status: 'done', data: action.data };
        case 'reset':
          return { status: 'idle', data: [] };
        default:
          return state;
      }
    },
    { status: 'idle' as const, data: [] as UsageHistoryEntry[] },
  );

  const usageFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageFetchGenerationRef = useRef(0);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  useEffect(() => {
    if (usageFetchTimerRef.current) {
      clearTimeout(usageFetchTimerRef.current);
      usageFetchTimerRef.current = null;
    }

    if (!isGatewayRunning) {
      dispatchFetch({ type: 'reset' });
      return;
    }

    dispatchFetch({ type: 'start' });
    const generation = usageFetchGenerationRef.current + 1;
    usageFetchGenerationRef.current = generation;
    const restartMarker = `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}`;
    trackUiEvent('models.token_usage_fetch_started', {
      generation,
      restartMarker,
    });

    // Safety timeout: if the fetch cycle hasn't resolved after 30 s,
    // force-resolve to "done" with empty data to avoid an infinite spinner.
    const safetyTimeout = setTimeout(() => {
      if (usageFetchGenerationRef.current !== generation) return;
      trackUiEvent('models.token_usage_fetch_safety_timeout', {
        generation,
        restartMarker,
      });
      dispatchFetch({ type: 'done', data: [] });
    }, 30_000);

    const fetchUsageHistoryWithRetry = async (attempt: number) => {
      trackUiEvent('models.token_usage_fetch_attempt', {
        generation,
        attempt,
        restartMarker,
      });
      try {
        const entries = await hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history');
        if (usageFetchGenerationRef.current !== generation) return;

        const normalized = Array.isArray(entries) ? entries : [];
        setUsagePage(1);
        trackUiEvent('models.token_usage_fetch_succeeded', {
          generation,
          attempt,
          records: normalized.length,
          restartMarker,
        });

        if (normalized.length === 0 && attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'empty',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
        } else {
          if (normalized.length === 0) {
            trackUiEvent('models.token_usage_fetch_exhausted', {
              generation,
              attempt,
              reason: 'empty',
              restartMarker,
            });
          }
          dispatchFetch({ type: 'done', data: normalized });
        }
      } catch (error) {
        if (usageFetchGenerationRef.current !== generation) return;
        trackUiEvent('models.token_usage_fetch_failed_attempt', {
          generation,
          attempt,
          restartMarker,
          message: error instanceof Error ? error.message : String(error),
        });
        if (attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'error',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
          return;
        }
        dispatchFetch({ type: 'done', data: [] });
        trackUiEvent('models.token_usage_fetch_exhausted', {
          generation,
          attempt,
          reason: 'error',
          restartMarker,
        });
      }
    };

    void fetchUsageHistoryWithRetry(1);

    return () => {
      clearTimeout(safetyTimeout);
      if (usageFetchTimerRef.current) {
        clearTimeout(usageFetchTimerRef.current);
        usageFetchTimerRef.current = null;
      }
    };
  }, [isGatewayRunning, gatewayStatus.connectedAt, gatewayStatus.pid, usageFetchMaxAttempts]);

  const usageHistory = fetchState.data;
  const visibleUsageHistory = isGatewayRunning ? usageHistory : [];
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && fetchState.status === 'loading';

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('dashboard:models.title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">
              {t('dashboard:models.subtitle')}
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2 space-y-12">
          
          {/* AI Providers Section */}
          <ProvidersSettings />

          {/* Token Usage History Section */}
          <div>
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('dashboard:recentTokenHistory.title', 'Token Usage History')}
            </h2>
            <div>
              {usageLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                  <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
                </div>
              ) : visibleUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
                </div>
              ) : filteredUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForWindow')} />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button
                          variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('model');
                            setUsagePage(1);
                          }}
                          className={usageGroupBy === 'model' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.groupByModel')}
                        </Button>
                        <Button
                          variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('day');
                            setUsagePage(1);
                          }}
                          className={usageGroupBy === 'day' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.groupByTime')}
                        </Button>
                      </div>
                      <div className="flex rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button
                          variant={usageWindow === '7d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('7d');
                            setUsagePage(1);
                          }}
                          className={usageWindow === '7d' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.last7Days')}
                        </Button>
                        <Button
                          variant={usageWindow === '30d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('30d');
                            setUsagePage(1);
                          }}
                          className={usageWindow === '30d' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.last30Days')}
                        </Button>
                        <Button
                          variant={usageWindow === 'all' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('all');
                            setUsagePage(1);
                          }}
                          className={usageWindow === 'all' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                        >
                          {t('dashboard:recentTokenHistory.allTime')}
                        </Button>
                      </div>
                    </div>
                    <p className="text-[13px] font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
                    </p>
                  </div>

                  {/* 垂直柱状图 */}
                  <VerticalBarChart
                    groups={usageGroups}
                    emptyLabel={t('dashboard:recentTokenHistory.empty')}
                    inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                    outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                    cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                    totalLabel={t('dashboard:recentTokenHistory.chartTotal')}
                    inputTooltip={t('dashboard:recentTokenHistory.chartInput')}
                    outputTooltip={t('dashboard:recentTokenHistory.chartOutput')}
                    cacheTooltip={t('dashboard:recentTokenHistory.chartCache')}
                  />

                  {/* 使用表格替代列表 */}
                  <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden bg-transparent">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-black/5 dark:bg-white/5 border-b border-black/10 dark:border-white/10">
                          <tr>
                            <th className="text-left py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableModel')}</th>
                            <th className="text-left py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableProvider')}</th>
                            <th className="text-left py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableTime')}</th>
                            <th className="text-right py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableInput')}</th>
                            <th className="text-right py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableOutput')}</th>
                            <th className="text-right py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableCache')}</th>
                            <th className="text-right py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableTotal')}</th>
                            {devModeUnlocked && <th className="text-center py-3 px-5 text-[13px] font-semibold text-foreground">{t('dashboard:recentTokenHistory.tableActions')}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedUsageHistory.map((entry, index) => (
                            <tr
                              key={`${entry.sessionId}-${entry.timestamp}`}
                              className={`border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${index === pagedUsageHistory.length - 1 ? 'border-b-0' : ''}`}
                            >
                              <td className="py-3.5 px-5">
                                <div className="flex flex-col">
                                  <span className="text-[14px] font-semibold text-foreground truncate max-w-xs">
                                    {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                                  </span>
                                  {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && (
                                    <span className="text-[11px] text-muted-foreground mt-0.5">
                                      ${entry.costUsd.toFixed(4)}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3.5 px-5 text-[13px] text-muted-foreground">
                                {entry.provider || '-'}
                              </td>
                              <td className="py-3.5 px-5 text-[13px] text-muted-foreground">
                                {formatUsageTimestamp(entry.timestamp)}
                              </td>
                              <td className="py-3.5 px-5 text-right text-[13px] font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-sky-500"></div>
                                  {formatTokenCount(entry.inputTokens)}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-right text-[13px] font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-violet-500"></div>
                                  {formatTokenCount(entry.outputTokens)}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-right text-[13px] font-medium">
                                {(entry.cacheReadTokens + entry.cacheWriteTokens) > 0 ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                                    {formatTokenCount(entry.cacheReadTokens + entry.cacheWriteTokens)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="py-3.5 px-5 text-right text-[14px] font-bold text-foreground">
                                {formatTokenCount(entry.totalTokens)}
                              </td>
                              {devModeUnlocked && (
                                <td className="py-3.5 px-5 text-center">
                                  {entry.content && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 rounded-lg px-2.5 text-[11.5px]"
                                      onClick={() => setSelectedUsageEntry(entry)}
                                    >
                                      {t('dashboard:recentTokenHistory.tableView')}
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-[13px] font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.max(1, page - 1))}
                        disabled={safeUsagePage <= 1}
                        className="rounded-full px-4 h-9 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        {t('dashboard:recentTokenHistory.prev')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))}
                        disabled={safeUsagePage >= usageTotalPages}
                        className="rounded-full px-4 h-9 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        {t('dashboard:recentTokenHistory.next')}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
      {devModeUnlocked && selectedUsageEntry && (
        <UsageContentPopup
          entry={selectedUsageEntry}
          onClose={() => setSelectedUsageEntry(null)}
          title={t('dashboard:recentTokenHistory.contentDialogTitle')}
          closeLabel={t('dashboard:recentTokenHistory.close')}
          unknownModelLabel={t('dashboard:recentTokenHistory.unknownModel')}
        />
      )}
    </div>
  );
}

function formatTokenCount(value: number): string {
  return Intl.NumberFormat().format(value);
}

function formatUsageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}


// 垂直柱状图组件
function VerticalBarChart({
  groups,
  emptyLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
  totalLabel,
  inputTooltip,
  outputTooltip,
  cacheTooltip,
}: {
  groups: Array<{
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }>;
  emptyLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
  totalLabel: string;
  inputTooltip: string;
  outputTooltip: string;
  cacheTooltip: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-8 text-center text-[14px] font-medium text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 1);

// 计算 Y 轴刻度
  const getYAxisTicks = (max: number) => {
    const tickCount = 5;
    const step = Math.ceil(max / tickCount / 1000) * 1000; // 向上取整到千位
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(i * step);
    }
    return ticks.filter(tick => tick <= max * 1.1);
  };

  // 格式化 Y 轴刻度为 K 单位
  const formatYAxisTick = (value: number): string => {
    if (value === 0) return '0';
    if (value >= 1000) {
      return `${Math.round(value / 1000)}K`;
    }
    return value.toString();
  };

  const yAxisTicks = getYAxisTicks(maxTokens);
  const yAxisMax = Math.max(...yAxisTicks);

  return (
    <div className="bg-transparent p-6 rounded-2xl border border-black/10 dark:border-white/10">
      {/* 图例 */}
      <div className="flex flex-wrap gap-4 text-[13px] font-medium text-muted-foreground mb-6">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-sky-500" />
          {inputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-violet-500" />
          {outputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-amber-500" />
          {cacheLabel}
        </span>
      </div>

      {/* 图表容器 */}
      <div className="flex gap-4">
        {/* Y 轴 */}
        <div className="flex flex-col justify-between h-64 py-8 pr-3 border-r border-black/10 dark:border-white/10">
          {yAxisTicks.slice().reverse().map((tick) => (
            <div key={tick} className="relative">
              <span className="text-[11px] text-muted-foreground font-medium">
                {formatYAxisTick(tick)}
              </span>
            </div>
          ))}
        </div>

        {/* 柱状图区域 */}
        <div className="flex-1 overflow-x-auto relative">
          {/* 水平网格线 */}
          <div className="absolute inset-0 flex flex-col justify-between py-8 pointer-events-none">
            {yAxisTicks.slice().reverse().map((tick, index) => (
              <div
                key={tick}
                className={`w-full border-t ${index === yAxisTicks.length - 1 ? 'border-black/20 dark:border-white/20' : 'border-black/5 dark:border-white/5'}`}
              />
            ))}
          </div>

          <div className="flex items-end gap-4 h-64 min-w-max relative z-10">
            {groups.map((group) => {
              const heightPercent = (group.totalTokens / yAxisMax) * 100;
              return (
                <div key={group.label} className="flex flex-col items-center" style={{ width: '72px' }}>
                  {/* 柱子容器 */}
                  <div className="w-full h-56 flex flex-col justify-end relative">
                    <div className="w-full relative group h-full flex flex-col justify-end">
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                        <div className="bg-background border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                          <p className="text-[12px] font-semibold text-foreground mb-1">{group.label}</p>
                          <p className="text-[11px] text-muted-foreground">{totalLabel}: {formatTokenCount(group.totalTokens)}</p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-[11px] text-sky-500">{inputTooltip}: {formatTokenCount(group.inputTokens)}</p>
                            <p className="text-[11px] text-violet-500">{outputTooltip}: {formatTokenCount(group.outputTokens)}</p>
                            {group.cacheTokens > 0 && (
                              <p className="text-[11px] text-amber-500">{cacheTooltip}: {formatTokenCount(group.cacheTokens)}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 柱子主体 */}
                      <div
                        className="w-full rounded-t-lg overflow-hidden transition-all hover:shadow-lg cursor-pointer"
                        style={{ height: `${Math.max(heightPercent, 3)}%` }}
                      >
                        <div className="w-full h-full flex flex-col-reverse">
                          {group.inputTokens > 0 && (
                            <div
                              className="w-full bg-sky-500 transition-all"
                              style={{ height: `${(group.inputTokens / group.totalTokens) * 100}%` }}
                            />
                          )}
                          {group.outputTokens > 0 && (
                            <div
                              className="w-full bg-violet-500 transition-all"
                              style={{ height: `${(group.outputTokens / group.totalTokens) * 100}%` }}
                            />
                          )}
                          {group.cacheTokens > 0 && (
                            <div
                              className="w-full bg-amber-500 transition-all"
                              style={{ height: `${(group.cacheTokens / group.totalTokens) * 100}%` }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* X 轴标签 */}
                  <div className="w-full text-center pt-2 h-8">
                    <p className="text-[11px] font-medium text-foreground truncate px-1" title={group.label}>
                      {group.label.length > 10 ? `${group.label.substring(0, 9)}...` : group.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatTokenCount(group.totalTokens)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageContentPopup({
  entry,
  onClose,
  title,
  closeLabel,
  unknownModelLabel,
}: {
  entry: UsageHistoryEntry;
  onClose: () => void;
  title: string;
  closeLabel: string;
  unknownModelLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 dark:border-white/10 bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 dark:border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {(entry.model || unknownModelLabel)} • {formatUsageTimestamp(entry.timestamp)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">
            {entry.content}
          </pre>
        </div>
        <div className="flex justify-end border-t border-black/10 dark:border-white/10 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default Models;