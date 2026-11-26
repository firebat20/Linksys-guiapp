import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RouterInfoData, FirmwareUpdateData, WANStatusData, SystemHealthData, api } from '../services/api';
import { ConfirmModal } from './ConfirmModal';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import {
  Cpu,
  Download,
  RefreshCw,
  Power,
  ShieldAlert,
  CheckCircle2,
  Calendar,
  Hash,
  Tag,
  Layers,
  Globe,
  Activity,
  Wifi,
  Clock,
  Network,
  Copy,
  Check,
} from 'lucide-react';

interface OverviewTabProps {
  onOpenRebootModal: () => void;
  onNotify: (msg: string, type: 'info' | 'success' | 'error') => void;
}

function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return 'Unknown';
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const ResourceBar: React.FC<{ label: string; value: number | null }> = ({ label, value }) => {
  const numeric = value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  const clamped = numeric === null ? 0 : Math.min(100, Math.max(0, numeric));
  const color =
    numeric === null
      ? 'var(--text-muted)'
      : clamped >= 85
        ? '#ef4444'
        : clamped >= 65
          ? '#f59e0b'
          : 'var(--accent-cyan)';

  return (
    <div style={{ marginTop: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: numeric === null ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {numeric === null ? 'N/A' : `${clamped.toFixed(1).replace(/\.0$/, '')}%`}
        </span>
      </div>
      <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-full)', height: '6px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${clamped}%`, background: color, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
};

export const OverviewTab: React.FC<OverviewTabProps> = ({ onOpenRebootModal, onNotify }) => {
  const [info, setInfo] = useState<RouterInfoData | null>(null);
  const [fwData, setFwData] = useState<FirmwareUpdateData | null>(null);
  const [wan, setWan] = useState<WANStatusData | null>(null);
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [checkingFw, setCheckingFw] = useState(false);
  const [showFwConfirm, setShowFwConfirm] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const { copiedId, copyToClipboard } = useCopyToClipboard();
  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async (isBackground = false) => {
    const seq = ++loadSeqRef.current;
    if (!isBackground) setLoadingInfo(true);
    try {
      // The backend batches these into a single core/Transaction request.
      const overview = await api.getRouterOverview();
      if (!mountedRef.current || seq !== loadSeqRef.current) return;
      setInfo(overview.info ?? null);
      setFwData(overview.firmware ?? null);
      setWan(overview.wan ?? null);
      setHealth(overview.health ?? null);
      setWarnings(overview.warnings ?? []);
    } catch {
      // Older firmware or a refused transaction can fail the overview call.
      // Fall back to individual requests so the tab still renders.
      const results = await Promise.allSettled([
        api.getRouterInfo(),
        api.checkFirmwareUpdate(),
        api.getWANStatus(),
        api.getSystemHealth(),
      ]);
      if (!mountedRef.current || seq !== loadSeqRef.current) return;

      const [infoRes, fwRes, wanRes, healthRes] = results;
      const fallbackWarnings: string[] = [];

      if (infoRes.status === 'fulfilled') setInfo(infoRes.value);
      if (fwRes.status === 'fulfilled') {
        setFwData(fwRes.value);
      } else {
        fallbackWarnings.push('Firmware update status is unavailable.');
      }
      if (wanRes.status === 'fulfilled') {
        setWan(wanRes.value);
      } else {
        fallbackWarnings.push('WAN status is unavailable.');
      }
      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
      } else {
        fallbackWarnings.push('System health is unavailable.');
      }
      setWarnings(fallbackWarnings);

      // Only notify if core router info failed to load
      if (!isBackground && infoRes.status === 'rejected') {
        const msg = infoRes.reason instanceof Error ? infoRes.reason.message : String(infoRes.reason);
        onNotify(msg || 'Failed to load router information', 'error');
      }
    } finally {
      if (!isBackground && mountedRef.current && seq === loadSeqRef.current) {
        setLoadingInfo(false);
      }
    }
  }, [onNotify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh interval (15s) for live stats & uptime
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const handleCheckFirmware = async () => {
    setCheckingFw(true);
    try {
      const res = await api.checkFirmwareUpdate();
      setFwData(res);
      if (res.updateAvailable) {
        onNotify(`Firmware update available! Version ${res.newVersion}`, 'info');
      } else {
        onNotify('Router firmware is up to date.', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to check firmware update', 'error');
    } finally {
      setCheckingFw(false);
    }
  };

  const handleTriggerUpdate = async () => {
    setShowFwConfirm(false);
    try {
      await api.triggerFirmwareUpdate();
      onNotify('Firmware update initiated successfully.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to trigger firmware update', 'error');
    }
  };

  const updateAvailable = !!fwData?.updateAvailable;
  const fwBoxStyle: React.CSSProperties = {
    background: updateAvailable ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)',
    border: updateAvailable ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)',
    borderRadius: 'var(--radius-md)',
    padding: '18px',
    marginBottom: '20px'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Firmware Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showFwConfirm}
        title="Trigger Firmware Update"
        description="This will start an OTA firmware update on the router. The router may reboot automatically after installation completes."
        warningText="Do not power off the router during the update. Network connectivity may be temporarily interrupted."
        confirmLabel="Start Update"
        confirmVariant="primary"
        onConfirm={handleTriggerUpdate}
        onCancel={() => setShowFwConfirm(false)}
      />

      {/* Top Banner / Quick Action Bar */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', padding: '20px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'rgba(59, 130, 246, 0.15)',
            color: 'var(--accent-blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Cpu size={26} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700' }}>
              {info ? `${info.manufacturer} ${info.modelNumber}` : 'Linksys Smart Router'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '2px' }}>
              System Status:{' '}
              <span
                style={{
                  color: wan && !wan.isConnected ? 'var(--status-offline)' : 'var(--status-online)',
                  fontWeight: '600',
                }}
              >
                {wan ? (wan.isConnected ? 'Internet Connected' : 'Internet Disconnected') : 'Active & Operational'}
              </span>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className={`btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '8px 12px', fontSize: '0.82rem' }}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Automatically poll router for live statistics every 15 seconds"
          >
            <RefreshCw size={14} className={autoRefresh ? 'spin' : ''} />
            {autoRefresh ? 'Auto-refresh: On' : 'Auto-refresh: Off'}
          </button>
          <button className="btn btn-secondary" onClick={() => loadData()} disabled={loadingInfo}>
            <RefreshCw size={16} className={loadingInfo ? 'spin' : ''} />
            Refresh
          </button>
          <button className="btn btn-danger" onClick={onOpenRebootModal}>
            <Power size={16} />
            Reboot Router
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
          }}
        >
          <ShieldAlert size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Some overview data is unavailable
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Grid: WAN & System Health */}
      <div className="grid-2">
        {/* Internet / WAN Status */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Globe size={20} />
              Internet (WAN)
            </div>
            <span className={wan ? (wan.isConnected ? 'badge-green' : 'badge-amber') : 'badge-blue'}>
              {wan ? (wan.isConnected ? 'Connected' : wan.status || 'Disconnected') : 'Unavailable'}
            </span>
          </div>

          {wan ? (
            <div className="info-list">
              <div className="info-row">
                <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wifi size={16} /> Connection Type
                </span>
                <span className="info-value">{wan.wanType || 'Unknown'}</span>
              </div>
              <div className="info-row">
                <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Globe size={16} /> Public IPv4
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="info-value">{wan.ipAddress || 'Not assigned'}</span>
                  {wan.ipAddress && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(wan.ipAddress, 'wan-ip')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: copiedId === 'wan-ip' ? 'var(--status-online)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                      title="Copy Public IP address"
                    >
                      {copiedId === 'wan-ip' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  )}
                </div>
              </div>
              {wan.gateway && (
                <div className="info-row">
                  <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Network size={16} /> Gateway
                  </span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span className="info-value">{wan.gateway}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(wan.gateway, 'wan-gw')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: copiedId === 'wan-gw' ? 'var(--status-online)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                      title="Copy Gateway address"
                    >
                      {copiedId === 'wan-gw' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              )}
              {((wan.dnsServers && wan.dnsServers.length > 0) || (wan.dns1 && wan.dns1 !== '0.0.0.0')) && (
                <div className="info-row">
                  <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Network size={16} /> DNS Servers
                  </span>
                  <span className="info-value" style={{ textAlign: 'right' }}>
                    {(wan.dnsServers && wan.dnsServers.length > 0
                      ? wan.dnsServers
                      : [wan.dns1, wan.dns2, wan.dns3].filter((s): s is string => !!s && s !== '0.0.0.0' && s !== '::')
                    ).join(', ')}
                  </span>
                </div>
              )}
              {wan.ipv6Address && (
                <div className="info-row">
                  <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Globe size={16} /> IPv6 Address
                  </span>
                  <span className="info-value" style={{ textAlign: 'right' }}>
                    {wan.ipv6Address}
                  </span>
                </div>
              )}
              {wan.macAddress && (
                <div className="info-row">
                  <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Tag size={16} /> WAN MAC
                  </span>
                  <span className="info-value">{wan.macAddress}</span>
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              WAN details are not reported by this router firmware.
            </p>
          )}
        </div>

        {/* System Health */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Activity size={20} />
              System Health
            </div>
            <span className={health ? 'badge-green' : 'badge-blue'}>{health ? 'Live' : 'Unavailable'}</span>
          </div>

          {health ? (
            <div>
              <div className="info-list">
                <div className="info-row">
                  <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock size={16} /> Uptime
                  </span>
                  <span className="info-value">{formatUptime(health.uptimeSeconds)}</span>
                </div>
              </div>
              <ResourceBar label="CPU Load" value={health.cpuLoadPercent} />
              <ResourceBar label="Memory Load" value={health.memoryLoadPercent} />
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              System statistics are not exposed by this router firmware.
            </p>
          )}
        </div>
      </div>

      {/* Grid: Router Details & Firmware Cards */}
      <div className="grid-2">
        {/* Router Hardware Information */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Layers size={20} />
              Router System Information
            </div>
            <span className="badge-blue">Hardware Details</span>
          </div>

          <div className="info-list">
            <div className="info-row">
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Tag size={16} /> Model Number
              </span>
              <span className="info-value">{info?.modelNumber || (loadingInfo ? 'Loading...' : 'N/A')}</span>
            </div>
            <div className="info-row">
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Hash size={16} /> Serial Number
              </span>
              <span className="info-value">{info?.serialNumber || (loadingInfo ? 'Loading...' : 'N/A')}</span>
            </div>
            <div className="info-row">
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={16} /> Hardware Revision
              </span>
              <span className="info-value">{info?.hardwareVersion || (loadingInfo ? 'Loading...' : 'N/A')}</span>
            </div>
            <div className="info-row">
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={16} /> Current Firmware Version
              </span>
              <span className="info-value" style={{ color: 'var(--accent-cyan)' }}>
                {info?.firmwareVersion || (loadingInfo ? 'Loading...' : 'N/A')}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={16} /> Firmware Release Date
              </span>
              <span className="info-value">{info?.firmwareDate || (loadingInfo ? 'Loading...' : 'N/A')}</span>
            </div>
            <div className="info-row">
              <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Hash size={16} /> Router MAC Address
              </span>
              <span className="info-value">{info?.macAddress || (loadingInfo ? 'Loading...' : 'N/A')}</span>
            </div>
          </div>
        </div>

        {/* Firmware Update Center */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="card-header">
              <div className="card-title">
                <Download size={20} />
                Firmware Update Center
              </div>
              {updateAvailable ? (
                <span className="badge-amber">Update Available</span>
              ) : (
                <span className="badge-green">Up to Date</span>
              )}
            </div>

            <div style={fwBoxStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                {updateAvailable ? (
                  <ShieldAlert size={24} color="#f59e0b" style={{ flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={24} color="#10b981" style={{ flexShrink: 0 }} />
                )}
                <div>
                  <h4 style={{ fontSize: '0.98rem', fontWeight: '600', marginBottom: '4px' }}>
                    {updateAvailable ? 'New Router Firmware Available!' : 'Your Firmware is Latest'}
                  </h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {updateAvailable
                      ? `Version ${fwData?.newVersion}${fwData?.newDate ? ` released on ${fwData.newDate}` : ''} is ready for installation.`
                      : 'The router automatically checks for Linksys security patches and features.'}
                  </p>
                </div>
              </div>
            </div>

            {fwData?.pendingOperation && (
              <div style={{ marginBottom: '16px', background: 'var(--bg-input)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: fwData.progressPercent > 0 ? '8px' : '0' }}>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>
                    Active Operation: {fwData.pendingOperation}
                  </span>
                  {fwData.progressPercent > 0 && (
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {fwData.progressPercent}%
                    </span>
                  )}
                </div>
                {fwData.progressPercent > 0 && (
                  <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-full)', height: '6px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${fwData.progressPercent}%`, background: 'var(--accent-cyan)', transition: 'width 0.3s ease' }} />
                  </div>
                )}
              </div>
            )}

            {fwData?.lastCheck && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '16px' }}>
                Last checked for updates: {fwData.lastCheck}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <button
              className="btn btn-secondary"
              onClick={handleCheckFirmware}
              disabled={checkingFw}
              style={{ flex: 1 }}
            >
              <RefreshCw size={16} className={checkingFw ? 'spin' : ''} />
              {checkingFw ? 'Checking...' : 'Check for Updates'}
            </button>

            {updateAvailable && (
              <button
                className="btn btn-primary"
                onClick={() => setShowFwConfirm(true)}
                style={{ flex: 1 }}
              >
                <Download size={16} />
                Install Update Now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
