import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { AlertTriangle, Power, RefreshCw, CheckCircle, WifiOff } from 'lucide-react';

interface RebootModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRebootComplete?: () => void;
  onNotify: (msg: string, type: 'info' | 'success' | 'error') => void;
}

const REBOOT_ESTIMATE_SECONDS = 90;
const POLL_START_ELAPSED_SECONDS = 20;

export const RebootModal: React.FC<RebootModalProps> = ({ isOpen, onClose, onRebootComplete, onNotify }) => {
  const [rebooting, setRebooting] = useState(false);
  const [countdown, setCountdown] = useState(REBOOT_ESTIMATE_SECONDS);
  const [complete, setComplete] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Countdown timer — runs once per reboot session rather than recreating each second.
  useEffect(() => {
    if (!rebooting || complete || reconnecting) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setReconnecting(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [rebooting, complete, reconnecting]);

  const pollingActive = rebooting && !complete && countdown <= REBOOT_ESTIMATE_SECONDS - POLL_START_ELAPSED_SECONDS;

  // Reconnect polling — begins pinging early after 20s so fast reboots
  // don't force the user to wait out the entire 90s countdown unnecessarily.
  // Uses sequential polling (setTimeout after response) rather than setInterval to guarantee
  // no overlapping in-flight ping requests.
  useEffect(() => {
    if (!pollingActive) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const connected = await api.pingRouter();
        if (connected && !cancelled) {
          setReconnecting(false);
          setComplete(true);
          return;
        }
      } catch {
        // Router still rebooting, keep waiting
      }
      if (!cancelled) {
        timerId = setTimeout(poll, 3000);
      }
    };

    // First ping attempt
    timerId = setTimeout(poll, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [pollingActive]);

  // Safety timeout once the countdown finishes and we enter explicit reconnecting state.
  useEffect(() => {
    if (!rebooting || complete || !reconnecting) return;

    const maxWait = setTimeout(() => {
      setReconnecting(false);
      setComplete(true);
    }, 60000);

    return () => clearTimeout(maxWait);
  }, [rebooting, complete, reconnecting]);

  useEffect(() => {
    if (!isOpen || rebooting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, rebooting, onClose]);

  if (!isOpen) return null;

  const handleStartReboot = async () => {
    try {
      await api.rebootRouter();
      setRebooting(true);
      setCountdown(REBOOT_ESTIMATE_SECONDS);
      setComplete(false);
      setReconnecting(false);
      onNotify('Reboot command sent to router.', 'info');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to send reboot signal to router', 'error');
    }
  };

  const handleFinish = () => {
    setRebooting(false);
    setComplete(false);
    setCountdown(REBOOT_ESTIMATE_SECONDS);
    setReconnecting(false);
    onRebootComplete?.();
    onClose();
  };

  const progressPercent = Math.round(((REBOOT_ESTIMATE_SECONDS - countdown) / REBOOT_ESTIMATE_SECONDS) * 100);
  const progressStyle: React.CSSProperties = {
    height: '100%',
    width: progressPercent + '%',
    background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-cyan))',
    transition: 'width 1s linear'
  };

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!rebooting) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Router Reboot"
        onClick={(e) => e.stopPropagation()}
      >
        {!rebooting ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444'
              }}>
                <Power size={28} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '700' }}>Confirm Router Reboot</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Linksys JNAP Reboot Signal</p>
              </div>
            </div>

            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#fbbf24', fontWeight: '600', marginBottom: '6px' }}>
                <AlertTriangle size={18} /> Network Interruption Notice
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Rebooting will temporarily disconnect all Wi-Fi and Ethernet devices. The router usually takes 60–90 seconds to come back online.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleStartReboot}>
                <Power size={16} /> Yes, Reboot Now
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            {!complete ? (
              <div>
                <div style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: reconnecting ? 'rgba(245, 158, 11, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                  border: reconnecting ? '2px solid var(--status-warning)' : '2px solid var(--accent-blue)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px auto',
                  color: reconnecting ? 'var(--status-warning)' : 'var(--accent-blue)'
                }}>
                  {reconnecting ? <WifiOff size={36} /> : <RefreshCw size={36} className="spin" />}
                </div>

                <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '8px' }}>
                  {reconnecting ? 'Waiting for Router...' : 'Rebooting Router...'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
                  {reconnecting
                    ? 'Countdown complete. Polling router for connectivity...'
                    : 'Please wait while the router restarts system services and refreshes network connections.'}
                </p>

                {/* Progress Bar & Counter */}
                {!reconnecting && (
                  <>
                    <div style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius-full)', height: '10px', overflow: 'hidden', marginBottom: '14px', border: '1px solid var(--border-color)' }}>
                      <div style={progressStyle} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>
                      <span>Elapsed: {90 - countdown}s</span>
                      <span>Estimated: ~{countdown}s remaining</span>
                    </div>
                  </>
                )}

                {reconnecting && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    <RefreshCw size={14} className="spin" />
                    <span>Checking every 3 seconds...</span>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '2px solid var(--status-online)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px auto',
                  color: 'var(--status-online)'
                }}>
                  <CheckCircle size={36} />
                </div>

                <h3 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '8px' }}>
                  Reboot Cycle Complete!
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
                  The router should now be fully back online and ready for connections.
                </p>

                <button className="btn btn-primary" onClick={handleFinish} style={{ width: '100%' }}>
                  Back to Dashboard
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
