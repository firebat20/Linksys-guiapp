import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, LANSettingsData, DHCPReservationData } from '../services/api';
import { ConfirmModal } from './ConfirmModal';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { ipv4ToNumber, numberToIPv4, SortDirection } from '../utils/network';
import { SortIndicator } from './SortIndicator';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  WifiOff,
  X,
  Copy,
  Check,
  Download,
  Sparkles,
} from 'lucide-react';

export interface ReservationPrefill {
  macAddress: string;
  ipAddress: string;
  description: string;
}

interface ReservationsTabProps {
  onNotify: (msg: string, type: 'info' | 'success' | 'error') => void;
  prefill?: ReservationPrefill | null;
  onPrefillConsumed?: () => void;
}

const macPattern = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

type ReservationSortField = 'desc' | 'ip' | 'mac';

export const ReservationsTab: React.FC<ReservationsTabProps> = ({ onNotify, prefill, onPrefillConsumed }) => {
  const [settings, setSettings] = useState<LANSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<ReservationSortField>('ip');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { copiedId, copyToClipboard } = useCopyToClipboard();
  const mountedRef = useRef(true);

  const [editingMAC, setEditingMAC] = useState<string | null>(null);
  const [pendingPrefillMAC, setPendingPrefillMAC] = useState<string | null>(null);
  const [macAddress, setMacAddress] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [description, setDescription] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DHCPReservationData | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDHCPReservations();
      if (!mountedRef.current) return;
      setSettings(data);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to load DHCP reservations', 'error');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [onNotify]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  const resetForm = useCallback(() => {
    setEditingMAC(null);
    setMacAddress('');
    setIpAddress('');
    setDescription('');
  }, []);

  useEffect(() => {
    if (!prefill) return;
    setEditingMAC(null);
    setMacAddress(prefill.macAddress || '');
    setIpAddress(prefill.ipAddress || '');
    setDescription(prefill.description || '');
    setPendingPrefillMAC(prefill.macAddress || null);
    onPrefillConsumed?.();
  }, [prefill, onPrefillConsumed]);

  useEffect(() => {
    if (!pendingPrefillMAC || !settings) return;
    const existing = (settings.reservations ?? []).find((reservation) =>
      reservation.macAddress.toLowerCase() === pendingPrefillMAC.toLowerCase()
    );
    if (existing) {
      setEditingMAC(existing.macAddress);
    }
    setPendingPrefillMAC(null);
  }, [pendingPrefillMAC, settings]);

  const reservations = useMemo(() => settings?.reservations ?? [], [settings]);

  const handleSort = (field: ReservationSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return reservations;
    return reservations.filter(
      (reservation) =>
        reservation.macAddress.toLowerCase().includes(query) ||
        reservation.ipAddress.toLowerCase().includes(query) ||
        reservation.description.toLowerCase().includes(query)
    );
  }, [reservations, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'desc':
          comparison = (a.description || '').localeCompare(b.description || '', undefined, { sensitivity: 'base' });
          break;
        case 'ip': {
          const numA = ipv4ToNumber(a.ipAddress) ?? 0;
          const numB = ipv4ToNumber(b.ipAddress) ?? 0;
          comparison = numA - numB;
          break;
        }
        case 'mac':
          comparison = a.macAddress.localeCompare(b.macAddress);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filtered, sortField, sortDirection]);

  const handleEdit = (reservation: DHCPReservationData) => {
    setEditingMAC(reservation.macAddress);
    setMacAddress(reservation.macAddress);
    setIpAddress(reservation.ipAddress);
    setDescription(reservation.description);
  };

  const handleSuggestNextIP = () => {
    if (!settings || !settings.isDHCPEnabled) {
      onNotify('DHCP pool is not active or available', 'error');
      return;
    }
    const first = ipv4ToNumber(settings.dhcpFirstIPAddress);
    const last = ipv4ToNumber(settings.dhcpLastIPAddress);
    if (first === null || last === null) return;

    const reservedNumbers = new Set(
      (settings.reservations ?? [])
        .map((r) => ipv4ToNumber(r.ipAddress))
        .filter((n): n is number => n !== null)
    );
    const routerIPNum = ipv4ToNumber(settings.ipAddress);
    if (routerIPNum !== null) reservedNumbers.add(routerIPNum);

    for (let current = first; current <= last; current++) {
      if (!reservedNumbers.has(current)) {
        const suggested = numberToIPv4(current);
        setIpAddress(suggested);
        onNotify(`Suggested next free IP: ${suggested}`, 'info');
        return;
      }
    }
    onNotify('No available unreserved addresses found inside the DHCP pool', 'error');
  };

  const handleExportBackup = () => {
    if (!settings || !settings.reservations || settings.reservations.length === 0) {
      onNotify('No reservations available to export', 'error');
      return;
    }
    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      routerLAN: settings.ipAddress,
      dhcpPool: `${settings.dhcpFirstIPAddress} - ${settings.dhcpLastIPAddress}`,
      reservations: settings.reservations,
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linksys-dhcp-reservations-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify(`Exported ${settings.reservations.length} reservations to backup file`, 'success');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const mac = macAddress.trim();
    const ip = ipAddress.trim();
    const desc = description.trim();

    if (!macPattern.test(mac)) {
      onNotify('Enter a valid MAC address, for example AA:BB:CC:DD:EE:FF', 'error');
      return;
    }
    const normalizedMAC = mac.toUpperCase();
    if (normalizedMAC === '00:00:00:00:00:00' || normalizedMAC === 'FF:FF:FF:FF:FF:FF') {
      onNotify(`Cannot reserve special MAC address ${normalizedMAC}`, 'error');
      return;
    }

    const numericIP = ipv4ToNumber(ip);
    if (numericIP === null) {
      onNotify('Enter a valid IPv4 address', 'error');
      return;
    }

    const routerIP = settings ? ipv4ToNumber(settings.ipAddress) : null;
    if (settings && routerIP !== null && numericIP === routerIP) {
      onNotify(`Cannot reserve the router's own IP address (${settings.ipAddress})`, 'error');
      return;
    }

    const firstIP = settings ? ipv4ToNumber(settings.dhcpFirstIPAddress) : null;
    const lastIP = settings ? ipv4ToNumber(settings.dhcpLastIPAddress) : null;
    if (settings?.isDHCPEnabled && firstIP !== null && lastIP !== null) {
      if (numericIP < firstIP || numericIP > lastIP) {
        onNotify(
          `Choose an address inside the DHCP pool (${settings.dhcpFirstIPAddress} – ${settings.dhcpLastIPAddress})`,
          'error'
        );
        return;
      }
    }

    const maxDescription = settings?.maxReservationDescriptionLength || 63;
    if ([...desc].length > maxDescription) {
      onNotify(`Description must be ${maxDescription} characters or fewer`, 'error');
      return;
    }

    setSaving(true);
    try {
      const updated = editingMAC
        ? await api.updateDHCPReservation(editingMAC, mac, ip, desc)
        : await api.addDHCPReservation(mac, ip, desc);
      setSettings(updated);
      onNotify(
        editingMAC ? `Reservation for ${mac} updated` : `Reserved ${ip} for ${mac}`,
        'success'
      );
      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to save the reservation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setSaving(true);
    try {
      const updated = await api.deleteDHCPReservation(target.macAddress);
      setSettings(updated);
      onNotify(`Reservation for ${target.macAddress} removed`, 'success');
      if (editingMAC && editingMAC.toLowerCase() === target.macAddress.toLowerCase()) {
        resetForm();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to delete the reservation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderSortIndicator = (field: ReservationSortField) => (
    <SortIndicator active={sortField === field} direction={sortDirection} />
  );

  const poolLabel = settings
    ? settings.isDHCPEnabled
      ? `${settings.dhcpFirstIPAddress} – ${settings.dhcpLastIPAddress}`
      : 'DHCP is disabled'
    : '—';

  return (
    <div className="grid-2">
      <div className="card" style={{ gridColumn: 'span 2' }}>
        <div className="card-header">
          <div>
            <div className="card-title" style={{ fontSize: '1.2rem' }}>
              <Network size={22} />
              DHCP Reservations
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '4px' }}>
              Assign fixed IP addresses so devices always receive the same address from the router.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-secondary"
              onClick={handleExportBackup}
              disabled={reservations.length === 0}
              title="Export all current reservations to a JSON backup file"
            >
              <Download size={15} /> Backup
            </button>
            <button className="btn btn-secondary" onClick={fetchReservations} disabled={loading || saving}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            marginBottom: '18px',
          }}
        >
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Router LAN address</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: '600', marginTop: '2px' }}>
              {settings ? `${settings.ipAddress}/${settings.networkPrefixLength}` : '—'}
            </div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>DHCP pool</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: '600', marginTop: '2px' }}>{poolLabel}</div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Lease time</div>
            <div style={{ fontWeight: '600', marginTop: '2px' }}>
              {settings?.leaseMinutes ? `${settings.leaseMinutes} minutes` : '—'}
            </div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Reserved addresses</div>
            <div style={{ fontWeight: '600', marginTop: '2px' }}>{reservations.length}</div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            color: '#fbbf24',
            fontSize: '0.84rem',
          }}
        >
          <WifiOff size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>
            Saving a reservation restarts LAN/DHCP services on the router. Wired and wireless devices may
            briefly lose connectivity. The router web interface may be unavailable for a few seconds.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div className="input-wrapper" style={{ flex: 1, minWidth: '240px' }}>
            <Search className="input-icon" size={18} />
            <input
              type="text"
              className="input-control"
              placeholder="Filter by description, IP address, or MAC..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={search ? { paddingRight: '38px' } : undefined}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear filter"
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
        </div>

        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('desc')} style={{ cursor: 'pointer' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Description {renderSortIndicator('desc')}
                  </span>
                </th>
                <th onClick={() => handleSort('mac')} style={{ cursor: 'pointer' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    MAC Address {renderSortIndicator('mac')}
                  </span>
                </th>
                <th onClick={() => handleSort('ip')} style={{ cursor: 'pointer' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Reserved IP {renderSortIndicator('ip')}
                  </span>
                </th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    {loading
                      ? 'Loading reservations...'
                      : search.trim()
                      ? `No reservations matching "${search}"`
                      : 'No IP reservations yet. Use the form below or the Reserve IP action on a connected device.'}
                  </td>
                </tr>
              ) : (
                sorted.map((reservation, index) => {
                  const isEditing = editingMAC?.toLowerCase() === reservation.macAddress.toLowerCase();
                  const macCopyId = `res-mac-${index}`;
                  const ipCopyId = `res-ip-${index}`;

                  return (
                    <tr
                      key={reservation.macAddress}
                      style={isEditing ? { background: 'rgba(59, 130, 246, 0.08)' } : undefined}
                    >
                      <td style={{ fontWeight: '500' }}>{reservation.description || '—'}</td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            {reservation.macAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(reservation.macAddress, macCopyId)}
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
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '600' }}>
                            {reservation.ipAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(reservation.ipAddress, ipCopyId)}
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
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => handleEdit(reservation)}
                            disabled={saving}
                          >
                            <Pencil size={14} /> Edit
                          </button>
                          <button
                            className="btn btn-danger"
                            style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                            onClick={() => setDeleteTarget(reservation)}
                            disabled={saving}
                          >
                            <Trash2 size={14} /> Delete
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

      <div className="card" style={{ gridColumn: 'span 2' }}>
        <div className="card-header">
          <div className="card-title">
            {editingMAC ? <Pencil size={20} /> : <Plus size={20} />}
            {editingMAC ? 'Edit Reservation' : 'Add Reservation'}
          </div>
          {editingMAC && <span className="badge-blue">Editing {editingMAC}</span>}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="res-mac">MAC Address</label>
              <div className="input-wrapper">
                <Network className="input-icon" size={18} />
                <input
                  id="res-mac"
                  type="text"
                  className="input-control"
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={macAddress}
                  onChange={(event) => setMacAddress(event.target.value)}
                  disabled={saving}
                  spellCheck={false}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" htmlFor="res-ip">IP Address</label>
                {settings?.isDHCPEnabled && !editingMAC && (
                  <button
                    type="button"
                    onClick={handleSuggestNextIP}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-blue)',
                      cursor: 'pointer',
                      fontSize: '0.76rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: 0,
                      fontWeight: '500',
                    }}
                  >
                    <Sparkles size={12} /> Suggest Next IP
                  </button>
                )}
              </div>
              <div className="input-wrapper">
                <CheckCircle2 className="input-icon" size={18} />
                <input
                  id="res-ip"
                  type="text"
                  className="input-control"
                  placeholder={settings?.dhcpFirstIPAddress || '192.168.1.100'}
                  value={ipAddress}
                  onChange={(event) => setIpAddress(event.target.value)}
                  disabled={saving}
                  spellCheck={false}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="res-desc">
                Description (optional, max {settings?.maxReservationDescriptionLength || 63})
              </label>
              <div className="input-wrapper">
                <Info className="input-icon" size={18} />
                <input
                  id="res-desc"
                  type="text"
                  className="input-control"
                  placeholder="Living room TV"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={saving}
                  maxLength={settings?.maxReservationDescriptionLength || 63}
                />
              </div>
            </div>
          </div>

          {settings?.isDHCPEnabled && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>
              The address must be inside the DHCP pool ({settings.dhcpFirstIPAddress} –{' '}
              {settings.dhcpLastIPAddress}). Use an unused address to avoid conflicts.
            </p>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
            {editingMAC && (
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
                <X size={16} /> Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !macAddress.trim() || !ipAddress.trim()}
            >
              {saving ? (
                'Saving...'
              ) : (
                <>
                  <Save size={16} /> {editingMAC ? 'Save Changes' : 'Add Reservation'}
                </>
              )}
            </button>
          </div>
        </form>

        {settings && !settings.isDHCPEnabled && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              marginTop: '16px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              fontSize: '0.84rem',
              color: '#fca5a5',
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>DHCP is disabled on this router. Reservations will have no effect until DHCP is enabled.</span>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="Delete reservation?"
        description={
          deleteTarget
            ? `Remove the fixed IP address ${deleteTarget.ipAddress} for ${deleteTarget.macAddress}?`
            : ''
        }
        warningText="Saving this change restarts LAN/DHCP services and may briefly interrupt network connectivity."
        confirmLabel="Delete Reservation"
        confirmVariant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
