import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Search, X } from 'lucide-react';
import {
  ACCOUNT_TYPE_LABELS,
  Account,
  AccountDirectoryEntry,
  BLUEPRINT_CONSTRAINTS,
} from '../types/microfinance';
import { lookupAccountByNumber } from '../services/ledgerService';
import { formatCents, parseAmountToCents } from '../utils/currency';

interface TransferModalProps {
  isOpen: boolean;
  accounts: Account[];
  preselectedSourceId?: string | null;
  knownAccounts?: Account[];
  onClose: () => void;
  onSubmit: (params: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountCents: number;
    notes: string;
  }) => Promise<void>;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  accounts,
  preselectedSourceId,
  knownAccounts = [],
  onClose,
  onSubmit,
}) => {
  const activeSourceAccounts = accounts.filter((a) => a.status === 'active');

  const [sourceAccountId, setSourceAccountId] = useState('');
  const [transferMode, setTransferMode] = useState<'own' | 'external'>('external');
  const [ownDestId, setOwnDestId] = useState('');
  const [recipientAccountNumber, setRecipientAccountNumber] = useState('');
  const [verifiedRecipient, setVerifiedRecipient] = useState<AccountDirectoryEntry | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [amountInput, setAmountInput] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sourceAccount = activeSourceAccounts.find((a) => a.id === sourceAccountId) || null;

  const eligibleOwnDestinations = activeSourceAccounts.filter(
    (a) =>
      a.id !== sourceAccountId &&
      (!sourceAccount || a.currency === sourceAccount.currency),
  );

  useEffect(() => {
    if (!isOpen) return;
    const initialSource =
      preselectedSourceId && activeSourceAccounts.some((a) => a.id === preselectedSourceId)
        ? preselectedSourceId
        : activeSourceAccounts[0]?.id || '';
    setSourceAccountId(initialSource);

    const src = activeSourceAccounts.find((a) => a.id === initialSource);
    const otherOwn = activeSourceAccounts.filter(
      (a) => a.id !== initialSource && (!src || a.currency === src.currency),
    );
    setTransferMode(otherOwn.length > 0 ? 'own' : 'external');
    setOwnDestId(otherOwn[0]?.id || '');
    setRecipientAccountNumber('');
    setVerifiedRecipient(null);
    setLookupError(null);
    setAmountInput('');
    setNotes('');
    setError(null);
    setIsSubmitting(false);
  }, [isOpen, preselectedSourceId, accounts.length]);

  useEffect(() => {
    if (!sourceAccount) return;
    const otherOwn = activeSourceAccounts.filter(
      (a) => a.id !== sourceAccount.id && a.currency === sourceAccount.currency,
    );
    if (!otherOwn.some((a) => a.id === ownDestId)) {
      setOwnDestId(otherOwn[0]?.id || '');
    }
  }, [sourceAccountId]);

  if (!isOpen) return null;

  const parsedAmountCents = parseAmountToCents(amountInput);
  const currentBalanceCents = sourceAccount?.balanceCents ?? 0;
  const projectedBalanceCents =
    parsedAmountCents !== null && parsedAmountCents > 0
      ? currentBalanceCents - parsedAmountCents
      : currentBalanceCents;
  const isOverdraft = parsedAmountCents !== null && parsedAmountCents > currentBalanceCents;

  const handleLookup = async (overrideNumber?: string) => {
    const raw = (overrideNumber ?? recipientAccountNumber).trim().toUpperCase();
    setLookupError(null);
    setVerifiedRecipient(null);

    if (!raw) {
      setLookupError('Enter a recipient account number (for example MF-2026-10421).');
      return;
    }
    if (sourceAccount && raw === sourceAccount.accountNumber) {
      setLookupError('Cannot transfer to the same source account.');
      return;
    }

    setIsLookingUp(true);
    try {
      const entry = await lookupAccountByNumber(raw);
      if (!entry) {
        const localMatch = knownAccounts.find(
          (a) => a.accountNumber.toUpperCase() === raw && a.id !== sourceAccount?.id,
        );
        if (localMatch) {
          setVerifiedRecipient({
            accountId: localMatch.id,
            accountNumber: localMatch.accountNumber,
            ownerId: localMatch.ownerId,
            customerId: localMatch.customerId,
            customerName: localMatch.customerName,
            currency: localMatch.currency,
            status: localMatch.status,
            createdAt: localMatch.createdAt,
            updatedAt: localMatch.updatedAt,
          });
          return;
        }
        setLookupError('No account found with that account number.');
        return;
      }
      if (entry.status !== 'active') {
        setLookupError(`Recipient account ${entry.accountNumber} is currently ${entry.status}.`);
        return;
      }
      if (sourceAccount && entry.currency !== sourceAccount.currency) {
        setLookupError(
          `Currency mismatch: recipient account uses ${entry.currency}, while source account uses ${sourceAccount.currency}.`,
        );
        return;
      }
      setVerifiedRecipient(entry);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Unable to verify recipient account.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!sourceAccount) {
      setError('Select an active source account.');
      return;
    }

    const destinationAccountId =
      transferMode === 'own' ? ownDestId : verifiedRecipient?.accountId || '';

    if (!destinationAccountId) {
      setError(
        transferMode === 'own'
          ? 'Select a destination account.'
          : 'Verify a valid recipient account number first.',
      );
      return;
    }
    if (destinationAccountId === sourceAccount.id) {
      setError('Source and destination accounts must be different.');
      return;
    }
    if (parsedAmountCents === null || parsedAmountCents <= 0) {
      setError('Enter a valid positive transfer amount (up to 2 decimal places).');
      return;
    }
    if (parsedAmountCents > sourceAccount.balanceCents) {
      setError(
        `Insufficient balance. Available funds: ${formatCents(sourceAccount.balanceCents, sourceAccount.currency)}.`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        sourceAccountId: sourceAccount.id,
        destinationAccountId,
        amountCents: parsedAmountCents,
        notes: notes.trim() || 'Account transfer',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete transfer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const directoryHints = knownAccounts.filter(
    (a) =>
      a.status === 'active' &&
      a.id !== sourceAccount?.id &&
      (!sourceAccount || a.currency === sourceAccount.currency),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
        className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-emerald-800" />
            <h2 id="transfer-modal-title" className="text-base font-semibold text-slate-900 font-display">
              Transfer Funds
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transfer dialog"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
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

          <div>
            <label htmlFor="trf-source" className="block text-xs font-medium text-slate-700 mb-1.5">
              From Account
            </label>
            <select
              id="trf-source"
              value={sourceAccountId}
              onChange={(e) => {
                setSourceAccountId(e.target.value);
                setVerifiedRecipient(null);
              }}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
            >
              {activeSourceAccounts.map((acct) => (
                <option key={acct.id} value={acct.id}>
                  {acct.accountNumber} · {ACCOUNT_TYPE_LABELS[acct.accountType]} —{' '}
                  {formatCents(acct.balanceCents, acct.currency)}
                </option>
              ))}
            </select>
          </div>

          {/* Transfer Destination Mode Switch (shown only when multiple eligible accounts are loaded) */}
          {eligibleOwnDestinations.length > 0 && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setTransferMode('own')}
                className={`py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  transferMode === 'own'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                My Accounts
              </button>
              <button
                type="button"
                onClick={() => setTransferMode('external')}
                className={`py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  transferMode === 'external'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Account Number
              </button>
            </div>
          )}

          {transferMode === 'own' && eligibleOwnDestinations.length > 0 ? (
            <div>
              <label htmlFor="trf-own-dest" className="block text-xs font-medium text-slate-700 mb-1.5">
                To My Account
              </label>
              <select
                id="trf-own-dest"
                value={ownDestId}
                onChange={(e) => setOwnDestId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                {eligibleOwnDestinations.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.accountNumber} · {ACCOUNT_TYPE_LABELS[acct.accountType]} —{' '}
                    {formatCents(acct.balanceCents, acct.currency)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="trf-acct-num" className="block text-xs font-medium text-slate-700">
                Recipient Account Number
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="trf-acct-num"
                  type="text"
                  maxLength={BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX}
                  value={recipientAccountNumber}
                  onChange={(e) => {
                    setRecipientAccountNumber(e.target.value.toUpperCase());
                    setVerifiedRecipient(null);
                    setLookupError(null);
                  }}
                  placeholder="MF-2026-10421"
                  className="flex-1 px-3 py-2.5 text-sm border border-slate-300 rounded-lg font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
                <button
                  type="button"
                  disabled={isLookingUp}
                  onClick={() => handleLookup()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isLookingUp ? 'Checking...' : 'Verify'}</span>
                </button>
              </div>

              {lookupError && <p className="text-xs text-red-700">{lookupError}</p>}

              {verifiedRecipient && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-950 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>
                      {verifiedRecipient.customerName} ·{' '}
                      <span className="font-mono">{verifiedRecipient.accountNumber}</span>
                    </span>
                  </div>
                  <span className="font-mono text-emerald-800 font-semibold">
                    {verifiedRecipient.currency}
                  </span>
                </div>
              )}

              {directoryHints.length > 0 && !verifiedRecipient && (
                <div className="pt-1">
                  <p className="text-[11px] text-slate-500 mb-1.5">Available branch accounts:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {directoryHints.slice(0, 4).map((acct) => (
                      <button
                        key={acct.id}
                        type="button"
                        onClick={() => {
                          setRecipientAccountNumber(acct.accountNumber);
                          handleLookup(acct.accountNumber);
                        }}
                        className="px-2.5 py-1 text-[11px] font-mono text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
                      >
                        {acct.accountNumber} ({acct.customerName.split(' ')[0]})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="trf-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                Amount {sourceAccount ? `(${sourceAccount.currency})` : ''}
              </label>
              <input
                id="trf-amount"
                type="text"
                inputMode="decimal"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="trf-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
                Transfer Note (Optional)
              </label>
              <input
                id="trf-notes"
                type="text"
                maxLength={BLUEPRINT_CONSTRAINTS.NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Supplier payment or savings split"
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>
          </div>

          {sourceAccount && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Available Balance (Solde)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatCents(currentBalanceCents, sourceAccount.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Transfer Debit</span>
                <span className="font-mono tabular-nums font-medium text-red-700">
                  -{formatCents(parsedAmountCents ?? 0, sourceAccount.currency)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Remaining Balance</span>
                <span
                  className={`text-base font-bold font-mono tabular-nums ${
                    isOverdraft ? 'text-red-700' : 'text-slate-900'
                  }`}
                >
                  {formatCents(projectedBalanceCents, sourceAccount.currency)}
                </span>
              </div>
              {isOverdraft && (
                <p className="text-xs text-red-700 font-medium">
                  Transfer exceeds available funds in this account.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !sourceAccount ||
                isOverdraft ||
                (transferMode === 'own' ? !ownDestId : !verifiedRecipient)
              }
              className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? 'Sending Transfer...' : 'Send Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
