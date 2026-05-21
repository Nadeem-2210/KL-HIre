import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const PendingApproval = () => {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleCheckStatus = async () => {
    setChecking(true);
    setMessage('');
    setError('');
    try {
      const { data } = await api.get('/auth/me');
      if (data.user && data.user.status === 'approved') {
        setMessage('Your account has been approved! Redirecting to dashboard...');
        // Update user object in local storage
        localStorage.setItem('user_candidate', JSON.stringify(data.user));
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 1500);
      } else {
        setError('Your account is still waiting for admin approval.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Your account is still waiting for admin approval.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 480, textAlign: 'center' }}>
        {/* Animated Hourglass/Clock Icon */}
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(245, 158, 11, 0.15)',
          border: '2px solid rgba(245, 158, 11, 0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, margin: '0 auto 24px',
          animation: 'pulse 2s infinite'
        }}>
          ⏳
        </div>

        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 8, color: 'var(--text-primary)' }}>
          Account Pending Approval
        </h1>
        
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 24 }}>
          Thank you for registering! Your candidate account has been created. 
          However, to maintain a secure assessment environment, all new accounts require administrator approval.
        </p>

        {error && (
          <div className="alert alert-warning" style={{ marginBottom: 20, textAlign: 'left' }}>
            <span>⚠</span> {error}
          </div>
        )}

        {message && (
          <div className="alert alert-success" style={{ marginBottom: 20, textAlign: 'left' }}>
            <span>✓</span> {message}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            className="btn btn-primary"
            onClick={handleCheckStatus}
            disabled={checking}
            style={{ padding: '12px 0', fontSize: '0.95rem', width: '100%' }}
          >
            {checking ? '⟳ Refreshing Status...' : 'Check Approval Status'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={logout}
            style={{ padding: '12px 0', fontSize: '0.95rem', width: '100%' }}
          >
            Sign Out
          </button>
        </div>

        <div style={{ marginTop: 24, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Assigned email: <strong style={{ color: 'var(--text-secondary)' }}>{user?.email || 'N/A'}</strong>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
