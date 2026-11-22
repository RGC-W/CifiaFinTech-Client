import { Timestamp } from 'firebase/firestore';

export type PortalMode = 'officer' | 'client';
export type CurrencyCode = 'USD' | 'KES' | 'NGN' | 'GHS' | 'EUR' | 'GBP';
export type AccountType = 'savings' | 'business' | 'group_solidarity' | 'fixed_deposit';
export type AccountStatus = 'active' | 'frozen' | 'closed';
export type KycStatus = 'verified' | 'pending';
export type TransactionType = 'deposit' | 'withdrawal' | 'transfer_in' | 'transfer_out';
export type PaymentMethod = 'cash' | 'mobile_money' | 'bank_transfer' | 'cheque';

export const CURRENCY_OPTIONS: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: 'USD', label: 'USD — US Dollar', symbol: '$' },
  { code: 'KES', label: 'KES — Kenyan Shilling', symbol: 'KSh ' },
  { code: 'NGN', label: 'NGN — Nigerian Naira', symbol: '₦' },
  { code: 'GHS', label: 'GHS — Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'EUR', label: 'EUR — Euro', symbol: '€' },
  { code: 'GBP', label: 'GBP — British Pound', symbol: '£' },
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: 'Savings Account',
  business: 'Business Capital',
  group_solidarity: 'Group Solidarity',
  fixed_deposit: 'Fixed Deposit',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash Teller',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  frozen: 'Frozen',
  closed: 'Closed',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  transfer_in: 'Transfer Received',
  transfer_out: 'Transfer Sent',
};

export function isCreditTransaction(type: TransactionType): boolean {
  return type === 'deposit' || type === 'transfer_in';
}

// Synchronized verbatim with firebase-blueprint.json
export const BLUEPRINT_CONSTRAINTS = {
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  ACCOUNT_NUMBER_PATTERN: /^[A-Z0-9-]+$/,
  DISPLAY_NAME_MAX: 100,
  EMAIL_MAX: 120,
  BRANCH_NAME_MAX: 100,
  FULL_NAME_MIN: 2,
  FULL_NAME_MAX: 100,
  PHONE_MIN: 5,
  PHONE_MAX: 30,
  NATIONAL_ID_MIN: 3,
  NATIONAL_ID_MAX: 40,
  OCCUPATION_MIN: 2,
  OCCUPATION_MAX: 80,
  ADDRESS_MAX: 200,
  ACCOUNT_NUMBER_MIN: 4,
  ACCOUNT_NUMBER_MAX: 24,
  REFERENCE_MIN: 3,
  REFERENCE_MAX: 40,
  NOTES_MAX: 240,
  PASSWORD_SALT_MIN: 16,
  PASSWORD_SALT_MAX: 64,
  PASSWORD_HASH_MIN: 32,
  PASSWORD_HASH_MAX: 128,
  PROFILE_PHOTO_MAX: 220000,
  ID_CARD_PHOTO_MAX: 380000,
  KYC_IMAGE_DATA_URL_PATTERN: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,
} as const;

export const CLIENT_ACCESS_CONSTRAINTS = {
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 64,
} as const;

export type StaffRole = 'admin' | 'cat1';
export type StaffStatus = 'active' | 'disabled';
export type ClientAccessApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalRequestType =
  | 'withdrawal_over_limit'
  | 'delete_operation'
  | 'client_account_activation'
  | 'client_withdrawal';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type EmailNotificationOutcome = 'completed' | 'pending' | 'validated' | 'rejected';
export type EmailDeliveryStatus = 'sent' | 'queued_in_app' | 'failed';

export const CAT1_WITHDRAWAL_MIN_CENTS = 100; // $1.00
export const CAT1_WITHDRAWAL_MAX_CENTS = 35000; // $350.00

export const STAFF_CONSTRAINTS = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 60,
  EMAIL_MIN: 3,
  EMAIL_MAX: 120,
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 64,
  MESSAGE_MAX: 280,
} as const;

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Admin',
  cat1: 'User Cat 1',
};

