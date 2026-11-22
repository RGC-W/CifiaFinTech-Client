import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  MessageSquare,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  ApprovalRequest,
  PAYMENT_METHOD_LABELS,
  StaffUser,
} from '../types/microfinance';
import {
  approveApprovalRequest,
  rejectApprovalRequest,
} from '../services/ledgerService';
import { formatCents, formatTimestamp } from '../utils/currency';

interface ApprovalInboxViewProps {
  ownerId: string;
  activeStaff: StaffUser;
  requests: ApprovalRequest[];
  onNotify: (message: string) => void;
  onInspectAccount: (accountId: string) => void;
}

export const ApprovalInboxView: React.FC<ApprovalInboxViewProps> = ({
  ownerId,
  activeStaff,
  requests,
  onNotify,
  onInspectAccount,
}) => {
  const isAdmin = activeStaff.role === 'admin';
  const [filterTab, setFilterTab] = useState<'pending' | 'reviewed'>('pending');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopedRequests = useMemo(() => {
    const base = isAdmin
      ? requests
      : requests.filter(
          (r) =>
            r.requestedByStaffId === activeStaff.id ||
            r.requestType === 'client_withdrawal',
        );
    return [...base].sort(
      (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
    );
  }, [requests, isAdmin, activeStaff.id]);

  const displayedRequests = useMemo(() => {
    if (filterTab === 'pending') {
      return scopedRequests.filter((r) => r.status === 'pending');
    }
    return scopedRequests.filter((r) => r.status !== 'pending');
  }, [scopedRequests, filterTab]);

  const pendingCount = scopedRequests.filter((r) => r.status === 'pending').length;

  const handleApprove = async (req: ApprovalRequest) => {
    setError(null);
    setBusyId(req.id);
    try {
      await approveApprovalRequest({
        ownerId,
        adminStaff: activeStaff,
        request: req,
        reviewNote: reviewNotes[req.id],
      });
      if (req.requestType === 'client_account_activation') {
        onNotify(
          `Validated Client App account ${req.accountNumber} for ${req.customerName} and notified ${req.requestedByEmail}.`,
        );
      } else if (req.requestType === 'client_withdrawal') {
        onNotify(
          `Confirmed and debited client withdrawal of ${formatCents(req.amountCents, req.currency)} on ${req.accountNumber}.`,
        );
      } else if (req.requestType === 'withdrawal_over_limit') {
        onNotify(
          `Approved and posted withdrawal of ${formatCents(req.amountCents, req.currency)} for ${req.customerName}.`,
        );
      } else {
        onNotify(
          `Approved and deleted validated operation ${req.reference} on ${req.accountNumber}.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: ApprovalRequest) => {
    setError(null);
    setBusyId(req.id);
    try {
      await rejectApprovalRequest({
        ownerId,
        adminStaff: activeStaff,
        requestId: req.id,
        reviewNote: reviewNotes[req.id],
      });
      onNotify(`Declined request ${req.reference} (${req.customerName}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to decline request.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 font-display">
            {isAdmin
              ? 'Admin Validation & Confirmation Inbox'
              : 'Branch Confirmation & Admin Messages'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAdmin
              ? 'Validate new Client App registrations, confirm Client withdrawals, and approve User Cat 1 over-$350 withdrawals or deletions.'
              : 'Confirm or decline customer Client App withdrawal requests, and track your own requests awaiting Admin validation.'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-center">
          <button
            type="button"
            onClick={() => setFilterTab('pending')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              filterTab === 'pending'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('reviewed')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              filterTab === 'reviewed'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            History ({scopedRequests.length - pendingCount})
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
          {error}
        </div>
      )}

      {displayedRequests.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <MessageSquare className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900">
            {filterTab === 'pending' ? 'No pending requests' : 'No reviewed requests yet'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {filterTab === 'pending'
              ? isAdmin
                ? 'New Client App account activations, client withdrawals, and User Cat 1 requests appear here.'
                : 'Customer Client App withdrawals awaiting confirmation and your requests sent to Admin appear here.'
              : 'Completed validations, confirmations, and rejections will appear here for audit history.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedRequests.map((req) => {
            const isClientActivation = req.requestType === 'client_account_activation';
            const isClientWithdrawal = req.requestType === 'client_withdrawal';
            const isOverLimit = req.requestType === 'withdrawal_over_limit';
            const canAct = req.status === 'pending' && (isAdmin || isClientWithdrawal);

            return (
              <article
                key={req.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {isClientActivation ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>New Client App Account</span>
                        </span>
                      ) : isClientWithdrawal ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>Client Withdrawal Request</span>
                        </span>
                      ) : isOverLimit ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>Withdrawal Over $350.00 Limit</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Validated Operation</span>
                        </span>
                      )}
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-700">{req.reference}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-slate-500">{formatTimestamp(req.createdAt)}</span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900 font-display">
                      {req.customerName}{' '}
                      <button
                        type="button"
                        onClick={() => onInspectAccount(req.accountId)}
                        className="font-mono font-semibold text-emerald-800 hover:underline ml-1 cursor-pointer"
                      >
                        ({req.accountNumber})
                      </button>
                    </h3>

                    <p className="text-xs text-slate-600">
                      {req.requestedByRole === 'client' ? 'Customer email: ' : 'Requested by '}
                      <span className="font-mono font-semibold text-slate-900">
                        {req.requestedByRole === 'client' ? req.requestedByEmail : req.requestedByUsername}
                      </span>
                      {req.requestedByRole !== 'client' ? ` (${req.requestedByEmail})` : ''}
                      {!isClientActivation ? ` · ${PAYMENT_METHOD_LABELS[req.paymentMethod]}` : ''}
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                      {isClientActivation
                        ? 'Account Activation'
                        : formatCents(req.amountCents, req.currency)}
                    </div>
                    <div className="mt-1">
                      {req.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {isClientWithdrawal
                              ? 'Pending Admin / Cat 1 Confirmation'
                              : 'Pending Admin Validation'}
                          </span>
                        </span>
                      )}
                      {req.status === 'approved' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isClientActivation ? 'Validated & Active' : 'Confirmed & Executed'}</span>
                        </span>
                      )}
                      {req.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Declined</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
                  <p className="font-medium text-slate-900">
                    {isClientWithdrawal || isClientActivation ? 'Request Details:' : 'Message to Admin:'}
                  </p>
                  <p>{req.message}</p>
                  {req.notes && (
                    <p className="text-slate-500">Operation note: {req.notes}</p>
                  )}
                </div>

                {canAct ? (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      maxLength={240}
                      value={reviewNotes[req.id] || ''}
                      onChange={(e) =>
                        setReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      placeholder={
                        isAdmin ? 'Optional Admin review note...' : 'Optional Cat 1 confirmation note...'
                      }
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => handleReject(req)}
                        className="px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => handleApprove(req)}
                        className="px-4 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        {busyId === req.id
                          ? 'Processing...'
                          : isClientActivation
                            ? 'Validate Client Account'
                            : isClientWithdrawal
                              ? 'Confirm & Debit Withdrawal'
                              : isOverLimit
                                ? 'Validate & Post Withdrawal'
                                : 'Approve & Delete Operation'}
                      </button>
                    </div>
                  </div>
                ) : (
                  req.status !== 'pending' && (
                    <div className="text-xs text-slate-500 pt-1 border-t border-slate-100">
                      Reviewed by <span className="font-mono text-slate-800">{req.reviewedByUsername || 'Branch Officer'}</span>
                      {req.reviewedAt ? ` · ${formatTimestamp(req.reviewedAt)}` : ''}
                      {req.reviewNote ? ` · "${req.reviewNote}"` : ''}
                    </div>
                  )
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

