import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  ACCOUNT_TYPE_LABELS,
  Account,
  BLUEPRINT_CONSTRAINTS,
  CAT1_WITHDRAWAL_MAX_CENTS,
  CAT1_WITHDRAWAL_MIN_CENTS,
  CurrencyCode,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  STAFF_CONSTRAINTS,
  StaffRole,
} from '../types/microfinance';
import {
  formatCents,
  generateTransactionReference,
  parseAmountToCents,
} from '../utils/currency';

interface TransactionModalProps {
  isOpen: boolean;
  accounts: Account[];
  preselectedAccountId?: string | null;
  initialType?: 'deposit' | 'withdrawal';
  alertThresholdCents?: number;
  defaultCurrency?: CurrencyCode;
  staffRole?: StaffRole;
  onClose: () => void;
  onSubmit: (params: {
    accountId: string;
    type: 'deposit' | 'withdrawal';
    amountCents: number;
    paymentMethod: PaymentMethod;
    reference: string;
    notes: string;
  }) => Promise<void>;
  onSubmitOverLimitWithdrawal?: (params: {
    account: Account;
    amountCents: number;
    paymentMethod: PaymentMethod;
    reference: string;
    notes: string;
    message: string;
  }) => Promise<void>;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  accounts,
  preselectedAccountId,
  initialType = 'deposit',
  alertThresholdCents = 0,
  defaultCurrency = 'USD',
  staffRole = 'admin',
  onClose,
  onSubmit,
  onSubmitOverLimitWithdrawal,
}) => {
  const activeAccounts = accounts.filter((a) => a.status === 'active');

  const [accountId, setAccountId] = useState('');
  const [type, setType] = useState<'deposit' | 'withdrawal'>(initialType);
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const targetAccount =
        preselectedAccountId && activeAccounts.some((a) => a.id === preselectedAccountId)
          ? preselectedAccountId
          : activeAccounts[0]?.id || '';
      setAccountId(targetAccount);
      setType(initialType);
      setAmountInput('');
      setPaymentMethod('cash');
      setReference(generateTransactionReference(initialType));
      setNotes('');
      setAdminMessage('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, preselectedAccountId, initialType, accounts.length]);

  if (!isOpen) return null;

  const selectedAccount = activeAccounts.find((a) => a.id === accountId) || null;
  const parsedAmountCents = parseAmountToCents(amountInput);
  const currentBalanceCents = selectedAccount?.balanceCents ?? 0;

  let projectedBalanceCents = currentBalanceCents;
  let isOverdraft = false;

  if (parsedAmountCents !== null && parsedAmountCents > 0) {
    if (type === 'deposit') {
      projectedBalanceCents = currentBalanceCents + parsedAmountCents;
    } else {
      projectedBalanceCents = currentBalanceCents - parsedAmountCents;
      if (projectedBalanceCents < 0) {
        isOverdraft = true;
      }
    }
  }

  const isCat1Withdrawal = staffRole === 'cat1' && type === 'withdrawal';
  const isBelowCat1Min =
    isCat1Withdrawal &&
    parsedAmountCents !== null &&
    parsedAmountCents > 0 &&
    parsedAmountCents < CAT1_WITHDRAWAL_MIN_CENTS;
  const requiresAdminValidation =
    isCat1Withdrawal &&
    !isOverdraft &&
    parsedAmountCents !== null &&
    parsedAmountCents > CAT1_WITHDRAWAL_MAX_CENTS;

  const handleTypeSwitch = (nextType: 'deposit' | 'withdrawal') => {
    setType(nextType);
    setReference(generateTransactionReference(nextType));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedAccount) {
      setError('No active customer account selected.');
      return;
    }
    if (parsedAmountCents === null || parsedAmountCents <= 0) {
      setError('Please enter a valid positive amount (up to 2 decimal places).');
      return;
    }
    if (type === 'withdrawal' && parsedAmountCents > selectedAccount.balanceCents) {
      setError(
        `Insufficient funds. Available balance is ${formatCents(selectedAccount.balanceCents, selectedAccount.currency)}.`,
      );
      return;
    }
    if (isBelowCat1Min) {
      setError('User Cat 1 withdrawals must be at least $1.00.');
      return;
    }
    if (reference.trim().length < BLUEPRINT_CONSTRAINTS.REFERENCE_MIN) {
      setError('Receipt reference must be at least 3 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (requiresAdminValidation && onSubmitOverLimitWithdrawal) {
        await onSubmitOverLimitWithdrawal({
          account: selectedAccount,
          amountCents: parsedAmountCents,
          paymentMethod,
          reference: reference.trim(),
          notes: notes.trim(),
          message:
            adminMessage.trim() ||
            `Withdrawal of ${formatCents(parsedAmountCents, selectedAccount.currency)} exceeds $350.00 User Cat 1 limit.`,
        });
      } else {
        await onSubmit({
          accountId: selectedAccount.id,
          type,
          amountCents: parsedAmountCents,
          paymentMethod,
          reference: reference.trim(),
          notes: notes.trim(),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post ledger transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-modal-title"
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 id="tx-modal-title" className="text-base font-semibold text-slate-900 font-display">
            Record Account Operation
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          {/* Segmented Operation Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => handleTypeSwitch('deposit')}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                type === 'deposit'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Deposit (Credit)</span>
            </button>
            <button
              type="button"
              onClick={() => handleTypeSwitch('withdrawal')}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                type === 'withdrawal'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Withdrawal (Debit)</span>
            </button>
          </div>

          {isCat1Withdrawal && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
              <span>
                User Cat 1 authorization allows direct withdrawals from{' '}
                <strong className="font-mono text-slate-900">$1.00</strong> to{' '}
                <strong className="font-mono text-slate-900">$350.00</strong>. Amounts over{' '}
                <strong className="font-mono text-slate-900">$350.00</strong> send a validation request to the Admin.
              </span>
            </div>
          )}

          <div>
            <label htmlFor="tx-account" className="block text-xs font-medium text-slate-700 mb-1.5">
              Customer Account
            </label>
            {activeAccounts.length === 0 ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                No active accounts available. Create or activate an account first.
              </div>
            ) : (
              <select
                id="tx-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                {activeAccounts.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.accountNumber} — {acct.customerName} ({ACCOUNT_TYPE_LABELS[acct.accountType]}) · Bal:{' '}
                    {formatCents(acct.balanceCents, acct.currency)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tx-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                Amount {selectedAccount ? `(${selectedAccount.currency})` : ''}
              </label>
              <input
                id="tx-amount"
                type="text"
                inputMode="decimal"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="tx-method" className="block text-xs font-medium text-slate-700 mb-1.5">
                Payment Channel
              </label>
              <select
                id="tx-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tx-reference" className="block text-xs font-medium text-slate-700 mb-1.5">
                Receipt Reference
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="tx-reference"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.REFERENCE_MAX}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
                />
                <button
                  type="button"
                  onClick={() => setReference(generateTransactionReference(type))}
                  aria-label="Regenerate receipt reference"
                  className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="tx-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
                Teller Note (Optional)
              </label>
              <input
                id="tx-notes"
                type="text"
                maxLength={BLUEPRINT_CONSTRAINTS.NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={type === 'deposit' ? 'Weekly savings deposit' : 'Inventory withdrawal'}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>
          </div>

          {requiresAdminValidation && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
              <div className="flex items-start gap-2 text-xs text-amber-950 font-medium">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Amount exceeds the $350.00 User Cat 1 limit. Submitting will send a validation message to the Branch Admin before funds are deducted.
                </span>
              </div>
              <div>
                <label htmlFor="tx-admin-msg" className="block text-xs font-medium text-amber-950 mb-1">
                  Message to Admin (Optional)
                </label>
                <input
                  id="tx-admin-msg"
                  type="text"
                  maxLength={STAFF_CONSTRAINTS.MESSAGE_MAX}
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Customer verified in person at counter..."
                  className="w-full px-3 py-2 text-xs border border-amber-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </div>
            </div>
          )}

          {/* Live Balance Impact Calculator */}
          {selectedAccount && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Current Account Balance</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatCents(currentBalanceCents, selectedAccount.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{type === 'deposit' ? 'Deposit Credit (+)' : 'Withdrawal Debit (-)'}</span>
                <span
                  className={`font-mono tabular-nums font-medium ${
                    type === 'deposit' ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {type === 'deposit' ? '+' : '-'}
                  {formatCents(parsedAmountCents ?? 0, selectedAccount.currency)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">
                  {requiresAdminValidation ? 'Balance After Admin Validation' : 'Calculated New Balance'}
                </span>
                <span
                  className={`text-base font-bold font-mono tabular-nums ${
                    isOverdraft ? 'text-red-700' : 'text-slate-900'
                  }`}
                >
                  {formatCents(projectedBalanceCents, selectedAccount.currency)}
                </span>
              </div>
              {isOverdraft && (
                <p className="text-xs text-red-700 font-medium">
                  Withdrawal exceeds available funds. Reduce amount to{' '}
                  {formatCents(currentBalanceCents, selectedAccount.currency)} or less.
                </p>
              )}
              {isBelowCat1Min && (
                <p className="text-xs text-red-700 font-medium">
                  User Cat 1 withdrawals must be at least $1.00.
                </p>
              )}
              {!isOverdraft &&
                alertThresholdCents > 0 &&
                selectedAccount.currency === defaultCurrency &&
                parsedAmountCents !== null &&
                parsedAmountCents > alertThresholdCents && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-800 font-medium pt-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Exceeds branch alert threshold ({formatCents(alertThresholdCents, defaultCurrency)}) and will trigger a dashboard warning.
                    </span>
                  </p>
                )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedAccount || isOverdraft || isBelowCat1Min}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors cursor-pointer disabled:opacity-60 ${
                requiresAdminValidation
                  ? 'bg-amber-700 hover:bg-amber-800'
                  : type === 'deposit'
                    ? 'bg-emerald-800 hover:bg-emerald-900'
                    : 'bg-red-700 hover:bg-red-800'
              }`}
            >
              {requiresAdminValidation && <Send className="w-3.5 h-3.5" />}
              <span>
                {isSubmitting
                  ? requiresAdminValidation
                    ? 'Sending to Admin...'
                    : 'Posting...'
                  : requiresAdminValidation
                    ? 'Send to Admin for Validation'
                    : type === 'deposit'
                      ? 'Confirm Deposit'
                      : 'Confirm Withdrawal'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
