import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../services/api';
import { ConfirmModal } from './ConfirmModal';
import { ShieldCheck, Key, HelpCircle, Eye, EyeOff, Check } from 'lucide-react';
import { getSavedPassword, savePassword } from '../services/storage';

interface SecurityTabProps {
  onNotify: (msg: string, type: 'info' | 'success' | 'error') => void;
  connectedHost?: string | null;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({ onNotify, connectedHost }) => {
  const [hint, setHint] = useState<string>('');
  const [loadingHint, setLoadingHint] = useState(true);

  // Form states
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newHint, setNewHint] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchHint = useCallback(async () => {
    setLoadingHint(true);
    try {
      const res = await api.getPasswordHint();
      if (!mountedRef.current) return;
      setHint(res || 'No password hint configured.');
      setNewHint(res || '');
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to retrieve password hint', 'error');
    } finally {
      if (mountedRef.current) {
        setLoadingHint(false);
      }
    }
  }, [onNotify]);

  useEffect(() => {
    fetchHint();
  }, [fetchHint]);

  const passwordStrength = useMemo(() => {
    if (!newPassword) return null;
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (newPassword.length >= 12) score++;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;

    if (score <= 2) return { label: 'Weak', color: '#ef4444', percent: 30 };
    if (score <= 3) return { label: 'Moderate', color: '#f59e0b', percent: 65 };
    return { label: 'Strong', color: '#10b981', percent: 100 };
  }, [newPassword]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      onNotify('Please enter a new password', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify('New password and confirmation do not match', 'error');
      return;
    }
    if (newPassword.length < 8) {
      onNotify('Password should be at least 8 characters long', 'error');
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmChangePassword = async () => {
    setShowConfirm(false);
    setUpdating(true);
    try {
      await api.changeAdminPassword(newPassword, newHint);
      if (connectedHost && getSavedPassword(connectedHost) !== null) {
        savePassword(connectedHost, newPassword);
      }
      onNotify('Admin password updated successfully!', 'success');
      setNewPassword('');
      setConfirmPassword('');
      fetchHint();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg || 'Failed to update admin password', 'error');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="grid-2">
      {/* Password Hint Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <HelpCircle size={20} />
            Password Hint Inspector
          </div>
          <span className="badge-blue">Security</span>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>
          This hint is displayed on the local Linksys web portal if you forget the admin password.
        </p>

        <div style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <Key size={20} color="var(--accent-blue)" />
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Current Configured Hint</div>
            <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '2px' }}>
              {loadingHint ? 'Retrieving hint...' : (hint || 'No hint set')}
            </div>
          </div>
        </div>

        <div style={{ marginTop: '24px', padding: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', fontSize: '0.84rem', color: '#93c5fd' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', marginBottom: '4px' }}>
            <ShieldCheck size={16} /> Security Recommendation
          </div>
          Ensure your admin password uses a combination of uppercase letters, numbers, and special characters. Minimum length is 8 characters.
        </div>
      </div>

      {/* Change Password Form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Key size={20} />
            Update Admin Password
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="sec-new-password">New Admin Password</label>
            <div className="input-wrapper">
              <Key className="input-icon" size={18} />
              <input
                id="sec-new-password"
                type={showPassword ? 'text' : 'password'}
                className="input-control"
                placeholder="Enter new password (min. 8 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
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
            {passwordStrength && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '3px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Password Strength:</span>
                  <span style={{ color: passwordStrength.color, fontWeight: '600' }}>{passwordStrength.label}</span>
                </div>
                <div style={{ background: 'rgba(255, 255, 255, 0.08)', borderRadius: 'var(--radius-full)', height: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${passwordStrength.percent}%`, height: '100%', background: passwordStrength.color, transition: 'width 0.3s ease' }} />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="sec-confirm-password">Confirm New Password</label>
            <div className="input-wrapper">
              <Key className="input-icon" size={18} />
              <input
                id="sec-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                className="input-control"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ paddingRight: '42px' }}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="sec-password-hint">Password Hint (Optional)</label>
            <div className="input-wrapper">
              <HelpCircle className="input-icon" size={18} />
              <input
                id="sec-password-hint"
                type="text"
                className="input-control"
                placeholder="Enter a hint to help remember your password"
                value={newHint}
                onChange={(e) => setNewHint(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={updating || !newPassword}
            style={{ width: '100%', marginTop: '8px' }}
          >
            {updating ? 'Updating Password...' : (
              <>
                <Check size={18} /> Update Admin Password
              </>
            )}
          </button>
        </form>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        title="Change Router Admin Password"
        description="Are you sure you want to change the router administrator password? You will need this new password for all future administrative access."
        warningText="If you forget your password, you will need to perform a factory reset of the router."
        confirmLabel="Update Password"
        confirmVariant="primary"
        onConfirm={handleConfirmChangePassword}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
