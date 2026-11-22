import { CurrencyCode, LedgerTransaction, TransactionType } from '../types/microfinance';
import { Timestamp } from 'firebase/firestore';

const CURRENCY_LOCALES: Record<CurrencyCode, string> = {
  USD: 'en-US',
  KES: 'en-KE',
  NGN: 'en-NG',
  GHS: 'en-GH',
  EUR: 'en-IE',
  GBP: 'en-GB',
};

export function formatCents(cents: number, currency: CurrencyCode = 'USD'): string {
  const safeCents = Number.isFinite(cents) ? cents : 0;
  const amount = safeCents / 100;
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[currency] || 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function parseAmountToCents(rawValue: string): number | null {
  const cleaned = rawValue.replace(/,/g, '').trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  const cents = Math.round(parsed * 100);
  if (!Number.isSafeInteger(cents)) {
    return null;
  }
  return cents;
}

export function generateAccountNumber(prefix = 'MF'): string {
  const year = new Date().getFullYear();
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}-${year}-${suffix}`;
}

export function generateTransactionReference(type: TransactionType): string {
  const tagMap: Record<TransactionType, string> = {
    deposit: 'DEP',
    withdrawal: 'WDR',
    transfer_out: 'TRO',
    transfer_in: 'TRI',
  };
  const tag = tagMap[type] || 'TXN';
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${tag}-${rand}`;
}

export function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return 'Pending';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return 'Pending';
  }
}

export function formatShortDate(ts: Timestamp | null | undefined): string {
  if (!ts) return 'Pending';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return 'Pending';
  }
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadTransactionsCsv(transactions: LedgerTransaction[], filename: string): void {
  const headers = [
    'Date',
    'Reference',
    'Customer',
    'Account Number',
    'Operation',
    'Counterparty Account',
    'Payment Method',
    'Currency',
    'Amount',
    'Balance Before',
    'Balance After',
    'Notes',
  ];

  const rows = transactions.map((tx) => [
    formatTimestamp(tx.createdAt),
    tx.reference,
    tx.customerName,
    tx.accountNumber,
    tx.type.toUpperCase(),
    tx.counterpartyAccountNumber || '',
    tx.paymentMethod,
    tx.currency,
    (tx.amountCents / 100).toFixed(2),
    (tx.balanceBeforeCents / 100).toFixed(2),
    (tx.balanceAfterCents / 100).toFixed(2),
    tx.notes || '',
  ]);

  const csvContent = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
