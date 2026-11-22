import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import { STAFF_CONSTRAINTS, StaffUser } from '../types/microfinance';
import {
  createCat1StaffUser,
  deleteCat1StaffUser,
  resetStaffPassword,
  updateStaffUserStatus,
} from '../services/ledgerService';
import { formatShortDate } from '../utils/currency';

interface StaffManagementViewProps {
  ownerId: string;
  staffUsers: StaffUser[];
  onNotify: (message: string) => void;
}

export const StaffManagementView: React.FC<StaffManagementViewProps> = ({
  ownerId,
  staffUsers,
  onNotify,
}) => {
  const adminUser = useMemo(
    () => staffUsers.find((s) => s.role === 'admin') || null,
    [staffUsers],
  );
  const cat1Users = useMemo(
    () =>
      staffUsers
        .filter((s) => s.role === 'cat1')
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
    [staffUsers],
  );

  // Create User Cat 1 form
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Search & actions
  const [search, setSearch] = useState('');
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filteredCat1 = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cat1Users;
    return cat1Users.filter(
      (s) => s.usernameLower.includes(q) || s.emailLower.includes(q),
    );
  }, [cat1Users, search]);

  const handleCreateCat1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);
    try {
      await createCat1StaffUser({
        ownerId,
        email,
        username,
        password,
      });
      onNotify(`Created User Cat 1 teller "${username.trim()}" (${email.trim()}).`);
      setEmail('');
      setUsername('');
      setPassword('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create User Cat 1 account.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleStatus = async (staff: StaffUser) => {
    setActionError(null);
    setBusyId(staff.id);
    try {
      const nextStatus = staff.status === 'active' ? 'disabled' : 'active';
      await updateStaffUserStatus({ staffId: staff.id, status: nextStatus });
      onNotify(
        `User Cat 1 "${staff.username}" ${nextStatus === 'active' ? 'enabled' : 'disabled'}.`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update staff status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPasswordSubmit = async (staff: StaffUser) => {
    setActionError(null);
    setBusyId(staff.id);
    try {
      await resetStaffPassword({ staffId: staff.id, newPassword: newPasswordInput });
      onNotify(`Password updated for ${staff.username}.`);
      setResetTargetId(null);
      setNewPasswordInput('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteCat1 = async (staff: StaffUser) => {
    setActionError(null);
    setBusyId(staff.id);
    try {
      await deleteCat1StaffUser(staff);
      onNotify(`Removed User Cat 1 "${staff.username}".`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to remove User Cat 1.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sole Admin Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-800 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs text-emerald-800 font-semibold">
                <span>1. Admin · Sole Account (Limit: 1 per branch)</span>
              </div>
              <h2 className="text-base font-bold text-slate-900 font-display mt-0.5">
                {adminUser ? adminUser.username : 'Branch Admin'}
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                {adminUser?.email} · Full control, unlimited withdrawal validation, and Cat 1 approvals
              </p>
            </div>
          </div>

          {adminUser && (
            <button
              type="button"
              onClick={() => {
                setResetTargetId(resetTargetId === adminUser.id ? null : adminUser.id);
                setNewPasswordInput('');
                setActionError(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-center"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Change Admin Password</span>
            </button>
          )}
        </div>

        {adminUser && resetTargetId === adminUser.id && (
          <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-md">
            <input
              type="password"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="New Admin password (min 6 chars)"
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
            <button
              type="button"
              disabled={busyId === adminUser.id}
              onClick={() => handleResetPasswordSubmit(adminUser)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              Save Password
            </button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Create User Cat 1 Form */}
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 font-display">
            Create User Cat 1 Teller
          </h2>
          <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
            Add 1, 10, or 1,000+ User Cat 1 tellers with individual email, username, and password credentials.
          </p>

          {createError && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {createError}
            </div>
          )}

          <form onSubmit={handleCreateCat1} className="space-y-3.5">
            <div>
              <label htmlFor="cat1-email" className="block text-xs font-medium text-slate-700 mb-1">
                Teller Email
              </label>
              <input
                id="cat1-email"
                type="email"
                required
                maxLength={STAFF_CONSTRAINTS.EMAIL_MAX}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teller@branch.org"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="cat1-username" className="block text-xs font-medium text-slate-700 mb-1">
                Username
              </label>
              <input
                id="cat1-username"
                type="text"
                required
                minLength={STAFF_CONSTRAINTS.USERNAME_MIN}
                maxLength={STAFF_CONSTRAINTS.USERNAME_MAX}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="teller.grace"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="cat1-password" className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="cat1-password"
                type="password"
                required
                minLength={STAFF_CONSTRAINTS.PASSWORD_MIN}
                maxLength={STAFF_CONSTRAINTS.PASSWORD_MAX}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800">User Cat 1 Permissions:</p>
              <p>· Basic client info only · New accounts · Deposits</p>
              <p>· Withdrawals $1–$350 direct · &gt;$350 sent to Admin</p>
              <p>· Delete requests sent to Admin · Daily Cash Report</p>
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              <span>{isCreating ? 'Creating Teller...' : 'Create User Cat 1'}</span>
            </button>
          </form>
        </section>

        {/* User Cat 1 Directory */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 font-display">
                User Cat 1 Tellers ({cat1Users.length})
              </h2>
              <p className="text-xs text-slate-500">
                Supports unlimited Cat 1 tellers across your branch counters.
              </p>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search username or email..."
                className="pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg w-60 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>
          </div>

          {actionError && (
            <div role="alert" className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {actionError}
            </div>
          )}

          {filteredCat1.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              {cat1Users.length === 0
                ? 'No User Cat 1 tellers created yet. Use the form on the left to add your first teller.'
                : 'No tellers match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                    <th className="py-3 px-4">Username &amp; Email</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredCat1.map((staff) => (
                    <React.Fragment key={staff.id}>
                      <tr className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-mono font-semibold text-slate-900">{staff.username}</div>
                          <div className="text-slate-500 mt-0.5">{staff.email}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {staff.status === 'active' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                              <Lock className="w-3.5 h-3.5" />
                              <span>Disabled</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {formatShortDate(staff.createdAt)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setResetTargetId(resetTargetId === staff.id ? null : staff.id);
                                setNewPasswordInput('');
                                setActionError(null);
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                            >
                              Reset Password
                            </button>
                            <button
                              type="button"
                              disabled={busyId === staff.id}
                              onClick={() => handleToggleStatus(staff)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 rounded-md hover:bg-amber-100 cursor-pointer disabled:opacity-50"
                            >
                              {staff.status === 'active' ? (
                                <>
                                  <Lock className="w-3 h-3" />
                                  <span>Disable</span>
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3 h-3" />
                                  <span>Enable</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === staff.id}
                              onClick={() => handleDeleteCat1(staff)}
                              aria-label={`Delete ${staff.username}`}
                              className="p-1.5 text-red-700 hover:bg-red-50 rounded-md cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {resetTargetId === staff.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="password"
                                value={newPasswordInput}
                                onChange={(e) => setNewPasswordInput(e.target.value)}
                                placeholder={`New password for ${staff.username} (min 6 chars)`}
                                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg w-64 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                              />
                              <button
                                type="button"
                                disabled={busyId === staff.id}
                                onClick={() => handleResetPasswordSubmit(staff)}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 cursor-pointer disabled:opacity-50"
                              >
                                Save Password
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setResetTargetId(null);
                                  setNewPasswordInput('');
                                }}
                                className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
