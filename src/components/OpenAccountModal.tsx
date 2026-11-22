import React, { useEffect, useState } from 'react';
import { RefreshCw, UserPlus, X } from 'lucide-react';
import {
  ACCOUNT_TYPE_LABELS,
  AccountType,
  BLUEPRINT_CONSTRAINTS,
  CURRENCY_OPTIONS,
  CurrencyCode,
  Customer,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  StaffRole,
} from '../types/microfinance';
import { formatCents, generateAccountNumber, parseAmountToCents } from '../utils/currency';

interface OpenAccountModalProps {
  isOpen: boolean;
  customers: Customer[];
  preselectedCustomerId?: string | null;
  defaultCurrency: CurrencyCode;
  staffRole?: StaffRole;
  onClose: () => void;
  onRequestNewCustomer: () => void;
  onSubmit: (params: {
    customerId: string;
    customerName: string;
    accountNumber: string;
    accountType: AccountType;
    currency: CurrencyCode;
    openingDepositCents: number;
    paymentMethod: PaymentMethod;
    notes: string;
  }) => Promise<void>;
}

export const OpenAccountModal: React.FC<OpenAccountModalProps> = ({
  isOpen,
  customers,
  preselectedCustomerId,
  defaultCurrency,
  staffRole = 'admin',
  onClose,
  onRequestNewCustomer,
  onSubmit,
}) => {
  const isAdmin = staffRole === 'admin';
  const [customerId, setCustomerId] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('savings');
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [openingDepositInput, setOpeningDepositInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('Opening branch deposit');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const initialCustomer =
        preselectedCustomerId && customers.some((c) => c.id === preselectedCustomerId)
          ? preselectedCustomerId
          : customers[0]?.id || '';
      setCustomerId(initialCustomer);
      setAccountNumber(generateAccountNumber('MF'));
      setAccountType('savings');
      setCurrency(defaultCurrency);
      setOpeningDepositInput('');
      setPaymentMethod('cash');
      setNotes('Opening branch deposit');
      setError(null);
      setIsSaving(false);
    }
  }, [isOpen, preselectedCustomerId, customers, defaultCurrency]);

  if (!isOpen) return null;

  const parsedDeposit = openingDepositInput.trim() === '' ? 0 : parseAmountToCents(openingDepositInput);
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedCustomer) {
      setError('Please select or register a customer before opening an account.');
      return;
    }

    const cleanAcctNum = accountNumber.trim().toUpperCase();
    if (
      cleanAcctNum.length < BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MIN ||
      !BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_PATTERN.test(cleanAcctNum)
    ) {
      setError('Account number must be 4-24 uppercase letters, numbers, or hyphens.');
      return;
    }

    if (parsedDeposit === null || parsedDeposit < 0) {
      setError('Please enter a valid opening deposit amount (up to 2 decimal places).');
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.fullName,
        accountNumber: cleanAcctNum,
        accountType,
        currency,
        openingDepositCents: parsedDeposit,
        paymentMethod,
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create customer account.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-account-modal-title"
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="open-account-modal-title" className="text-base font-semibold text-slate-900 font-display">
            Open Customer Account
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="acct-customer" className="block text-xs font-medium text-slate-700">
                Customer Holder
              </label>
              {isAdmin && (
                <button
                  type="button"
                  onClick={onRequestNewCustomer}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:text-emerald-900 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>New Customer</span>
                </button>
              )}
            </div>
            {customers.length === 0 ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center justify-between">
                <span>No customers registered yet.</span>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={onRequestNewCustomer}
                    className="font-medium text-emerald-800 hover:underline cursor-pointer"
                  >
                    Register first customer
                  </button>
                ) : (
                  <span className="text-slate-500">Ask Admin to register KYC first</span>
                )}
              </div>
            ) : (
              <select
                id="acct-customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {isAdmin
                      ? `${c.fullName} (${c.nationalId})`
                      : `${c.fullName} · KYC ${c.kycStatus === 'verified' ? 'Verified' : 'Pending'}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="acct-number" className="block text-xs font-medium text-slate-700 mb-1.5">
                Account Number
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="acct-number"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX}
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
                />
                <button
                  type="button"
                  onClick={() => setAccountNumber(generateAccountNumber('MF'))}
                  title="Generate new account number"
                  aria-label="Generate new account number"
                  className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="acct-type" className="block text-xs font-medium text-slate-700 mb-1.5">
                Account Product
              </label>
              <select
                id="acct-type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as AccountType)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((key) => (
                  <option key={key} value={key}>
                    {ACCOUNT_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="acct-currency" className="block text-xs font-medium text-slate-700 mb-1.5">
                Currency
              </label>
              <select
                id="acct-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="acct-opening-deposit" className="block text-xs font-medium text-slate-700 mb-1.5">
                Opening Deposit (Optional)
              </label>
              <input
                id="acct-opening-deposit"
                type="text"
                inputMode="decimal"
                value={openingDepositInput}
                onChange={(e) => setOpeningDepositInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>
          </div>

          {parsedDeposit !== null && parsedDeposit > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label htmlFor="acct-method" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Deposit Method
                </label>
                <select
                  id="acct-method"
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
                <label htmlFor="acct-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Ledger Note
                </label>
                <input
                  id="acct-notes"
                  type="text"
                  maxLength={BLUEPRINT_CONSTRAINTS.NOTES_MAX}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
                />
              </div>
            </div>
          )}

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Calculated Opening Balance</span>
            <span className="text-base font-semibold text-slate-900 font-mono tabular-nums">
              {formatCents(parsedDeposit ?? 0, currency)}
            </span>
          </div>

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
              disabled={isSaving || customers.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSaving ? 'Creating Account...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