export interface StaffUser {
  id: string;
  ownerId: string;
  role: StaffRole;
  username: string;
  usernameLower: string;
  email: string;
  emailLower: string;
  passwordSalt: string;
  passwordHash: string;
  status: StaffStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ApprovalRequest {
  id: string;
  ownerId: string;
  requestType: ApprovalRequestType;
  status: ApprovalStatus;
  requestedByRole?: 'admin' | 'cat1' | 'client';
  requestedByUid?: string;
  requestedByStaffId: string;
  requestedByUsername: string;
  requestedByEmail: string;
  accountId: string;
  accountNumber: string;
  customerName: string;
  amountCents: number;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  message: string;
  targetTransactionId?: string;
  targetTransactionType?: TransactionType;
  reviewedByStaffId?: string;
  reviewedByUsername?: string;
  reviewNote?: string;
  resultTransactionId?: string;
  reviewedAt?: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface DailyCashReport {
  id: string;
  ownerId: string;
  staffId: string;
  staffUsername: string;
  staffEmail: string;
  reportDate: string; // YYYY-MM-DD
  currency: CurrencyCode;
  startingCashCents: number;
  cashWithdrawalsCents: number;
  cashDepositsCents: number;
  nonCashDepositsCents: number;
  nonCashWithdrawalsCents: number;
  endingCashCents: number;
  operationCount: number;
  notes: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  branchName: string;
  defaultCurrency: CurrencyCode;
  alertThresholdCents?: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Customer {
  id: string;
  ownerId: string;
  clientUid?: string;
  customerEmail?: string;
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  occupation: string;
  address: string;
  kycStatus: KycStatus;
  profilePhotoDataUrl?: string;
  idCardPhotoDataUrl?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Account {
  id: string;
  ownerId: string;
  clientUid?: string;
  clientAccessApproved?: boolean;
  customerEmail?: string;
  customerId: string;
  customerName: string;
  accountNumber: string;
  accountType: AccountType;
  currency: CurrencyCode;
  balanceCents: number;
  totalDepositsCents: number;
  totalWithdrawalsCents: number;
  transactionCount: number;
  status: AccountStatus;
  lastTransferTxId?: string;
  lastDeletedTxId?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AccountDirectoryEntry {
  accountId: string;
  accountNumber: string;
  ownerId: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  status: AccountStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ClientAccessRecord {
  accountNumber: string;
  accountId: string;
  ownerId: string;
  clientUid: string;
  customerName: string;
  email: string;
  emailLower: string;
  approvalStatus: ClientAccessApprovalStatus;
  reviewedByStaffId?: string;
  reviewedByUsername?: string;
  reviewNote?: string;
  reviewedAt?: Timestamp | null;
  passwordSalt: string;
  passwordHash: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface EmailNotification {
  id: string;
  ownerId: string;
  recipientEmail: string;
  accountId: string;
  accountNumber: string;
  customerName: string;
  clientUid?: string;
  operationType: string;
  outcome: EmailNotificationOutcome;
  amountFormatted?: string;
  reference?: string;
  details: string;
  deliveryStatus: EmailDeliveryStatus;
  deliveryChannel?: string;
  deliveryNote?: string;
  createdByUid: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface LedgerTransaction {
  id: string;
  ownerId: string;
  clientUid?: string;
  customerEmail?: string;
  initiatedByUid?: string;
  accountId: string;
  customerId: string;
  accountNumber: string;
  customerName: string;
  type: TransactionType;
  amountCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  counterpartyAccountNumber?: string;
  counterpartyName?: string;
  transferGroupId?: string;
  pairedTxId?: string;
  staffId?: string;
  staffUsername?: string;
  staffRole?: StaffRole;
  approvalRequestId?: string;
  createdAt: Timestamp | null;
}
