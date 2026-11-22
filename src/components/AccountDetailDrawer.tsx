import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Lock,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  Account,
  AccountStatus,
  LedgerTransaction,
  PAYMENT_METHOD_LABELS,
  STAFF_CONSTRAINTS,
  StaffRole,
  TRANSACTION_TYPE_LABELS,
  isCreditTransaction,
} from '../types/microfinance';
import {
  downloadTransactionsCsv,
  formatCents,
  formatShortDate,
  formatTimestamp,
} from '../utils/currency';

interface AccountDetailDrawerProps {
  account: Account | null;
  transactions: LedgerTransaction[];
  staffRole?: StaffRole;
  onClose: () => void;
  onStartOperation: (accountId: string, type: 'deposit' | 'withdrawal') => void;
  onChangeStatus: (account: Account, nextStatus: AccountStatus) => Promise<void>;
  onDeleteTransaction?: (tx: LedgerTransaction) => Promise<void>;
  onRequestDeleteTransaction?: (tx: LedgerTransaction, message: string) => Promise<void>;
}

export const AccountDetailDrawer: React.FC<AccountDetailDrawerProps> = ({
  account,
  transactions,
  staffRole = 'admin',
  onClose,
  onStartOperation,
  onChangeStatus,
  onDeleteTransaction,
  onRequestDeleteTransaction,
}) => {
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [copiedAccountId, setCopiedAccountId] = useState(false);
  const [pendingDeleteTxId, setPendingDeleteTxId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isProcessingTxAction, setIsProcessingTxAction] = useState(false);

  if (!account) return null;

  const isAdmin = staffRole === 'admin';

  const handleCopyAccountNumber = async () => {
    try {
      await navigator.clipboard.writeText(account.accountNumber);
      setCopiedAccountId(true);
      window.setTimeout(() => setCopiedAccountId(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const accountTransactions = transactions.filter((t) => t.accountId === account.id);

  // Live ledger audit calculation directly from transaction entries
  const ledgerDepositsCents = accountTransactions
    .filter((t) => isCreditTransaction(t.type))
    .reduce((sum, t) => sum + t.amountCents, 0);
  const ledgerWithdrawalsCents = accountTransactions
    .filter((t) => !isCreditTransaction(t.type))
    .reduce((sum, t) => sum + t.amountCents, 0);
  const ledgerNetCents = ledgerDepositsCents - ledgerWithdrawalsCents;
  const varianceCents = account.balanceCents - ledgerNetCents;
  const isReconciled = varianceCents === 0;

  const handleStatusChange = async (nextStatus: AccountStatus) => {
    setStatusError(null);
    setIsUpdatingStatus(true);
    try {
      await onChangeStatus(account, nextStatus);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to update account status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleConfirmTxAction = async (tx: LedgerTransaction) => {
    setStatusError(null);
    setIsProcessingTxAction(true);
    try {
      if (isAdmin && onDeleteTransaction) {
        await onDeleteTransaction(tx);
      } else if (!isAdmin && onRequestDeleteTransaction) {
        await onRequestDeleteTransaction(
          tx,
          deleteReason.trim() ||
            `Requesting Admin validation to delete ${tx.type} ${tx.reference} (${formatCents(tx.amountCents, tx.currency)}).`,
        );
      }
      setPendingDeleteTxId(null);
      setDeleteReason('');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to process operation action.');
    } finally {
      setIsProcessingTxAction(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Account Statement ${account.accountNumber}`}
        className="w-full max-w-2xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1 flex-wrap">
              <button
                type="button"
                onClick={handleCopyAccountNumber}
                title="Copy Account ID for Client App login"
                className="inline-flex items-center gap-1 font-mono text-slate-800 font-semibold bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded transition-colors cursor-pointer"
              >
                <span>{account.accountNumber}</span>
                {copiedAccountId ? (
                  <Check className="w-3 h-3 text-emerald-700" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-500" />
                )}
              </button>
              <span aria-hidden="true">·</span>
              <span>{ACCOUNT_TYPE_LABELS[account.accountType]}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  account.status === 'active'
                    ? 'text-emerald-700 font-medium'
                    : account.status === 'frozen'
                      ? 'text-amber-700 font-medium'
                      : 'text-slate-600 font-medium'
                }
              >
                {ACCOUNT_STATUS_LABELS[account.status]}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 font-display">{account.customerName}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Opened {formatShortDate(account.createdAt)} · {account.transactionCount} posted operations
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account statement"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {statusError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {statusError}
            </div>
          )}

          {/* Balance Calculation Breakdown */}
          <div className="border border-slate-200 rounded-xl p-5 bg-slate-50">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <p className="text-xs font-medium text-slate-600">Current Calculated Balance</p>
                <p className="text-3xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                  {formatCents(account.balanceCents, account.currency)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {isReconciled ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-emerald-800 font-medium">
                      Ledger Reconciled · 0.00 variance
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="text-amber-800 font-medium">
                      Variance: {formatCents(varianceCents, account.currency)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4">
              <div>
                <p className="text-xs text-slate-500">Total Deposits</p>
                <p className="text-sm font-semibold text-emerald-800 font-mono tabular-nums mt-0.5">
                  +{formatCents(account.totalDepositsCents, account.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Withdrawals</p>
                <p className="text-sm font-semibold text-red-700 font-mono tabular-nums mt-0.5">
                  -{formatCents(account.totalWithdrawalsCents, account.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Net Ledger Sum</p>
                <p className="text-sm font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                  {formatCents(ledgerNetCents, account.currency)}
                </p>
              </div>
            </div>
          </div>

          {/* Teller Actions & Lifecycle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={account.status !== 'active'}
                onClick={() => onStartOperation(account.id, 'deposit')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>Deposit</span>
              </button>
              <button
                type="button"
                disabled={account.status !== 'active' || account.balanceCents === 0}
                onClick={() => onStartOperation(account.id, 'withdrawal')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Withdraw</span>
              </button>
              <button
                type="button"
                disabled={accountTransactions.length === 0}
                onClick={() =>
                  downloadTransactionsCsv(
                    accountTransactions,
                    `${account.accountNumber}-statement.csv`,
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>

            {isAdmin && account.status !== 'closed' && (
              <div className="flex items-center gap-2">
                {account.status === 'active' ? (
                  <button
                    type="button"
                    disabled={isUpdatingStatus}
                    onClick={() => handleStatusChange('frozen')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Freeze</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isUpdatingStatus}
                    onClick={() => handleStatusChange('active')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>Reactivate</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isUpdatingStatus}
                  onClick={() => handleStatusChange('closed')}
                  className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Close Account
                </button>
              </div>
            )}
          </div>

          {/* Account Transaction Ledger */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 font-display">
                Transaction History
              </h3>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {accountTransactions.length} entries
              </span>
            </div>

            {accountTransactions.length === 0 ? (
              <div className="border border-slate-200 rounded-xl p-8 text-center">
                <p className="text-sm font-medium text-slate-900">No operations posted yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  Record an opening deposit to start tracking this account balance.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                        <th className="py-2.5 px-3.5">Date &amp; Ref</th>
                        <th className="py-2.5 px-3.5">Operation</th>
                        <th className="py-2.5 px-3.5 text-right">Amount</th>
                        <th className="py-2.5 px-3.5 text-right">Balance After</th>
                        <th className="py-2.5 px-3.5 text-right">Manage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {accountTransactions.map((tx) => {
                        const isCredit = isCreditTransaction(tx.type);
                        const canDeleteType = tx.type === 'deposit' || tx.type === 'withdrawal';
                        const isPrompting = pendingDeleteTxId === tx.id;
                        return (
                          <React.Fragment key={tx.id}>
                            <tr className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3.5">
                                <div className="font-mono text-slate-900 font-medium">{tx.reference}</div>
                                <div className="text-slate-500 mt-0.5">
                                  {formatTimestamp(tx.createdAt)} · {PAYMENT_METHOD_LABELS[tx.paymentMethod]}
                                  {tx.staffUsername ? ` · ${tx.staffUsername}` : ''}
                                </div>
                                {(tx.notes || tx.counterpartyAccountNumber) && (
                                  <div className="text-slate-500 mt-0.5 truncate max-w-[220px]">
                                    {tx.counterpartyAccountNumber ? `${tx.counterpartyAccountNumber} · ` : ''}
                                    {tx.notes}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                {isCredit ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                                    <ArrowDownLeft className="w-3.5 h-3.5" />
                                    <span>{TRANSACTION_TYPE_LABELS[tx.type]}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-medium text-red-700">
                                    <ArrowUpRight className="w-3.5 h-3.5" />
                                    <span>{TRANSACTION_TYPE_LABELS[tx.type]}</span>
                                  </span>
                                )}
                              </td>
                              <td
                                className={`py-2.5 px-3.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                                  isCredit ? 'text-emerald-800' : 'text-red-700'
                                }`}
                              >
                                {isCredit ? '+' : '-'}
                                {formatCents(tx.amountCents, tx.currency)}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-900 font-medium whitespace-nowrap">
                                {formatCents(tx.balanceAfterCents, tx.currency)}
                              </td>
                              <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                                {canDeleteType && account.status === 'active' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPendingDeleteTxId(isPrompting ? null : tx.id);
                                      setDeleteReason('');
                                      setStatusError(null);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 rounded cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>{isAdmin ? 'Delete' : 'Req. Delete'}</span>
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                            {isPrompting && (
                              <tr className="bg-amber-50/60">
                                <td colSpan={5} className="px-3.5 py-2.5">
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                    {!isAdmin && (
                                      <input
                                        type="text"
                                        maxLength={STAFF_CONSTRAINTS.MESSAGE_MAX}
                                        value={deleteReason}
                                        onChange={(e) => setDeleteReason(e.target.value)}
                                        placeholder="Reason sent to Admin to validate deletion..."
                                        className="flex-1 px-2.5 py-1.5 text-xs border border-amber-300 bg-white rounded-md focus:outline-none focus:ring-2 focus:ring-amber-600"
                                      />
                                    )}
                                    <div className="flex items-center gap-2 sm:ml-auto">
                                      <span className="text-[11px] text-slate-700">
                                        {isAdmin
                                          ? `Delete ${tx.reference} and reverse balance?`
                                          : 'Send delete request to Admin?'}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={isProcessingTxAction}
                                        onClick={() => handleConfirmTxAction(tx)}
                                        className="px-2.5 py-1 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                                      >
                                        {isProcessingTxAction
                                          ? 'Processing...'
                                          : isAdmin
                                            ? 'Confirm Delete'
                                            : 'Send to Admin'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPendingDeleteTxId(null)}
                                        className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
