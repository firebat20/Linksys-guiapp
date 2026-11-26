import React, { useState, useEffect } from 'react';
import { Network, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Server, X } from 'lucide-react';
import { api } from '../services/api';
import {
  loadHostHistory,
  saveHostHistory,
  addToHostHistory,
  normalizeHostKey,
  getSavedPassword,
  savePassword,
  removeSavedPassword,
} from '../services/storage';

interface LoginCardProps {
  onSuccess: (host: string) => void;
}

export const LoginCard: React.FC<LoginCardProps> = ({ onSuccess }) => {
  const [host, setHost] = useState('192.168.1.1');
  const [password, setPassword] = useState('');
  const [savePasswordOption, setSavePasswordOption] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [historyHosts, setHistoryHosts] = useState<string[]>([]);

  useEffect(() => {
    const history = loadHostHistory();
    setHistoryHosts(history);
    const initialHost = history.length > 0 ? history[0] : '192.168.1.1';
    setHost(initialHost);

    const saved = getSavedPassword(initialHost);
    if (saved !== null) {
      setPassword(saved);
      setSavePasswordOption(true);
    }
  }, []);

  const handleHostChange = (newHost: string) => {
    const prevSaved = getSavedPassword(host);
    setHost(newHost);

    const nextSaved = getSavedPassword(newHost);
    if (nextSaved !== null) {
      setPassword(nextSaved);
      setSavePasswordOption(true);
    } else if (prevSaved !== null && password === prevSaved) {
      // Clear password if it was autofilled from the previous host
      setPassword('');
      setSavePasswordOption(false);
    }
  };

  const handleSelectHost = (selectedHost: string) => {
    setHost(selectedHost);
    const saved = getSavedPassword(selectedHost);
    if (saved !== null) {
      setPassword(saved);
      setSavePasswordOption(true);
    } else {
      setPassword('');
      setSavePasswordOption(false);
    }
  };

  const handleSavePasswordToggle = (checked: boolean) => {
    setSavePasswordOption(checked);
    if (!checked) {
      removeSavedPassword(host);
    }
  };

  const removeFromHistory = (hostToRemove: string) => {
    const updated = historyHosts.filter((h) => h !== hostToRemove);
    setHistoryHosts(updated);
    saveHostHistory(updated);
    removeSavedPassword(hostToRemove);
    if (normalizeHostKey(host) === normalizeHostKey(hostToRemove)) {
      setPassword('');
      setSavePasswordOption(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedHost = host.trim();
    if (!trimmedHost || !password) {
      setErrorMsg('Please provide both host/IP address and password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await api.connect(trimmedHost, password);
      if (res.success) {
        // Persist this host to history
        const updatedHistory = addToHostHistory(trimmedHost, historyHosts);
        setHistoryHosts(updatedHistory);
        saveHostHistory(updatedHistory);

        // Save or remove password based on checkbox
        if (savePasswordOption) {
          savePassword(trimmedHost, password);
        } else {
          removeSavedPassword(trimmedHost);
        }

        onSuccess(res.host);
      } else {
        setErrorMsg(res.message || 'Unable to authorize with Linksys router.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || 'Connection error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 120px)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '460px', padding: '36px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div className="brand-icon" style={{ width: '56px', height: '56px', margin: '0 auto 16px auto', borderRadius: '14px' }}>
            <Server size={28} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '6px' }}>Connect to Router</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Enter your Linksys Smart Wi-Fi router IP and admin credentials
          </p>
        </div>

        {errorMsg && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.85rem',
            marginBottom: '20px'
          }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-host">Router IP / Host</label>
            <div className="input-wrapper">
              <Network className="input-icon" size={18} />
              <input
                id="login-host"
                type="text"
                className="input-control"
                placeholder="192.168.1.1"
                value={host}
                onChange={(e) => handleHostChange(e.target.value)}
              />
            </div>
            {/* History pills */}
            {historyHosts.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {historyHosts.map((h) => {
                  const isActiveHost = normalizeHostKey(h) === normalizeHostKey(host);
                  return (
                  <div
                    key={h}
                    style={{
                      background: isActiveHost ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      border: isActiveHost ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-full)',
                      padding: '2px 4px 2px 10px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectHost(h)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: isActiveHost ? '#60a5fa' : 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'inherit',
                      }}
                    >
                      {h}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromHistory(h)}
                      aria-label={`Remove ${h} from history`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        opacity: 0.6,
                      }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label className="form-label" htmlFor="login-password">Admin Password</label>
            <div className="input-wrapper">
              <Lock className="input-icon" size={18} />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="input-control"
                placeholder="Admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: '42px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Save password option */}
          <div className="form-group" style={{ marginBottom: '18px' }}>
            <label
              htmlFor="save-password-checkbox"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                id="save-password-checkbox"
                type="checkbox"
                checked={savePasswordOption}
                onChange={(e) => handleSavePasswordToggle(e.target.checked)}
                style={{
                  accentColor: 'var(--accent-blue)',
                  width: '16px',
                  height: '16px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                }}
              />
              <span>Save password</span>
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '6px', padding: '13px' }}
          >
            {loading ? 'Connecting to Router...' : (
              <>
                Connect & Authenticate <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <ShieldCheck size={16} color="var(--accent-blue)" />
          <span>JNAP Protocol session (HTTP / HTTPS)</span>
        </div>
      </div>
    </div>
  );
};
