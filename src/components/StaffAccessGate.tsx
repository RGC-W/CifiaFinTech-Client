import React, { useState } from 'react';
import {
  KeyRound,
  Landmark,
  Lock,
  LogOut,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import { STAFF_CONSTRAINTS, StaffUser } from '../types/microfinance';
import { setupBranchAdmin, verifyStaffCredentials } from '../services/ledgerService';

interface StaffAccessGateProps {
  ownerId: string;
  defaultEmail: string;
  defaultDisplayName: string;
  branchName: string;
  hasAdmin: boolean;
  staffCount: number;
  onUnlockStaff: (staff: StaffUser) => void;
  onSwitchToClient: () => void;
  onSignOut: () => void;
}

export const StaffAccessGate: React.FC<StaffAccessGateProps> = ({
  ownerId,
  defaultEmail,
  defaultDisplayName,
  branchName,
  hasAdmin,
  staffCount,
  onUnlockStaff,
  onSwitchToClient,
  onSignOut,
}) => {
  // Admin Setup State (when branch has no Admin yet)
  const [adminEmail, setAdminEmail] = useState(defaultEmail || '');
  const [adminUsername, setAdminUsername] = useState(
    (defaultDisplayName || 'admin').replace(/\s+/g, '.').toLowerCase().slice(0, 30),
  );
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');

  // Staff Login State (Admin or User Cat 1)
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatStaffError = (err: unknown, fallback: string): string => {
    if (!(err instanceof Error)) return fallback;
    try {
      const parsed = JSON.parse(err.message) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error;
      }
    } catch {
      // Plain error message
    }
    return err.message || fallback;
  };

  const handleInitAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (adminPassword !== adminConfirmPassword) {
      setError('Admin passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      const createdAdmin = await setupBranchAdmin({
        ownerId,
        email: adminEmail,
        username: adminUsername,
        password: adminPassword,
      });
      onUnlockStaff(createdAdmin);
    } catch (err) {
      setError(formatStaffError(err, 'Unable to initialize Branch Admin.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const staff = await verifyStaffCredentials({
        ownerId,
        identifier,
        password: loginPassword,
      });
      onUnlockStaff(staff);
    } catch (err) {
      setError(formatStaffError(err, 'Unable to verify staff credentials.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-4xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-800 text-white flex items-center justify-center shrink-0">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 font-display">Cifia Fintech</p>
            <p className="text-xs text-slate-500">{branchName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSwitchToClient}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Client App</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Auth Card */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
          {!hasAdmin ? (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-2">
                <ShieldCheck className="w-4 h-4" />
                <span>Step 1 · Sole Branch Admin Setup</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 font-display">
                Create the Branch Admin Account
              </h1>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Each microfinance branch has strictly <strong className="text-slate-900">one Admin</strong> with full control, unlimited withdrawal validation, and authorization to create User Cat 1 tellers.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800"
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleInitAdmin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="admin-setup-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Admin Email
                  </label>
                  <input
                    id="admin-setup-email"
                    type="email"
                    required
                    maxLength={STAFF_CONSTRAINTS.EMAIL_MAX}
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@branch.org"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div>
                  <label htmlFor="admin-setup-username" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Admin Username
                  </label>
                  <input
                    id="admin-setup-username"
                    type="text"
                    required
                    minLength={STAFF_CONSTRAINTS.USERNAME_MIN}
                    maxLength={STAFF_CONSTRAINTS.USERNAME_MAX}
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    placeholder="branch.admin"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="admin-setup-pass" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Admin Password
                    </label>
                    <input
                      id="admin-setup-pass"
                      type="password"
                      required
                      minLength={STAFF_CONSTRAINTS.PASSWORD_MIN}
                      maxLength={STAFF_CONSTRAINTS.PASSWORD_MAX}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <div>
                    <label htmlFor="admin-setup-confirm" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Confirm Password
                    </label>
                    <input
                      id="admin-setup-confirm"
                      type="password"
                      required
                      minLength={STAFF_CONSTRAINTS.PASSWORD_MIN}
                      maxLength={STAFF_CONSTRAINTS.PASSWORD_MAX}
                      value={adminConfirmPassword}
                      onChange={(e) => setAdminConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {isSubmitting ? 'Creating Branch Admin...' : 'Initialize Sole Admin & Enter Desk'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-2">
                <Lock className="w-4 h-4" />
                <span>Branch Operator Sign-In</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 font-display">
                Sign in with Staff Credentials
              </h1>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Enter your <strong className="text-slate-900">Admin</strong> or <strong className="text-slate-900">User Cat 1</strong> email/username and password to unlock the branch officer desk ({staffCount} registered staff {staffCount === 1 ? 'account' : 'accounts'}).
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800"
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleStaffLogin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="staff-login-id" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email or Username
                  </label>
                  <input
                    id="staff-login-id"
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="teller1@branch.org or teller1"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div>
                  <label htmlFor="staff-login-pass" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    id="staff-login-pass"
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter staff password"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{isSubmitting ? 'Verifying Credentials...' : 'Unlock Branch Desk'}</span>
                </button>
              </form>
            </>
          )}
        </section>

        {/* Right Authorization Matrix */}
        <aside className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-800 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 font-display">
                1. Admin · Strictly 1 Account
              </h2>
            </div>
            <ul className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
              <li>· Full control over customers, KYC, accounts, and branch settings</li>
              <li>· Unlimited cash withdrawal validation</li>
              <li>· Direct deletion of validated operations</li>
              <li>· Creates and manages unlimited User Cat 1 tellers</li>
              <li>· Approves or declines Cat 1 validation requests</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-700 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 font-display">
                2. User Cat 1 · Teller (1 to 1,000+)
              </h2>
            </div>
            <ul className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
              <li>· Basic client information only (sensitive KYC hidden)</li>
              <li>· Can create new accounts and process deposits</li>
              <li>· Direct withdrawals allowed from $1.00 to $350.00</li>
              <li>· Over $350.00 sends a validation message to Admin</li>
              <li>· Operation delete requests sent to Admin for validation</li>
              <li>· Daily Cash Report: Starting Cash − Cash Withdrawals + Deposits</li>
            </ul>
          </div>
        </aside>
      </main>

      <footer className="max-w-4xl w-full mx-auto text-center text-[11px] text-slate-500 py-2">
        Branch workstation secured under {defaultEmail}
      </footer>
    </div>
  );
};
