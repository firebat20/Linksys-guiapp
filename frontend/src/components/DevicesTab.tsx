import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DeviceData, api } from '../services/api';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { ipv4ToNumber, SortDirection } from '../utils/network';
import { SortIndicator } from './SortIndicator';
import {
  Monitor,
  Smartphone,
  Tv,
  HardDrive,
  Search,
  RefreshCw,
  Wifi,
  Radio,
  Cpu,
  Pin,
  Copy,
  Check,
  X,
} from 'lucide-react';

interface DevicesTabProps {
  onNotify: (msg: string, type: 'info' | 'success' | 'error') => void;
  onReserveIP?: (device: DeviceData) => void;
}

type SortField = 'name' | 'ip' | 'mac' | 'connType' | 'os' | 'status';

export const DevicesTab: React.FC<DevicesTabProps> = ({ onNotify, onReserveIP }) => {
  const [devices, setDevices] = useState<DeviceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline'>('all');
  const [sortField, setSortField] = useState<SortField>('status');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const { copiedId, copyToClipboard } = useCopyToClipboard();
  const mountedRef = useRef(true);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchDevices = useCallback(async (isBackground = false) => {
    const seq = ++fetchSeqRef.current;
    if (!isBackground) setLoading(true);
    try {
      const data = await api.getConnectedDevices();
      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      setDevices(data || []);
    } catch (err: unknown) {
      if (!mountedRef.current || seq !== fetchSeqRef.current) return;
      if (!isBackground) {
        const msg = err instanceof Error ? err.message : String(err);
        onNotify(msg || 'Failed to load connected devices', 'error');
      }
    } finally {
      if (!isBackground && mountedRef.current && seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [onNotify]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Auto-refresh interval (15s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchDevices(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchDevices]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'status' ? 'desc' : 'asc');
    }
  };

  const getDeviceIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('phone') || t.includes('mobile')) return <Smartphone size={18} color="var(--accent-blue)" />;
    if (t.includes('tv') || t.includes('television')) return <Tv size={18} color="var(--accent-purple)" />;
    if (t.includes('laptop') || t.includes('computer') || t.includes('mac')) return <Monitor size={18} color="var(--accent-cyan)" />;
    if (t.includes('iot') || t.includes('hub') || t.includes('raspb')) return <Cpu size={18} color="var(--accent-indigo)" />;
    return <HardDrive size={18} color="var(--text-secondary)" />;
  };

  const trimmedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      const matchesSearch =
        !trimmedSearch ||
        (d.friendlyName || '').toLowerCase().includes(trimmedSearch) ||
        (d.ipAddress || '').toLowerCase().includes(trimmedSearch) ||
        (d.macAddress || '').toLowerCase().includes(trimmedSearch) ||
        (d.os || '').toLowerCase().includes(trimmedSearch) ||
        (d.manufacturer || '').toLowerCase().includes(trimmedSearch) ||
        (d.model || '').toLowerCase().includes(trimmedSearch) ||
        (d.connectionType || '').toLowerCase().includes(trimmedSearch) ||
        (d.deviceType || '').toLowerCase().includes(trimmedSearch);

      if (filterStatus === 'online') return matchesSearch && d.isConnected;
      if (filterStatus === 'offline') return matchesSearch && !d.isConnected;
      return matchesSearch;
    });
  }, [devices, trimmedSearch, filterStatus]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = (a.friendlyName || '').localeCompare(b.friendlyName || '', undefined, { sensitivity: 'base' });
          break;
        case 'ip':
          comparison = (ipv4ToNumber(a.ipAddress || '') ?? 0) - (ipv4ToNumber(b.ipAddress || '') ?? 0);
          break;
        case 'mac':
          comparison = (a.macAddress || '').localeCompare(b.macAddress || '');
          break;
        case 'connType':
          comparison = (a.connectionType || '').localeCompare(b.connectionType || '');
          break;
        case 'os':
          comparison = (a.os || '').localeCompare(b.os || '');
          break;
        case 'status':
          if (a.isConnected !== b.isConnected) {
            comparison = a.isConnected ? 1 : -1;
          } else {
            comparison = (a.friendlyName || '').localeCompare(b.friendlyName || '', undefined, { sensitivity: 'base' });
          }
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filtered, sortField, sortDirection]);

  const { onlineCount, wifiCount, wiredCount } = useMemo(() => {
    let online = 0;
    let wifi = 0;
    let wired = 0;
    for (const d of devices) {
      if (!d.isConnected) continue;
      online++;
      const conn = (d.connectionType || '').toLowerCase();
      if (conn.includes('wireless')) wifi++;
      else if (conn.includes('ethernet') || conn.includes('wired')) wired++;
    }
    return { onlineCount: online, wifiCount: wifi, wiredCount: wired };
  }, [devices]);

  const renderSortIndicator = (field: SortField) => (
    <SortIndicator active={sortField === field} direction={sortDirection} />
  );

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontSize: '1.2rem' }}>
            <Radio size={22} />
            Connected Devices Inspector
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '4px' }}>
            {onlineCount} device{onlineCount === 1 ? '' : 's'} active ({wifiCount} Wi-Fi, {wiredCount} Wired) • {devices.length} total registered
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className={`btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '8px 12px', fontSize: '0.82rem' }}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Automatically poll router for device connection changes every 15 seconds"
          >
            <RefreshCw size={14} className={autoRefresh ? 'spin' : ''} />
            {autoRefresh ? 'Auto-refresh: On' : 'Auto-refresh: Off'}
          </button>
          <button className="btn btn-secondary" onClick={() => fetchDevices()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh List
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div className="input-wrapper" style={{ flex: 1, minWidth: '240px' }}>
          <Search className="input-icon" size={18} />
          <input
            type="text"
            className="input-control"
            placeholder="Search by device name, IP address, MAC, connection, manufacturer, or OS..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={search ? { paddingRight: '38px' } : undefined}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              style={{
                position: 'absolute',
                right: '10px',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="nav-tabs" style={{ background: 'var(--bg-input)' }}>
          <button
            className={`tab-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            All ({devices.length})
          </button>
          <button
            className={`tab-btn ${filterStatus === 'online' ? 'active' : ''}`}
            onClick={() => setFilterStatus('online')}
          >
            Online ({onlineCount})
          </button>
          <button
            className={`tab-btn ${filterStatus === 'offline' ? 'active' : ''}`}
            onClick={() => setFilterStatus('offline')}
          >
            Offline ({devices.length - onlineCount})
          </button>
        </div>
      </div>

      {/* Devices Table */}
      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  Device Name {renderSortIndicator('name')}
                </span>
              </th>
              <th onClick={() => handleSort('ip')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  IP Address {renderSortIndicator('ip')}
                </span>
              </th>
              <th onClick={() => handleSort('mac')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  MAC Address {renderSortIndicator('mac')}
                </span>
              </th>
              <th onClick={() => handleSort('connType')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  Connection {renderSortIndicator('connType')}
                </span>
              </th>
              <th onClick={() => handleSort('os')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  Operating System {renderSortIndicator('os')}
                </span>
              </th>
              <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  Status {renderSortIndicator('status')}
                </span>
              </th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  {loading
                    ? 'Scanning router network...'
                    : trimmedSearch
                    ? `No devices matching "${search}"`
                    : 'No devices found'}
                </td>
              </tr>
            ) : (
              sorted.map((device, index) => {
                const ipCopyId = `ip-${device.id || index}`;
                const macCopyId = `mac-${device.id || index}`;

                return (
                  <tr key={device.id || device.macAddress || device.ipAddress || `device-${index}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          padding: '8px',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          display: 'flex',
                          alignItems: 'center'
                        }}>
                          {getDeviceIcon(device.deviceType)}
                        </div>
                        <div>
                          <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                            {device.friendlyName}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {device.manufacturer ? `${device.manufacturer} ${device.model}`.trim() : device.deviceType}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {device.ipAddress ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '500' }}>
                            {device.ipAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(device.ipAddress, ipCopyId)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: copiedId === ipCopyId ? 'var(--status-online)' : 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                            title="Copy IP address"
                          >
                            {copiedId === ipCopyId ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {device.macAddress ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            {device.macAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(device.macAddress, macCopyId)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: copiedId === macCopyId ? 'var(--status-online)' : 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                            title="Copy MAC address"
                          >
                            {copiedId === macCopyId ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        <Wifi size={14} color="var(--accent-blue)" />
                        {device.connectionType}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {device.os || 'Unknown'}
                    </td>
                    <td>
                      {device.isConnected ? (
                        <span className="badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span className="status-dot online" /> Online
                        </span>
                      ) : (
                        <span className="badge-blue" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                          <span className="status-dot offline" /> Offline
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                          onClick={() => onReserveIP?.(device)}
                          disabled={!device.macAddress || !onReserveIP}
                          title={
                            device.macAddress
                              ? 'Create or edit a DHCP reservation for this device'
                              : 'This device has not reported a MAC address'
                          }
                        >
                          <Pin size={14} /> Reserve IP
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
