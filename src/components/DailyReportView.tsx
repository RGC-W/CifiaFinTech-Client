import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  Download,
  Save,
} from 'lucide-react';
import {
  CurrencyCode,
  DailyCashReport,
  LedgerTransaction,
  PAYMENT_METHOD_LABELS,
  STAFF_ROLE_LABELS,
  StaffUser,
  TRANSACTION_TYPE_LABELS,
  isCreditTransaction,
} from '../types/microfinance';
import { saveDailyCashReport } from '../services/ledgerService';
import {
  downloadTransactionsCsv,
  formatCents,
  formatTimestamp,
  parseAmountToCents,
} from '../utils/currency';

interface DailyReportViewProps {
  ownerId: string;
  activeStaff: StaffUser;
  staffUsers: StaffUser[];
  transactions: LedgerTransaction[];
  dailyReports: DailyCashReport[];
  defaultCurrency: CurrencyCode;
  onNotify: (message: string) => void;
}

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTxDateString(tx: LedgerTransaction): string {
  if (!tx.createdAt) return '';
  const date = tx.createdAt.toDate();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const DailyReportView: React.FC<DailyReportViewProps> = ({
  ownerId,
  activeStaff,
  staffUsers,
  transactions,
  dailyReports,
  defaultCurrency,
  onNotify,
}) => {
  const isAdmin = activeStaff.role === 'admin';
  const [reportDate, setReportDate] = useState<string>(() => getTodayDateString());
  const [selectedStaffId, setSelectedStaffId] = useState<string>(activeStaff.id);
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [startingCashInput, setStartingCashInput] = useState('0.00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const targetStaff = useMemo(() => {
    if (!isAdmin) return activeStaff;
    return staffUsers.find((s) => s.id === selectedStaffId) || activeStaff;
  }, [isAdmin, activeStaff, staffUsers, selectedStaffId]);

  const existingSavedReport = useMemo(
    () =>
      dailyReports.find(
        (r) => r.staffId === targetStaff.id && r.reportDate === reportDate,
      ) || null,
    [dailyReports, targetStaff.id, reportDate],
  );

  useEffect(() => {
    if (existingSavedReport) {
      setStartingCashInput((existingSavedReport.startingCashCents / 100).toFixed(2));
      setCurrency(existingSavedReport.currency);
      setNotes(existingSavedReport.notes || '');
    } else {
      setStartingCashInput('0.00');
      setNotes('');
    }
  }, [existingSavedReport?.id]);

  // Operations attributed to the selected staff user on the selected date & currency
  const dayOperations = useMemo(() => {
    return transactions
      .filter((tx) => {
        if (tx.currency !== currency) return false;
        if (getTxDateString(tx) !== reportDate) return false;
        return tx.staffId === targetStaff.id;
      })
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  }, [transactions, currency, reportDate, targetStaff.id]);

  const metrics = useMemo(() => {
    let cashDepositsCents = 0;
    let cashWithdrawalsCents = 0;
    let nonCashDepositsCents = 0;
    let nonCashWithdrawalsCents = 0;

    for (const tx of dayOperations) {
      if (tx.type === 'deposit') {
        if (tx.paymentMethod === 'cash') {
          cashDepositsCents += tx.amountCents;
        } else {
          nonCashDepositsCents += tx.amountCents;
        }
      } else if (tx.type === 'withdrawal') {
        if (tx.paymentMethod === 'cash') {
          cashWithdrawalsCents += tx.amountCents;
        } else {
          nonCashWithdrawalsCents += tx.amountCents;
        }
      }
    }

    const parsedStarting =
      startingCashInput.trim() === '' ? 0 : parseAmountToCents(startingCashInput);
    const startingCashCents = parsedStarting !== null && parsedStarting >= 0 ? parsedStarting : 0;
    const endingCashCents = startingCashCents - cashWithdrawalsCents + cashDepositsCents;

    return {
      startingCashCents,
      isStartingValid: parsedStarting !== null && parsedStarting >= 0,
      cashDepositsCents,
      cashWithdrawalsCents,
      nonCashDepositsCents,
      nonCashWithdrawalsCents,
      totalDepositsCents: cashDepositsCents + nonCashDepositsCents,
      endingCashCents,
    };
  }, [dayOperations, startingCashInput]);

  const scopedHistoryReports = useMemo(() => {
    const base = isAdmin
      ? dailyReports
      : dailyReports.filter((r) => r.staffId === activeStaff.id);
    return [...base].sort((a, b) => b.reportDate.localeCompare(a.reportDate));
  }, [dailyReports, isAdmin, activeStaff.id]);

  const handleSaveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!metrics.isStartingValid) {
      setError('Enter a valid non-negative Starting Cash amount (up to 2 decimal places).');
      return;
    }

    setIsSaving(true);
    try {
      await saveDailyCashReport({
        ownerId,
        staff: targetStaff,
        reportDate,
        currency,
        startingCashCents: metrics.startingCashCents,
        cashWithdrawalsCents: metrics.cashWithdrawalsCents,
        cashDepositsCents: metrics.cashDepositsCents,
        nonCashDepositsCents: metrics.nonCashDepositsCents,
        nonCashWithdrawalsCents: metrics.nonCashWithdrawalsCents,
        operationCount: dayOperations.length,
        notes,
      });
      onNotify(
        `Saved Daily Cash Report for ${targetStaff.username} on ${reportDate} · Ending Cash: ${formatCents(metrics.endingCashCents, currency)}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save daily report.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <form
        onSubmit={handleSaveReport}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 font-display flex items-center gap-2">
              <Calculator className="w-4 h-4 text-emerald-800" />
              <span>Daily Teller Cash Report</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cash drawer reconciliation: <strong className="text-slate-700">Starting Cash − Cash Withdrawals + Deposits</strong>
            </p>
          </div>
          {existingSavedReport && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Saved for {reportDate}</span>
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="report-date" className="block text-xs font-medium text-slate-700 mb-1.5">
              Report Date
            </label>
            <input
              id="report-date"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>

          {isAdmin ? (
            <div>
              <label htmlFor="report-staff" className="block text-xs font-medium text-slate-700 mb-1.5">
                Staff Operator
              </label>
              <select
                id="report-staff"
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                {staffUsers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.username} ({STAFF_ROLE_LABELS[s.role]})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Teller Operator
              </label>
              <div className="px-3 py-2 text-sm border border-slate-200 bg-slate-50 rounded-lg font-mono text-slate-800 truncate">
                {activeStaff.username}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="report-starting-cash" className="block text-xs font-medium text-slate-700 mb-1.5">
              Starting Cash ({currency})
            </label>
            <input
              id="report-starting-cash"
              type="text"
              inputMode="decimal"
              value={startingCashInput}
              onChange={(e) => setStartingCashInput(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>

          <div>
            <label htmlFor="report-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
              Shift Closing Note
            </label>
            <input
              id="report-notes"
              type="text"
              maxLength={240}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Drawer balanced with vault..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>
        </div>

        {/* Formula KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 pt-2">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs font-medium text-slate-500">1. Starting Cash</p>
            <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {formatCents(metrics.startingCashCents, currency)}
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs font-medium text-slate-500">2. − Cash Withdrawals</p>
            <p className="text-xl font-bold text-red-700 font-mono tabular-nums mt-1">
              -{formatCents(metrics.cashWithdrawalsCents, currency)}
            </p>
            {metrics.nonCashWithdrawalsCents > 0 && (
              <p className="text-[11px] text-slate-500 font-mono mt-1">
                +{formatCents(metrics.nonCashWithdrawalsCents, currency)} non-cash
              </p>
            )}
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs font-medium text-slate-500">3. + Cash Deposits</p>
            <p className="text-xl font-bold text-emerald-800 font-mono tabular-nums mt-1">
              +{formatCents(metrics.cashDepositsCents, currency)}
            </p>
            {metrics.nonCashDepositsCents > 0 && (
              <p className="text-[11px] text-slate-500 font-mono mt-1">
                +{formatCents(metrics.nonCashDepositsCents, currency)} non-cash (Total: {formatCents(metrics.totalDepositsCents, currency)})
              </p>
            )}
          </div>

          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-xs font-semibold text-emerald-900">
              = Net Ending Cash ({dayOperations.length} ops)
            </p>
            <p
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                metrics.endingCashCents < 0 ? 'text-red-700' : 'text-emerald-900'
              }`}
            >
              {formatCents(metrics.endingCashCents, currency)}
            </p>
            <p className="text-[11px] text-emerald-800 mt-1">
              Starting − Cash Withdrawals + Deposits
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={dayOperations.length === 0}
            onClick={() =>
              downloadTransactionsCsv(
                dayOperations,
                `daily-report-${targetStaff.username}-${reportDate}.csv`,
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Day CSV</span>
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 cursor-pointer disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving Report...' : 'Save Daily Cash Report'}</span>
          </button>
        </div>
      </form>

      {/* Teller Operations for Selected Date */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 font-display">
              {targetStaff.username}&apos;s Operations on {reportDate}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Deposits and withdrawals posted under this operator&apos;s session
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {dayOperations.length} operations
          </span>
        </div>

        {dayOperations.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No operations recorded by {targetStaff.username} on {reportDate}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-4">Time &amp; Reference</th>
                  <th className="py-2.5 px-4">Customer &amp; Account</th>
                  <th className="py-2.5 px-4">Channel</th>
                  <th className="py-2.5 px-4">Operation</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {dayOperations.map((tx) => {
                  const credit = isCreditTransaction(tx.type);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="font-mono font-medium text-slate-900">{tx.reference}</div>
                        <div className="text-slate-500">{formatTimestamp(tx.createdAt)}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{tx.customerName}</div>
                        <div className="font-mono text-slate-500">{tx.accountNumber}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                        {PAYMENT_METHOD_LABELS[tx.paymentMethod]}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {credit ? (
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
                        className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          credit ? 'text-emerald-800' : 'text-red-700'
                        }`}
                      >
                        {credit ? '+' : '-'}
                        {formatCents(tx.amountCents, tx.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Saved Daily Cash Reports History */}
      {scopedHistoryReports.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900 font-display">
              Saved Daily Cash Reports ({scopedHistoryReports.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Teller</th>
                  <th className="py-2.5 px-4 text-right">Starting Cash</th>
                  <th className="py-2.5 px-4 text-right">− Cash Withdrawals</th>
                  <th className="py-2.5 px-4 text-right">+ Cash Deposits</th>
                  <th className="py-2.5 px-4 text-right">Ending Cash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {scopedHistoryReports.map((rep) => (
                  <tr
                    key={rep.id}
                    onClick={() => {
                      setReportDate(rep.reportDate);
                      if (isAdmin) setSelectedStaffId(rep.staffId);
                    }}
                    className="hover:bg-slate-50/70 cursor-pointer"
                  >
                    <td className="py-2.5 px-4 font-mono text-slate-900 whitespace-nowrap">
                      {rep.reportDate}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono font-semibold text-slate-900">{rep.staffUsername}</div>
                      {rep.notes && <div className="text-slate-500 truncate max-w-[200px]">{rep.notes}</div>}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {formatCents(rep.startingCashCents, rep.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700 whitespace-nowrap">
                      -{formatCents(rep.cashWithdrawalsCents, rep.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-800 whitespace-nowrap">
                      +{formatCents(rep.cashDepositsCents, rep.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {formatCents(rep.endingCashCents, rep.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
