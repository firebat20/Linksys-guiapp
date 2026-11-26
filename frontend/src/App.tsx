import React, { useState, useCallback, useEffect, useRef } from 'react';
import { LoginCard } from './components/LoginCard';
import { OverviewTab } from './components/OverviewTab';
import { DevicesTab } from './components/DevicesTab';
import { ReservationsTab } from './components/ReservationsTab';
import type { ReservationPrefill } from './components/ReservationsTab';
import { SecurityTab } from './components/SecurityTab';
import { RebootModal } from './components/RebootModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { api } from './services/api';
import type { DeviceData } from './services/api';
import { Router, Server, Wifi, Shield, LogOut, CheckCircle2, AlertCircle, Info, X, Network } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export const App: React.FC = () => {
  const [connectedHost, setConnectedHost] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'devices' | 'reservations' | 'security'>('overview');
  const [isRebootModalOpen, setIsRebootModalOpen] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reservationPrefill, setReservationPrefill] = useState<ReservationPrefill | null>(null);

  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // Restore session if backend is already connected (e.g. after UI refresh)
    api.getConnectedHost()
      .then((host) => {
        if (host) setConnectedHost(host);
      })
      .catch(() => {});

    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: 'info' | 'success' | 'error') => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    const timer = setTimeout(() => {
      toastTimersRef.current.delete(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
    toastTimersRef.current.set(id, timer);
  }, []);

  const handleConnectSuccess = (host: string) => {
    setConnectedHost(host);
    addToast(`Successfully connected to router at ${host}`, 'success');
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnect();
    } catch {
      // Ignore disconnect errors, always clear local state
    }
    setConnectedHost(null);
    setActiveTab('overview');
    setReservationPrefill(null);
    addToast('Disconnected from router', 'info');
  };

  const handleReserveIP = (device: DeviceData) => {
    setReservationPrefill({
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
      description: device.friendlyName,
    });
    setActiveTab('reservations');
  };

  const getToastBorder = (type: string) => {
    if (type === 'success') return '1px solid rgba(16, 185, 129, 0.4)';
    if (type === 'error') return '1px solid rgba(239, 68, 68, 0.4)';
    return '1px solid rgba(59, 130, 246, 0.4)';
  };

  return (
    <ErrorBoundary>
    <div className="app-container">
      {/* Toast Notification Container */}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 1000,
          maxWidth: '380px',
          width: '100%'
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-secondary)',
              border: getToastBorder(t.type),
              color: 'var(--text-primary)',
              boxShadow: 'var(--shadow-card)',
              fontSize: '0.86rem',
              animation: 'slideUp 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {t.type === 'success' && <CheckCircle2 size={18} color="#10b981" />}
              {t.type === 'error' && <AlertCircle size={18} color="#ef4444" />}
              {t.type === 'info' && <Info size={18} color="#3b82f6" />}
              <span>{t.message}</span>
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              aria-label="Dismiss notification"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Main App Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">
            <Router size={22} />
          </div>
          <div>
            <div className="brand-title">Linksys Manager</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Desktop GUI v1.0</div>
          </div>
        </div>

        {connectedHost && (
          <div className="nav-tabs">
            <button
              className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Server size={16} /> Overview
            </button>
            <button
              className={`tab-btn ${activeTab === 'devices' ? 'active' : ''}`}
              onClick={() => setActiveTab('devices')}
            >
              <Wifi size={16} /> Connected Devices
            </button>
            <button
              className={`tab-btn ${activeTab === 'reservations' ? 'active' : ''}`}
              onClick={() => setActiveTab('reservations')}
            >
              <Network size={16} /> Reservations
            </button>
            <button
              className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`}
              onClick={() => setActiveTab('security')}
            >
              <Shield size={16} /> Security
            </button>
          </div>
        )}

        <div className="header-status">
          {connectedHost ? (
            <>
              <div className="status-badge">
                <span className="status-dot online" />
                <span>Connected: <strong style={{ color: 'var(--text-primary)' }}>{connectedHost}</strong></span>
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleDisconnect}
                style={{ padding: '6px 12px', fontSize: '0.82rem' }}
              >
                <LogOut size={14} /> Disconnect
              </button>
            </>
          ) : (
            <div className="status-badge">
              <span className="status-dot offline" />
              <span>Not Connected</span>
            </div>
          )}
        </div>
      </header>

      {/* Main View Area */}
      <main className="main-content">
        {!connectedHost ? (
          <LoginCard onSuccess={handleConnectSuccess} />
        ) : (
          <React.Fragment key={dashboardKey}>
            {activeTab === 'overview' && (
              <OverviewTab
                onOpenRebootModal={() => setIsRebootModalOpen(true)}
                onNotify={addToast}
              />
            )}
            {activeTab === 'devices' && <DevicesTab onNotify={addToast} onReserveIP={handleReserveIP} />}
            {activeTab === 'reservations' && (
              <ReservationsTab
                onNotify={addToast}
                prefill={reservationPrefill}
                onPrefillConsumed={() => setReservationPrefill(null)}
              />
            )}
            {activeTab === 'security' && <SecurityTab onNotify={addToast} connectedHost={connectedHost} />}
          </React.Fragment>
        )}
      </main>

      {/* Reboot Modal */}
      <RebootModal
        isOpen={isRebootModalOpen}
        onClose={() => setIsRebootModalOpen(false)}
        onRebootComplete={() => setDashboardKey((prev) => prev + 1)}
        onNotify={addToast}
      />
    </div>
    </ErrorBoundary>
  );
};

export default App;
