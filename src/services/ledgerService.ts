import { FirebaseError } from 'firebase/app';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  Account,
  AccountDirectoryEntry,
  AccountStatus,
  AccountType,
  ApprovalRequest,
  BLUEPRINT_CONSTRAINTS,
  CAT1_WITHDRAWAL_MAX_CENTS,
  CAT1_WITHDRAWAL_MIN_CENTS,
  CLIENT_ACCESS_CONSTRAINTS,
  ClientAccessApprovalStatus,
  ClientAccessRecord,
  CurrencyCode,
  DailyCashReport,
  EmailDeliveryStatus,
  EmailNotificationOutcome,
  KycStatus,
  LedgerTransaction,
  PaymentMethod,
  STAFF_CONSTRAINTS,
  StaffRole,
  StaffStatus,
  StaffUser,
  TransactionType,
  UserProfile,
} from '../types/microfinance';
import { formatCents, generateAccountNumber, generateTransactionReference } from '../utils/currency';
import {
  generateSaltHex,
  hashPasswordPBKDF2,
  verifyPasswordPBKDF2,
} from '../utils/passwordCrypto';

function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase().slice(0, BLUEPRINT_CONSTRAINTS.EMAIL_MAX);
}

export function isValidEmailAddress(email: string): boolean {
  const clean = email.trim();
  return clean.length >= 3 && clean.length <= BLUEPRINT_CONSTRAINTS.EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
}

export class BusinessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessValidationError';
  }
}

async function resolveAccountCustomerEmail(params: {
  explicitEmail?: string | null;
  account?: Partial<Account> | null;
  accountNumber?: string;
}): Promise<string> {
  const direct = normalizeEmail(params.explicitEmail || params.account?.customerEmail);
  if (isValidEmailAddress(direct)) return direct;

  const acctNum = params.accountNumber || params.account?.accountNumber;
  if (acctNum) {
    try {
      const accessSnap = await getDoc(doc(db, 'clientAccess', acctNum));
      if (accessSnap.exists()) {
        const email = normalizeEmail((accessSnap.data() as ClientAccessRecord).emailLower);
        if (isValidEmailAddress(email)) return email;
      }
    } catch {
      // Ignore lookup fallback errors cleanly
    }
  }

  if (params.account?.customerId) {
    try {
      const custSnap = await getDoc(doc(db, 'customers', params.account.customerId));
      if (custSnap.exists()) {
        const custData = custSnap.data() as { email?: string; customerEmail?: string };
        const email = normalizeEmail(custData.customerEmail || custData.email);
        if (isValidEmailAddress(email)) return email;
      }
    } catch {
      // Ignore lookup fallback errors cleanly
    }
  }

  return '';
}

export async function dispatchCustomerEmailNotification(params: {
  ownerId: string;
  recipientEmail?: string | null;
  account?: Partial<Account> | null;
  accountId: string;
  accountNumber: string;
  customerName: string;
  clientUid?: string;
  operationType: string;
  outcome: EmailNotificationOutcome;
  amountFormatted?: string;
  reference?: string;
  details: string;
}): Promise<void> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const currentUid = currentUser.uid;

    const recipientEmail = await resolveAccountCustomerEmail({
      explicitEmail: params.recipientEmail,
      account: params.account,
      accountNumber: params.accountNumber,
    });
    if (!isValidEmailAddress(recipientEmail)) {
      return;
    }

    const notifRef = doc(collection(db, 'emailNotifications'));
    const operationType = clampString(params.operationType, 120) || 'Account Operation';
    const customerName = clampString(params.customerName || 'Customer', BLUEPRINT_CONSTRAINTS.FULL_NAME_MAX);
    const details = clampString(params.details || '', 320);
    const amountFormatted = params.amountFormatted ? clampString(params.amountFormatted, 40) : undefined;
    const reference = params.reference ? clampString(params.reference, 40) : undefined;

    const initialDoc: Record<string, unknown> = {
      ownerId: params.ownerId,
      recipientEmail,
      accountId: params.accountId,
      accountNumber: params.accountNumber,
      customerName,
      operationType,
      outcome: params.outcome,
      details,
      deliveryStatus: 'queued_in_app' as EmailDeliveryStatus,
      deliveryChannel: 'in_app_only',
      deliveryNote: 'Recorded in customer notification inbox.',
      createdByUid: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const resolvedClientUid = params.clientUid || params.account?.clientUid;
    if (resolvedClientUid && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(resolvedClientUid)) {
      initialDoc.clientUid = resolvedClientUid;
    }
    if (amountFormatted) initialDoc.amountFormatted = amountFormatted;
    if (reference) initialDoc.reference = reference;

    await setDoc(notifRef, initialDoc);
  } catch (err) {
    console.warn('Customer notification record skipped:', err);
  }
}

export async function ensureUserProfile(params: {
  uid: string;
  displayName: string;
  email: string;
}): Promise<UserProfile> {
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const payload = {
      uid: params.uid,
      displayName: clampString(params.displayName || 'Branch Officer', BLUEPRINT_CONSTRAINTS.DISPLAY_NAME_MAX),
      email: clampString(params.email || 'officer@cairn.local', BLUEPRINT_CONSTRAINTS.EMAIL_MAX),
      branchName: 'Central Microfinance Branch',
      defaultCurrency: 'USD' as CurrencyCode,
      alertThresholdCents: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(ref, payload);
    const created = await getDoc(ref);
    return created.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: {
    displayName: string;
    branchName: string;
    defaultCurrency: CurrencyCode;
    alertThresholdCents: number;
  },
  email: string,
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  const displayName = clampString(updates.displayName, BLUEPRINT_CONSTRAINTS.DISPLAY_NAME_MAX);
  const branchName = clampString(updates.branchName, BLUEPRINT_CONSTRAINTS.BRANCH_NAME_MAX);

  if (!displayName) throw new BusinessValidationError('Officer display name is required.');
  if (!branchName) throw new BusinessValidationError('Branch name is required.');
  if (!Number.isSafeInteger(updates.alertThresholdCents) || updates.alertThresholdCents < 0) {
    throw new BusinessValidationError('Alert threshold must be zero or a positive currency amount.');
  }

  try {
    await updateDoc(ref, {
      displayName,
      email: clampString(email, BLUEPRINT_CONSTRAINTS.EMAIL_MAX),
      branchName,
      defaultCurrency: updates.defaultCurrency,
      alertThresholdCents: updates.alertThresholdCents,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface CustomerInput {
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  occupation: string;
  address: string;
  kycStatus: KycStatus;
  profilePhotoDataUrl?: string | null;
  idCardPhotoDataUrl?: string | null;
  clientUid?: string;
}

function validateOptionalKycImage(
  value: string | null | undefined,
  maxChars: number,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new BusinessValidationError(`${label} exceeds the maximum allowed size.`);
  }
  if (!BLUEPRINT_CONSTRAINTS.KYC_IMAGE_DATA_URL_PATTERN.test(trimmed)) {
    throw new BusinessValidationError(`${label} must be a valid JPEG, PNG, or WebP image.`);
  }
  return trimmed;
}

export async function createCustomer(ownerId: string, input: CustomerInput): Promise<string> {
  const fullName = clampString(input.fullName, BLUEPRINT_CONSTRAINTS.FULL_NAME_MAX);
  const phone = clampString(input.phone, BLUEPRINT_CONSTRAINTS.PHONE_MAX);
  const email = clampString(input.email, BLUEPRINT_CONSTRAINTS.EMAIL_MAX);
  const customerEmail = normalizeEmail(email);
  const nationalId = clampString(input.nationalId, BLUEPRINT_CONSTRAINTS.NATIONAL_ID_MAX);
  const occupation = clampString(input.occupation, BLUEPRINT_CONSTRAINTS.OCCUPATION_MAX);
  const address = clampString(input.address, BLUEPRINT_CONSTRAINTS.ADDRESS_MAX);

  if (fullName.length < BLUEPRINT_CONSTRAINTS.FULL_NAME_MIN) {
    throw new BusinessValidationError('Customer full name must be at least 2 characters.');
  }
  if (phone.length < BLUEPRINT_CONSTRAINTS.PHONE_MIN) {
    throw new BusinessValidationError('Phone number must be at least 5 characters.');
  }
  if (nationalId.length < BLUEPRINT_CONSTRAINTS.NATIONAL_ID_MIN) {
    throw new BusinessValidationError('National ID / KYC reference must be at least 3 characters.');
  }
  if (occupation.length < BLUEPRINT_CONSTRAINTS.OCCUPATION_MIN) {
    throw new BusinessValidationError('Occupation or enterprise must be at least 2 characters.');
  }

  const profilePhoto = validateOptionalKycImage(
    input.profilePhotoDataUrl,
    BLUEPRINT_CONSTRAINTS.PROFILE_PHOTO_MAX,
    'Customer profile photo',
  );
  const idCardPhoto = validateOptionalKycImage(
    input.idCardPhotoDataUrl,
    BLUEPRINT_CONSTRAINTS.ID_CARD_PHOTO_MAX,
    'Customer ID card photo',
  );

  const customerRef = doc(collection(db, 'customers'));
  const path = `customers/${customerRef.id}`;

  const payload: Record<string, unknown> = {
    ownerId,
    customerEmail,
    fullName,
    phone,
    email,
    nationalId,
    occupation,
    address,
    kycStatus: input.kycStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (profilePhoto) {
    payload.profilePhotoDataUrl = profilePhoto;
  }
  if (idCardPhoto) {
    payload.idCardPhotoDataUrl = idCardPhoto;
  }
  if (input.clientUid && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(input.clientUid)) {
    payload.clientUid = input.clientUid;
  }

  try {
    await setDoc(customerRef, payload);
    return customerRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCustomer(
  ownerId: string,
  customerId: string,
  input: CustomerInput,
  linkedAccounts: Account[],
): Promise<void> {
  const fullName = clampString(input.fullName, BLUEPRINT_CONSTRAINTS.FULL_NAME_MAX);
  const phone = clampString(input.phone, BLUEPRINT_CONSTRAINTS.PHONE_MAX);
  const email = clampString(input.email, BLUEPRINT_CONSTRAINTS.EMAIL_MAX);
  const customerEmail = normalizeEmail(email);
  const nationalId = clampString(input.nationalId, BLUEPRINT_CONSTRAINTS.NATIONAL_ID_MAX);
  const occupation = clampString(input.occupation, BLUEPRINT_CONSTRAINTS.OCCUPATION_MAX);
  const address = clampString(input.address, BLUEPRINT_CONSTRAINTS.ADDRESS_MAX);

  if (fullName.length < BLUEPRINT_CONSTRAINTS.FULL_NAME_MIN) {
    throw new BusinessValidationError('Customer full name must be at least 2 characters.');
  }
  if (phone.length < BLUEPRINT_CONSTRAINTS.PHONE_MIN) {
    throw new BusinessValidationError('Phone number must be at least 5 characters.');
  }
  if (nationalId.length < BLUEPRINT_CONSTRAINTS.NATIONAL_ID_MIN) {
    throw new BusinessValidationError('National ID must be at least 3 characters.');
  }
  if (occupation.length < BLUEPRINT_CONSTRAINTS.OCCUPATION_MIN) {
    throw new BusinessValidationError('Occupation must be at least 2 characters.');
  }

  const profilePhoto = validateOptionalKycImage(
    input.profilePhotoDataUrl,
    BLUEPRINT_CONSTRAINTS.PROFILE_PHOTO_MAX,
    'Customer profile photo',
  );
  const idCardPhoto = validateOptionalKycImage(
    input.idCardPhotoDataUrl,
    BLUEPRINT_CONSTRAINTS.ID_CARD_PHOTO_MAX,
    'Customer ID card photo',
  );

  const batch = writeBatch(db);
  const customerRef = doc(db, 'customers', customerId);
  const customerUpdate: Record<string, unknown> = {
    fullName,
    phone,
    email,
    customerEmail,
    nationalId,
    occupation,
    address,
    kycStatus: input.kycStatus,
    updatedAt: serverTimestamp(),
  };

  if (profilePhoto !== undefined) {
    customerUpdate.profilePhotoDataUrl = profilePhoto ?? deleteField();
  }
  if (idCardPhoto !== undefined) {
    customerUpdate.idCardPhotoDataUrl = idCardPhoto ?? deleteField();
  }

  batch.update(customerRef, customerUpdate);

  for (const acct of linkedAccounts) {
    if (acct.ownerId === ownerId && (acct.customerName !== fullName || (acct.customerEmail || '') !== customerEmail)) {
      batch.update(doc(db, 'accounts', acct.id), {
        customerName: fullName,
        customerEmail,
        updatedAt: serverTimestamp(),
      });
      if (acct.customerName !== fullName) {
        batch.set(
          doc(db, 'accountDirectory', acct.accountNumber),
          {
            accountId: acct.id,
            accountNumber: acct.accountNumber,
            ownerId: acct.ownerId,
            customerId: acct.customerId,
            customerName: fullName,
            currency: acct.currency,
            status: acct.status,
            createdAt: acct.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `customers/${customerId}`);
  }
}

export async function deleteCustomer(customerId: string, linkedAccountsCount: number): Promise<void> {
  if (linkedAccountsCount > 0) {
    throw new BusinessValidationError(
      'Customers with existing accounts cannot be deleted. Close any zero-balance accounts first.',
    );
  }
  const path = `customers/${customerId}`;
  try {
    await deleteDoc(doc(db, 'customers', customerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface CreateAccountInput {
  ownerId: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  clientUid?: string;
  accountNumber: string;
  accountType: AccountType;
  currency: CurrencyCode;
  openingDepositCents: number;
  paymentMethod: PaymentMethod;
  notes: string;
  staffId?: string;
  staffUsername?: string;
  staffRole?: StaffRole;
}

export async function createAccountWithOptionalDeposit(input: CreateAccountInput): Promise<string> {
  const accountNumber = clampString(
    input.accountNumber.toUpperCase(),
    BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX,
  );
  const customerName = clampString(input.customerName, BLUEPRINT_CONSTRAINTS.FULL_NAME_MAX);
  const customerEmail = normalizeEmail(input.customerEmail);
  const notes = clampString(input.notes || 'Opening account deposit', BLUEPRINT_CONSTRAINTS.NOTES_MAX);

  if (
    accountNumber.length < BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MIN ||
    !BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_PATTERN.test(accountNumber)
  ) {
    throw new BusinessValidationError(
      'Account number must be 4-24 uppercase alphanumeric characters or hyphens.',
    );
  }
  if (!Number.isSafeInteger(input.openingDepositCents) || input.openingDepositCents < 0) {
    throw new BusinessValidationError('Opening deposit cannot be negative.');
  }

  const batch = writeBatch(db);
  const accountRef = doc(collection(db, 'accounts'));
  const hasOpeningDeposit = input.openingDepositCents > 0;

  const accountPayload: Record<string, unknown> = {
    ownerId: input.ownerId,
    customerId: input.customerId,
    customerName,
    customerEmail,
    accountNumber,
    accountType: input.accountType,
    currency: input.currency,
    balanceCents: input.openingDepositCents,
    totalDepositsCents: input.openingDepositCents,
    totalWithdrawalsCents: 0,
    transactionCount: hasOpeningDeposit ? 1 : 0,
    status: 'active' as AccountStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.clientUid && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(input.clientUid)) {
    accountPayload.clientUid = input.clientUid;
  }

  batch.set(accountRef, accountPayload);

  batch.set(doc(db, 'accountDirectory', accountNumber), {
    accountId: accountRef.id,
    accountNumber,
    ownerId: input.ownerId,
    customerId: input.customerId,
    customerName,
    currency: input.currency,
    status: 'active' as AccountStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  let openingReference = '';
  if (hasOpeningDeposit) {
    openingReference = generateTransactionReference('deposit');
    const txRef = doc(collection(db, 'transactions'));
    const txPayload: Record<string, unknown> = {
      ownerId: input.ownerId,
      customerEmail,
      accountId: accountRef.id,
      customerId: input.customerId,
      accountNumber,
      customerName,
      type: 'deposit' as TransactionType,
      amountCents: input.openingDepositCents,
      balanceBeforeCents: 0,
      balanceAfterCents: input.openingDepositCents,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      reference: openingReference,
      notes,
      createdAt: serverTimestamp(),
    };
    if (input.clientUid && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(input.clientUid)) {
      txPayload.clientUid = input.clientUid;
    }
    if (input.staffId && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(input.staffId)) {
      txPayload.staffId = input.staffId;
    }
    if (input.staffUsername) {
      txPayload.staffUsername = clampString(input.staffUsername, STAFF_CONSTRAINTS.USERNAME_MAX);
    }
    if (input.staffRole) {
      txPayload.staffRole = input.staffRole;
    }
    batch.set(txRef, txPayload);
  }

  try {
    await batch.commit();
    if (hasOpeningDeposit) {
      await dispatchCustomerEmailNotification({
        ownerId: input.ownerId,
        recipientEmail: customerEmail,
        accountId: accountRef.id,
        accountNumber,
        customerName,
        clientUid: input.clientUid,
        operationType: 'Opening Account Deposit',
        outcome: 'completed',
        amountFormatted: formatCents(input.openingDepositCents, input.currency),
        reference: openingReference,
        details: `Account ${accountNumber} opened with an initial deposit of ${formatCents(input.openingDepositCents, input.currency)}.`,
      });
    }
    return accountRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `accounts/${accountRef.id}`);
  }
}

export interface RecordTransactionInput {
  actorUid?: string;
  ownerId?: string;
  accountId: string;
  type: 'deposit' | 'withdrawal';
  amountCents: number;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  staffId?: string;
  staffUsername?: string;
  staffRole?: StaffRole;
  approvalRequestId?: string;
}

export async function recordLedgerTransaction(input: RecordTransactionInput): Promise<{
  transactionId: string;
  balanceBeforeCents: number;
  balanceAfterCents: number;
}> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new BusinessValidationError('Operation amount must be greater than zero.');
  }
  if (
    input.staffRole === 'cat1' &&
    input.type === 'withdrawal' &&
    !input.approvalRequestId
  ) {
    if (input.amountCents < CAT1_WITHDRAWAL_MIN_CENTS) {
      throw new BusinessValidationError(
        'User Cat 1 withdrawals must be at least $1.00 (100 cents).',
      );
    }
    if (input.amountCents > CAT1_WITHDRAWAL_MAX_CENTS) {
      throw new BusinessValidationError(
        'Withdrawals over $350.00 require Admin validation. Send a validation request to the Admin.',
      );
    }
  }

  const reference = clampString(
    input.reference || generateTransactionReference(input.type),
    BLUEPRINT_CONSTRAINTS.REFERENCE_MAX,
  );
  if (reference.length < BLUEPRINT_CONSTRAINTS.REFERENCE_MIN) {
    throw new BusinessValidationError('Receipt reference must be at least 3 characters.');
  }
  const notes = clampString(input.notes || '', BLUEPRINT_CONSTRAINTS.NOTES_MAX);

  const accountRef = doc(db, 'accounts', input.accountId);
  const txRef = doc(collection(db, 'transactions'));

  try {
    const result = await runTransaction(db, async (tx) => {
      const accountSnap = await tx.get(accountRef);
      if (!accountSnap.exists()) {
        throw new BusinessValidationError('Selected customer account was not found.');
      }

      const account = accountSnap.data() as Omit<Account, 'id'>;
      if (account.status !== 'active') {
        throw new BusinessValidationError(
          `Cannot process ${input.type} on a ${account.status} account.`,
        );
      }

      const balanceBeforeCents = account.balanceCents;
      if (input.type === 'withdrawal' && balanceBeforeCents < input.amountCents) {
        throw new BusinessValidationError(
          `Insufficient balance. Available funds: ${(balanceBeforeCents / 100).toFixed(2)} ${account.currency}.`,
        );
      }

      const balanceAfterCents =
        input.type === 'deposit'
          ? balanceBeforeCents + input.amountCents
          : balanceBeforeCents - input.amountCents;

      const totalDepositsCents =
        input.type === 'deposit'
          ? account.totalDepositsCents + input.amountCents
          : account.totalDepositsCents;

      const totalWithdrawalsCents =
        input.type === 'withdrawal'
          ? account.totalWithdrawalsCents + input.amountCents
          : account.totalWithdrawalsCents;

      tx.update(accountRef, {
        balanceCents: balanceAfterCents,
        totalDepositsCents,
        totalWithdrawalsCents,
        transactionCount: account.transactionCount + 1,
        updatedAt: serverTimestamp(),
      });

      const txPayload: Record<string, unknown> = {
        ownerId: account.ownerId,
        accountId: input.accountId,
        customerId: account.customerId,
        accountNumber: account.accountNumber,
        customerName: account.customerName,
        type: input.type,
        amountCents: input.amountCents,
        balanceBeforeCents,
        balanceAfterCents,
        currency: account.currency,
        paymentMethod: input.paymentMethod,
        reference,
        notes,
        createdAt: serverTimestamp(),
      };

      if (account.customerEmail) {
        txPayload.customerEmail = account.customerEmail;
      }
      if (account.clientUid) {
        txPayload.clientUid = account.clientUid;
      }
      if (input.actorUid) {
        txPayload.initiatedByUid = input.actorUid;
      }
      if (input.staffId && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(input.staffId)) {
        txPayload.staffId = input.staffId;
      }
      if (input.staffUsername) {
        txPayload.staffUsername = clampString(input.staffUsername, STAFF_CONSTRAINTS.USERNAME_MAX);
      }
      if (input.staffRole) {
        txPayload.staffRole = input.staffRole;
      }
      if (input.approvalRequestId && BLUEPRINT_CONSTRAINTS.ID_PATTERN.test(input.approvalRequestId)) {
        txPayload.approvalRequestId = input.approvalRequestId;
      }

      tx.set(txRef, txPayload);

      return {
        transactionId: txRef.id,
        balanceBeforeCents,
        balanceAfterCents,
        accountSnapshot: account,
      };
    });

    await dispatchCustomerEmailNotification({
      ownerId: result.accountSnapshot.ownerId,
      account: result.accountSnapshot,
      accountId: input.accountId,
      accountNumber: result.accountSnapshot.accountNumber,
      customerName: result.accountSnapshot.customerName,
      operationType: input.type === 'deposit' ? 'Deposit' : 'Withdrawal',
      outcome: 'completed',
      amountFormatted: formatCents(input.amountCents, result.accountSnapshot.currency),
      reference,
      details: `${input.type === 'deposit' ? 'Deposit' : 'Withdrawal'} processed (${input.paymentMethod.replace('_', ' ')}). Updated balance: ${formatCents(result.balanceAfterCents, result.accountSnapshot.currency)}.`,
    });

    return {
      transactionId: result.transactionId,
      balanceBeforeCents: result.balanceBeforeCents,
      balanceAfterCents: result.balanceAfterCents,
    };
  } catch (error) {
    if (error instanceof BusinessValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `accounts/${input.accountId}`);
  }
}

export async function lookupAccountByNumber(
  rawAccountNumber: string,
): Promise<AccountDirectoryEntry | null> {
  const clean = clampString(
    rawAccountNumber.toUpperCase(),
    BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX,
  );
  if (
    clean.length < BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MIN ||
    !BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_PATTERN.test(clean)
  ) {
    return null;
  }

  try {
    const snap = await getDoc(doc(db, 'accountDirectory', clean));
    if (!snap.exists()) return null;
    return snap.data() as AccountDirectoryEntry;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `accountDirectory/${clean}`);
  }
}

export async function ensureDirectorySynced(accounts: Account[], currentUid: string): Promise<void> {
  const owned = accounts.filter((a) => a.ownerId === currentUid);
  if (owned.length === 0) return;

  for (const acct of owned) {
    try {
      const dirRef = doc(db, 'accountDirectory', acct.accountNumber);
      const existing = await getDoc(dirRef);
      if (!existing.exists()) {
        await setDoc(dirRef, {
          accountId: acct.id,
          accountNumber: acct.accountNumber,
          ownerId: acct.ownerId,
          customerId: acct.customerId,
          customerName: acct.customerName,
          currency: acct.currency,
          status: acct.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn(`Directory sync skipped for ${acct.accountNumber}:`, err);
    }
  }
}

export interface TransferInput {
  initiatorUid: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  reference?: string;
  notes: string;
}

export async function transferBetweenAccounts(input: TransferInput): Promise<{
  transferOutId: string;
  transferInId: string;
  sourceBalanceAfterCents: number;
  destinationAccountNumber: string;
  destinationCustomerName: string;
}> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new BusinessValidationError('Transfer amount must be greater than zero.');
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new BusinessValidationError('Source and destination accounts must be different.');
  }

  const notes = clampString(input.notes || 'Account transfer', BLUEPRINT_CONSTRAINTS.NOTES_MAX);
  const transferGroupRef = doc(collection(db, 'transactions'));
  const transferGroupId = transferGroupRef.id;
  const txOutRef = doc(collection(db, 'transactions'));
  const txInRef = doc(collection(db, 'transactions'));
  const outRefString = clampString(
    input.reference || generateTransactionReference('transfer_out'),
    BLUEPRINT_CONSTRAINTS.REFERENCE_MAX,
  );
  const inRefString = generateTransactionReference('transfer_in');

  const sourceRef = doc(db, 'accounts', input.sourceAccountId);
  const destRef = doc(db, 'accounts', input.destinationAccountId);

  try {
    const result = await runTransaction(db, async (tx) => {
      const [sourceSnap, destSnap] = await Promise.all([tx.get(sourceRef), tx.get(destRef)]);

      if (!sourceSnap.exists()) {
        throw new BusinessValidationError('Source account was not found.');
      }
      if (!destSnap.exists()) {
        throw new BusinessValidationError('Destination account was not found.');
      }

      const source = sourceSnap.data() as Omit<Account, 'id'>;
      const dest = destSnap.data() as Omit<Account, 'id'>;

      if (source.ownerId !== input.initiatorUid && !source.clientAccessApproved) {
        throw new BusinessValidationError(
          'Your Client App account is awaiting Branch Admin validation before transfers are permitted.',
        );
      }
      if (source.status !== 'active') {
        throw new BusinessValidationError(`Source account is ${source.status} and cannot send funds.`);
      }
      if (dest.status !== 'active') {
        throw new BusinessValidationError(`Destination account (${dest.accountNumber}) is ${dest.status} and cannot receive funds.`);
      }
      if (source.currency !== dest.currency) {
        throw new BusinessValidationError(
          `Currency mismatch: source is ${source.currency} while recipient is ${dest.currency}.`,
        );
      }
      if (source.balanceCents < input.amountCents) {
        throw new BusinessValidationError(
          `Insufficient balance. Available funds: ${(source.balanceCents / 100).toFixed(2)} ${source.currency}.`,
        );
      }

      const srcBefore = source.balanceCents;
      const srcAfter = srcBefore - input.amountCents;
      const dstBefore = dest.balanceCents;
      const dstAfter = dstBefore + input.amountCents;

      tx.update(sourceRef, {
        balanceCents: srcAfter,
        totalWithdrawalsCents: source.totalWithdrawalsCents + input.amountCents,
        transactionCount: source.transactionCount + 1,
        updatedAt: serverTimestamp(),
      });

      tx.update(destRef, {
        balanceCents: dstAfter,
        totalDepositsCents: dest.totalDepositsCents + input.amountCents,
        transactionCount: dest.transactionCount + 1,
        lastTransferTxId: txInRef.id,
        updatedAt: serverTimestamp(),
      });

      const txOutPayload: Record<string, unknown> = {
        ownerId: source.ownerId,
        initiatedByUid: input.initiatorUid,
        accountId: input.sourceAccountId,
        customerId: source.customerId,
        accountNumber: source.accountNumber,
        customerName: source.customerName,
        type: 'transfer_out' as TransactionType,
        amountCents: input.amountCents,
        balanceBeforeCents: srcBefore,
        balanceAfterCents: srcAfter,
        currency: source.currency,
        paymentMethod: 'bank_transfer' as PaymentMethod,
        reference: outRefString,
        notes,
        counterpartyAccountNumber: dest.accountNumber,
        counterpartyName: dest.customerName,
        transferGroupId,
        pairedTxId: txInRef.id,
        createdAt: serverTimestamp(),
      };
      if (source.customerEmail) txOutPayload.customerEmail = source.customerEmail;
      if (source.clientUid) txOutPayload.clientUid = source.clientUid;

      const txInPayload: Record<string, unknown> = {
        ownerId: dest.ownerId,
        initiatedByUid: input.initiatorUid,
        accountId: input.destinationAccountId,
        customerId: dest.customerId,
        accountNumber: dest.accountNumber,
        customerName: dest.customerName,
        type: 'transfer_in' as TransactionType,
        amountCents: input.amountCents,
        balanceBeforeCents: dstBefore,
        balanceAfterCents: dstAfter,
        currency: dest.currency,
        paymentMethod: 'bank_transfer' as PaymentMethod,
        reference: inRefString,
        notes,
        counterpartyAccountNumber: source.accountNumber,
        counterpartyName: source.customerName,
        transferGroupId,
        pairedTxId: txOutRef.id,
        createdAt: serverTimestamp(),
      };
      if (dest.customerEmail) txInPayload.customerEmail = dest.customerEmail;
      if (dest.clientUid) txInPayload.clientUid = dest.clientUid;

      tx.set(txOutRef, txOutPayload);
      tx.set(txInRef, txInPayload);

      return {
        transferOutId: txOutRef.id,
        transferInId: txInRef.id,
        sourceBalanceAfterCents: srcAfter,
        destinationBalanceAfterCents: dstAfter,
        destinationAccountNumber: dest.accountNumber,
        destinationCustomerName: dest.customerName,
        sourceSnapshot: source,
        destSnapshot: dest,
      };
    });

    await dispatchCustomerEmailNotification({
      ownerId: result.sourceSnapshot.ownerId,
      account: result.sourceSnapshot,
      accountId: input.sourceAccountId,
      accountNumber: result.sourceSnapshot.accountNumber,
      customerName: result.sourceSnapshot.customerName,
      operationType: 'Transfer Sent',
      outcome: 'completed',
      amountFormatted: formatCents(input.amountCents, result.sourceSnapshot.currency),
      reference: outRefString,
      details: `Sent ${formatCents(input.amountCents, result.sourceSnapshot.currency)} to ${result.destinationCustomerName} (${result.destinationAccountNumber}). Remaining balance: ${formatCents(result.sourceBalanceAfterCents, result.sourceSnapshot.currency)}.`,
    });

    await dispatchCustomerEmailNotification({
      ownerId: result.destSnapshot.ownerId,
      account: result.destSnapshot,
      accountId: input.destinationAccountId,
      accountNumber: result.destSnapshot.accountNumber,
      customerName: result.destSnapshot.customerName,
      operationType: 'Transfer Received',
      outcome: 'completed',
      amountFormatted: formatCents(input.amountCents, result.destSnapshot.currency),
      reference: inRefString,
      details: `Received ${formatCents(input.amountCents, result.destSnapshot.currency)} from ${result.sourceSnapshot.customerName} (${result.sourceSnapshot.accountNumber}). Updated balance: ${formatCents(result.destinationBalanceAfterCents, result.destSnapshot.currency)}.`,
    });

    return {
      transferOutId: result.transferOutId,
      transferInId: result.transferInId,
      sourceBalanceAfterCents: result.sourceBalanceAfterCents,
      destinationAccountNumber: result.destinationAccountNumber,
      destinationCustomerName: result.destinationCustomerName,
    };
  } catch (error) {
    if (error instanceof BusinessValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `transfers/${input.sourceAccountId}`);
  }
}

export async function updateAccountStatus(
  account: Account,
  nextStatus: AccountStatus,
): Promise<void> {
  if (account.status === 'closed') {
    throw new BusinessValidationError('Closed accounts cannot be reopened.');
  }
  if (nextStatus === 'closed' && account.balanceCents > 0) {
    throw new BusinessValidationError(
      'Account balance must be zero before closing. Withdraw remaining funds first.',
    );
  }
  if (account.status === nextStatus) return;

  const path = `accounts/${account.id}`;
  const batch = writeBatch(db);
  batch.update(doc(db, 'accounts', account.id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'accountDirectory', account.accountNumber), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createClientAccountAccess(params: {
  uid: string;
  email: string;
  accountNumber: string;
  password: string;
}): Promise<{
  accountId: string;
  accountNumber: string;
  customerName: string;
  email: string;
  approvalStatus: ClientAccessApprovalStatus;
}> {
  const email = clampString(params.email, BLUEPRINT_CONSTRAINTS.EMAIL_MAX);
  const emailLower = normalizeEmail(email);
  if (!isValidEmailAddress(emailLower)) {
    throw new BusinessValidationError('Please enter a valid customer email address.');
  }

  const cleanAccountNumber = clampString(
    params.accountNumber.toUpperCase(),
    BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX,
  );
  if (
    cleanAccountNumber.length < BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MIN ||
    !BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_PATTERN.test(cleanAccountNumber)
  ) {
    throw new BusinessValidationError(
      'Enter a valid Main App Account ID (for example MF-2026-48219).',
    );
  }
  if (
    params.password.length < CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN ||
    params.password.length > CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX
  ) {
    throw new BusinessValidationError(
      `Password must be between ${CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN} and ${CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX} characters.`,
    );
  }

  const dirEntry = await lookupAccountByNumber(cleanAccountNumber);
  if (!dirEntry) {
    throw new BusinessValidationError(
      'No Main App account was found with that Account ID. Please verify the Account ID opened by your branch officer.',
    );
  }
  if (dirEntry.status === 'closed') {
    throw new BusinessValidationError(
      'This Main App account is closed and cannot be enrolled in the Client App.',
    );
  }

  const accessRef = doc(db, 'clientAccess', cleanAccountNumber);
  try {
    const existingAccess = await getDoc(accessRef);
    if (existingAccess.exists()) {
      const existingData = existingAccess.data() as ClientAccessRecord;
      if (existingData.approvalStatus === 'pending') {
        throw new BusinessValidationError(
          'Your Client App registration for this Account ID is already pending Branch Admin validation.',
        );
      }
      if (existingData.approvalStatus === 'rejected') {
        throw new BusinessValidationError(
          'Your previous registration for this Account ID was declined by the Branch Admin. Please contact your branch officer.',
        );
      }
      throw new BusinessValidationError(
        'A Client App account is already activated for this Account ID. Please sign in instead.',
      );
    }
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      throw new BusinessValidationError(
        'A Client App account already exists for this Account ID.',
      );
    }
    handleFirestoreError(err, OperationType.GET, `clientAccess/${cleanAccountNumber}`);
  }

  const passwordSalt = generateSaltHex();
  const passwordHash = await hashPasswordPBKDF2(params.password, passwordSalt);
  const reqRef = doc(collection(db, 'approvalRequests'));
  const reference = generateTransactionReference('deposit').replace('DEP-', 'REG-');

  const batch = writeBatch(db);
  batch.set(accessRef, {
    accountNumber: cleanAccountNumber,
    accountId: dirEntry.accountId,
    ownerId: dirEntry.ownerId,
    clientUid: params.uid,
    customerName: dirEntry.customerName,
    email,
    emailLower,
    approvalStatus: 'pending' as ClientAccessApprovalStatus,
    passwordSalt,
    passwordHash,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(reqRef, {
    ownerId: dirEntry.ownerId,
    requestType: 'client_account_activation',
    status: 'pending',
    requestedByRole: 'client',
    requestedByUid: params.uid,
    requestedByStaffId: `client_${params.uid}`,
    requestedByUsername: clampString(dirEntry.customerName, STAFF_CONSTRAINTS.USERNAME_MAX),
    requestedByEmail: emailLower,
    accountId: dirEntry.accountId,
    accountNumber: cleanAccountNumber,
    customerName: dirEntry.customerName,
    amountCents: 0,
    currency: dirEntry.currency,
    paymentMethod: 'bank_transfer' as PaymentMethod,
    reference,
    notes: 'New Client App registration submitted for Admin validation.',
    message: clampString(
      `Customer ${dirEntry.customerName} (${emailLower}) requested Client App access for Main App account ${cleanAccountNumber}. Validate before enabling access.`,
      STAFF_CONSTRAINTS.MESSAGE_MAX,
    ),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();

    await dispatchCustomerEmailNotification({
      ownerId: dirEntry.ownerId,
      recipientEmail: emailLower,
      accountId: dirEntry.accountId,
      accountNumber: cleanAccountNumber,
      customerName: dirEntry.customerName,
      clientUid: params.uid,
      operationType: 'Client Account Registration',
      outcome: 'pending',
      reference,
      details: `Your Client App registration for Main App account ${cleanAccountNumber} has been submitted and is awaiting Branch Admin validation before you can access your account.`,
    });

    return {
      accountId: dirEntry.accountId,
      accountNumber: dirEntry.accountNumber,
      customerName: dirEntry.customerName,
      email: emailLower,
      approvalStatus: 'pending',
    };
  } catch (err) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      throw new BusinessValidationError(
        'Unable to submit Client App registration. Confirm the Account ID is active in the Main App and not already enrolled.',
      );
    }
    handleFirestoreError(err, OperationType.WRITE, `clientAccess/${cleanAccountNumber}`);
  }
}

export async function verifyClientAccountLogin(params: {
  uid: string;
  accountNumber: string;
  password: string;
}): Promise<{
  accountId: string;
  accountNumber: string;
  customerName: string;
  email: string;
  approvalStatus: ClientAccessApprovalStatus;
  reviewNote?: string;
}> {
  const cleanAccountNumber = clampString(
    params.accountNumber.toUpperCase(),
    BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX,
  );
  if (
    cleanAccountNumber.length < BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MIN ||
    !BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_PATTERN.test(cleanAccountNumber)
  ) {
    throw new BusinessValidationError(
      'Enter a valid Main App Account ID (for example MF-2026-48219).',
    );
  }
  if (!params.password) {
    throw new BusinessValidationError('Enter your Client App password.');
  }

  const accessRef = doc(db, 'clientAccess', cleanAccountNumber);
  let accessSnap;
  try {
    accessSnap = await getDoc(accessRef);
  } catch (err) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      throw new BusinessValidationError(
        'This Client App account is registered under a different Google sign-in.',
      );
    }
    handleFirestoreError(err, OperationType.GET, `clientAccess/${cleanAccountNumber}`);
  }

  if (!accessSnap.exists()) {
    throw new BusinessValidationError(
      'No Client App account found for this Account ID. Switch to "Create Client Account" to register.',
    );
  }

  const accessData = accessSnap.data() as ClientAccessRecord;
  if (accessData.clientUid !== params.uid) {
    throw new BusinessValidationError(
      'This Client App account is registered under a different Google sign-in.',
    );
  }

  const isMatch = await verifyPasswordPBKDF2(
    params.password,
    accessData.passwordSalt,
    accessData.passwordHash,
  );
  if (!isMatch) {
    throw new BusinessValidationError('Incorrect password for this Account ID.');
  }

  return {
    accountId: accessData.accountId,
    accountNumber: accessData.accountNumber,
    customerName: accessData.customerName,
    email: accessData.emailLower || accessData.email,
    approvalStatus: accessData.approvalStatus || 'pending',
    reviewNote: accessData.reviewNote,
  };
}

export async function requestClientWithdrawal(params: {
  clientUid: string;
  clientEmail: string;
  account: Account;
  amountCents: number;
  paymentMethod: PaymentMethod;
  notes: string;
  pendingReservedCents?: number;
}): Promise<{ requestId: string; reference: string }> {
  if (!params.account.clientAccessApproved) {
    throw new BusinessValidationError(
      'Your Client App account must be validated by the Branch Admin before initiating withdrawals.',
    );
  }
  if (params.account.status !== 'active') {
    throw new BusinessValidationError(
      `Account ${params.account.accountNumber} is ${params.account.status} and cannot process withdrawals.`,
    );
  }
  if (!Number.isSafeInteger(params.amountCents) || params.amountCents <= 0) {
    throw new BusinessValidationError('Withdrawal amount must be greater than zero.');
  }

  const pendingReserved = Math.max(0, params.pendingReservedCents ?? 0);
  const availableAfterPending = Math.max(0, params.account.balanceCents - pendingReserved);
  if (params.amountCents > params.account.balanceCents || params.amountCents > availableAfterPending) {
    throw new BusinessValidationError(
      `Insufficient available balance. Available for withdrawal: ${formatCents(availableAfterPending, params.account.currency)}.`,
    );
  }

  const reference = generateTransactionReference('withdrawal');
  const notes = clampString(params.notes || 'Client self-service withdrawal request', BLUEPRINT_CONSTRAINTS.NOTES_MAX);
  const emailLower = normalizeEmail(params.clientEmail || params.account.customerEmail);
  const reqRef = doc(collection(db, 'approvalRequests'));

  try {
    await setDoc(reqRef, {
      ownerId: params.account.ownerId,
      requestType: 'client_withdrawal',
      status: 'pending',
      requestedByRole: 'client',
      requestedByUid: params.clientUid,
      requestedByStaffId: `client_${params.clientUid}`,
      requestedByUsername: clampString(params.account.customerName, STAFF_CONSTRAINTS.USERNAME_MAX),
      requestedByEmail: emailLower || 'client@cairn.local',
      accountId: params.account.id,
      accountNumber: params.account.accountNumber,
      customerName: params.account.customerName,
      amountCents: params.amountCents,
      currency: params.account.currency,
      paymentMethod: params.paymentMethod,
      reference,
      notes,
      message: clampString(
        `Client ${params.account.customerName} requested a withdrawal of ${formatCents(params.amountCents, params.account.currency)} from ${params.account.accountNumber}. Branch Admin or User Cat 1 confirmation required before debiting.`,
        STAFF_CONSTRAINTS.MESSAGE_MAX,
      ),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await dispatchCustomerEmailNotification({
      ownerId: params.account.ownerId,
      recipientEmail: emailLower,
      account: params.account,
      accountId: params.account.id,
      accountNumber: params.account.accountNumber,
      customerName: params.account.customerName,
      clientUid: params.clientUid,
      operationType: 'Client Withdrawal Request',
      outcome: 'pending',
      amountFormatted: formatCents(params.amountCents, params.account.currency),
      reference,
      details: `Your withdrawal request of ${formatCents(params.amountCents, params.account.currency)} has been submitted and awaits branch officer confirmation before your account is debited.`,
    });

    return { requestId: reqRef.id, reference };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `approvalRequests/${reqRef.id}`);
  }
}

export async function updateClientAccountPassword(params: {
  uid: string;
  accountNumber: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const cleanAccountNumber = clampString(
    params.accountNumber.toUpperCase(),
    BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX,
  );
  if (
    params.newPassword.length < CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN ||
    params.newPassword.length > CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX
  ) {
    throw new BusinessValidationError(
      `New password must be between ${CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN} and ${CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX} characters.`,
    );
  }

  const accessRef = doc(db, 'clientAccess', cleanAccountNumber);
  try {
    const snap = await getDoc(accessRef);
    if (!snap.exists()) {
      throw new BusinessValidationError('Client App credentials not found for this account.');
    }
    const data = snap.data() as ClientAccessRecord;
    if (data.clientUid !== params.uid) {
      throw new BusinessValidationError('Only the enrolled client can update this password.');
    }
    const ok = await verifyPasswordPBKDF2(
      params.currentPassword,
      data.passwordSalt,
      data.passwordHash,
    );
    if (!ok) {
      throw new BusinessValidationError('Current password is incorrect.');
    }

    const passwordSalt = generateSaltHex();
    const passwordHash = await hashPasswordPBKDF2(params.newPassword, passwordSalt);
    await updateDoc(accessRef, {
      passwordSalt,
      passwordHash,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `clientAccess/${cleanAccountNumber}`);
  }
}

export async function seedSamplePortfolio(ownerId: string, currency: CurrencyCode): Promise<void> {
  const sampleCustomers: CustomerInput[] = [
    {
      fullName: 'Amina Wanjiku',
      phone: '+254 712 440 819',
      email: 'amina.wanjiku@marketcoop.org',
      nationalId: 'NID-2984410',
      occupation: 'Fresh Produce & Grain Wholesale',
      address: 'Stall 14, Kariokor Market Road',
      kycStatus: 'verified',
    },
    {
      fullName: 'Samuel Osei-Mensah',
      phone: '+233 24 891 2044',
      email: 'samuel.osei@tailorcraft.com',
      nationalId: 'GHA-8841209-4',
      occupation: 'Garment Tailoring Workshop',
      address: '28 Makola Artisan Lane',
      kycStatus: 'verified',
    },
    {
      fullName: 'Beatrice Ndlovu',
      phone: '+27 83 519 7732',
      email: 'b.ndlovu@solarbake.co',
      nationalId: 'KYC-7740192',
      occupation: 'Community Solar Bakery',
      address: 'Plot 9, Riverbend Cooperative',
      kycStatus: 'verified',
    },
    {
      fullName: 'Daniela Morales',
      phone: '+1 512 409 8821',
      email: 'daniela@moralesceramics.com',
      nationalId: 'TAX-5501928',
      occupation: 'Artisan Pottery & Supply',
      address: '412 East Cedar Avenue',
      kycStatus: 'pending',
    },
  ];

  const batch = writeBatch(db);
  const customerRefs = sampleCustomers.map(() => doc(collection(db, 'customers')));

  customerRefs.forEach((custRef, idx) => {
    const c = sampleCustomers[idx];
    batch.set(custRef, {
      ownerId,
      customerEmail: normalizeEmail(c.email),
      fullName: c.fullName,
      phone: c.phone,
      email: c.email,
      nationalId: c.nationalId,
      occupation: c.occupation,
      address: c.address,
      kycStatus: c.kycStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const sampleAccountSpecs: {
    customerIdx: number;
    accountType: AccountType;
    deposits: number[];
    withdrawals: number[];
    method: PaymentMethod;
  }[] = [
    {
      customerIdx: 0,
      accountType: 'business',
      deposits: [185000, 62000],
      withdrawals: [45000],
      method: 'mobile_money',
    },
    {
      customerIdx: 1,
      accountType: 'savings',
      deposits: [120000, 35000],
      withdrawals: [15000],
      method: 'cash',
    },
    {
      customerIdx: 2,
      accountType: 'group_solidarity',
      deposits: [340000],
      withdrawals: [80000],
      method: 'bank_transfer',
    },
    {
      customerIdx: 3,
      accountType: 'fixed_deposit',
      deposits: [250000],
      withdrawals: [],
      method: 'cheque',
    },
  ];

  const createdAccounts: { accountId: string; spec: (typeof sampleAccountSpecs)[number] }[] = [];

  sampleAccountSpecs.forEach((spec) => {
    const custRef = customerRefs[spec.customerIdx];
    const cust = sampleCustomers[spec.customerIdx];
    const acctRef = doc(collection(db, 'accounts'));
    const acctNum = generateAccountNumber('MF');

    batch.set(acctRef, {
      ownerId,
      customerId: custRef.id,
      customerName: cust.fullName,
      customerEmail: normalizeEmail(cust.email),
      accountNumber: acctNum,
      accountType: spec.accountType,
      currency,
      balanceCents: 0,
      totalDepositsCents: 0,
      totalWithdrawalsCents: 0,
      transactionCount: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'accountDirectory', acctNum), {
      accountId: acctRef.id,
      accountNumber: acctNum,
      ownerId,
      customerId: custRef.id,
      customerName: cust.fullName,
      currency,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    createdAccounts.push({ accountId: acctRef.id, spec });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'batch/sample_portfolio');
  }

  for (const { accountId, spec } of createdAccounts) {
    for (let i = 0; i < spec.deposits.length; i += 1) {
      await recordLedgerTransaction({
        actorUid: ownerId,
        ownerId,
        accountId,
        type: 'deposit',
        amountCents: spec.deposits[i],
        paymentMethod: spec.method,
        reference: generateTransactionReference('deposit'),
        notes: i === 0 ? 'Opening branch deposit' : 'Weekly installment deposit',
      });
    }
    for (const amt of spec.withdrawals) {
      await recordLedgerTransaction({
        actorUid: ownerId,
        ownerId,
        accountId,
        type: 'withdrawal',
        amountCents: amt,
        paymentMethod: spec.method,
        reference: generateTransactionReference('withdrawal'),
        notes: 'Working capital inventory disbursement',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Branch Staff RBAC (Sole Admin + Unlimited User Cat 1)
// ---------------------------------------------------------------------------

function validateStaffInputs(params: {
  email: string;
  username: string;
  password: string;
}): {
  email: string;
  emailLower: string;
  username: string;
  usernameLower: string;
} {
  const email = clampString(params.email, STAFF_CONSTRAINTS.EMAIL_MAX);
  const emailLower = normalizeEmail(email);
  const username = clampString(params.username, STAFF_CONSTRAINTS.USERNAME_MAX);
  const usernameLower = username.toLowerCase();

  if (email.length < STAFF_CONSTRAINTS.EMAIL_MIN || !email.includes('@')) {
    throw new BusinessValidationError('Please enter a valid staff email address.');
  }
  if (username.length < STAFF_CONSTRAINTS.USERNAME_MIN) {
    throw new BusinessValidationError(
      `Username must be at least ${STAFF_CONSTRAINTS.USERNAME_MIN} characters.`,
    );
  }
  if (
    params.password.length < STAFF_CONSTRAINTS.PASSWORD_MIN ||
    params.password.length > STAFF_CONSTRAINTS.PASSWORD_MAX
  ) {
    throw new BusinessValidationError(
      `Password must be between ${STAFF_CONSTRAINTS.PASSWORD_MIN} and ${STAFF_CONSTRAINTS.PASSWORD_MAX} characters.`,
    );
  }

  return { email, emailLower, username, usernameLower };
}

export async function setupBranchAdmin(params: {
  ownerId: string;
  email: string;
  username: string;
  password: string;
}): Promise<StaffUser> {
  const { email, emailLower, username, usernameLower } = validateStaffInputs(params);
  const adminId = `admin_${params.ownerId}`;
  const adminRef = doc(db, 'staffUsers', adminId);

  try {
    const existing = await getDoc(adminRef);
    if (existing.exists()) {
      throw new BusinessValidationError(
        'A Branch Admin already exists. Only 1 Admin is permitted per branch.',
      );
    }

    const passwordSalt = generateSaltHex();
    const passwordHash = await hashPasswordPBKDF2(params.password, passwordSalt);

    await setDoc(adminRef, {
      ownerId: params.ownerId,
      role: 'admin' as StaffRole,
      username,
      usernameLower,
      email,
      emailLower,
      passwordSalt,
      passwordHash,
      status: 'active' as StaffStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const snap = await getDoc(adminRef);
    return {
      id: snap.id,
      ...(snap.data() as Omit<StaffUser, 'id'>),
    };
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.WRITE, `staffUsers/${adminId}`);
  }
}

export async function createCat1StaffUser(params: {
  ownerId: string;
  email: string;
  username: string;
  password: string;
}): Promise<string> {
  const { email, emailLower, username, usernameLower } = validateStaffInputs(params);

  try {
    const branchStaffSnap = await getDocs(
      query(collection(db, 'staffUsers'), where('ownerId', '==', params.ownerId)),
    );
    const duplicate = branchStaffSnap.docs.find((d) => {
      const data = d.data() as Omit<StaffUser, 'id'>;
      return data.usernameLower === usernameLower || data.emailLower === emailLower;
    });
    if (duplicate) {
      throw new BusinessValidationError(
        'A branch user with that username or email already exists.',
      );
    }

    const staffRef = doc(collection(db, 'staffUsers'));
    const passwordSalt = generateSaltHex();
    const passwordHash = await hashPasswordPBKDF2(params.password, passwordSalt);

    await setDoc(staffRef, {
      ownerId: params.ownerId,
      role: 'cat1' as StaffRole,
      username,
      usernameLower,
      email,
      emailLower,
      passwordSalt,
      passwordHash,
      status: 'active' as StaffStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return staffRef.id;
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.CREATE, 'staffUsers');
  }
}

export async function updateStaffUserStatus(params: {
  staffId: string;
  status: StaffStatus;
}): Promise<void> {
  const ref = doc(db, 'staffUsers', params.staffId);
  try {
    await updateDoc(ref, {
      status: params.status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `staffUsers/${params.staffId}`);
  }
}

export async function resetStaffPassword(params: {
  staffId: string;
  newPassword: string;
}): Promise<void> {
  if (
    params.newPassword.length < STAFF_CONSTRAINTS.PASSWORD_MIN ||
    params.newPassword.length > STAFF_CONSTRAINTS.PASSWORD_MAX
  ) {
    throw new BusinessValidationError(
      `Password must be between ${STAFF_CONSTRAINTS.PASSWORD_MIN} and ${STAFF_CONSTRAINTS.PASSWORD_MAX} characters.`,
    );
  }
  const ref = doc(db, 'staffUsers', params.staffId);
  try {
    const passwordSalt = generateSaltHex();
    const passwordHash = await hashPasswordPBKDF2(params.newPassword, passwordSalt);
    await updateDoc(ref, {
      passwordSalt,
      passwordHash,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `staffUsers/${params.staffId}`);
  }
}

export async function deleteCat1StaffUser(staff: StaffUser): Promise<void> {
  if (staff.role === 'admin') {
    throw new BusinessValidationError('The sole Branch Admin cannot be deleted.');
  }
  try {
    await deleteDoc(doc(db, 'staffUsers', staff.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `staffUsers/${staff.id}`);
  }
}

export async function verifyStaffCredentials(params: {
  ownerId: string;
  identifier: string;
  password: string;
}): Promise<StaffUser> {
  const cleanIdentifier = params.identifier.trim().toLowerCase();
  if (!cleanIdentifier) {
    throw new BusinessValidationError('Enter your staff email or username.');
  }
  if (!params.password) {
    throw new BusinessValidationError('Enter your staff password.');
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'staffUsers'), where('ownerId', '==', params.ownerId)),
    );
    const matchedDoc = snap.docs.find((d) => {
      const data = d.data() as Omit<StaffUser, 'id'>;
      return data.usernameLower === cleanIdentifier || data.emailLower === cleanIdentifier;
    });

    if (!matchedDoc) {
      throw new BusinessValidationError('No branch staff account matches that email or username.');
    }

    const staff: StaffUser = {
      id: matchedDoc.id,
      ...(matchedDoc.data() as Omit<StaffUser, 'id'>),
    };

    if (staff.status !== 'active') {
      throw new BusinessValidationError(
        'This User Cat 1 account has been disabled by the Admin.',
      );
    }

    const ok = await verifyPasswordPBKDF2(
      params.password,
      staff.passwordSalt,
      staff.passwordHash,
    );
    if (!ok) {
      throw new BusinessValidationError('Incorrect password for this staff account.');
    }

    return staff;
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.LIST, 'staffUsers');
  }
}

// ---------------------------------------------------------------------------
// Approval Requests & Atomic Validated Operation Reversal
// ---------------------------------------------------------------------------

export async function requestOverLimitWithdrawal(params: {
  ownerId: string;
  staff: StaffUser;
  account: Account;
  amountCents: number;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  message?: string;
}): Promise<string> {
  if (!Number.isSafeInteger(params.amountCents) || params.amountCents <= CAT1_WITHDRAWAL_MAX_CENTS) {
    throw new BusinessValidationError(
      'Withdrawals up to $350.00 can be processed directly without Admin validation.',
    );
  }
  if (params.account.status !== 'active') {
    throw new BusinessValidationError(
      `Account ${params.account.accountNumber} is ${params.account.status}.`,
    );
  }
  if (params.amountCents > params.account.balanceCents) {
    throw new BusinessValidationError(
      `Insufficient balance. Available funds: ${(params.account.balanceCents / 100).toFixed(2)} ${params.account.currency}.`,
    );
  }

  const ref = clampString(
    params.reference || generateTransactionReference('withdrawal'),
    BLUEPRINT_CONSTRAINTS.REFERENCE_MAX,
  );
  if (ref.length < BLUEPRINT_CONSTRAINTS.REFERENCE_MIN) {
    throw new BusinessValidationError('Receipt reference must be at least 3 characters.');
  }

  const defaultMsg = `Withdrawal of ${(params.amountCents / 100).toFixed(2)} ${params.account.currency} exceeds the $350.00 User Cat 1 limit.`;
  const message = clampString(params.message || defaultMsg, STAFF_CONSTRAINTS.MESSAGE_MAX);
  const reqRef = doc(collection(db, 'approvalRequests'));

  try {
    await setDoc(reqRef, {
      ownerId: params.ownerId,
      requestType: 'withdrawal_over_limit',
      status: 'pending',
      requestedByStaffId: params.staff.id,
      requestedByUsername: clampString(params.staff.username, STAFF_CONSTRAINTS.USERNAME_MAX),
      requestedByEmail: clampString(params.staff.email, STAFF_CONSTRAINTS.EMAIL_MAX),
      accountId: params.account.id,
      accountNumber: params.account.accountNumber,
      customerName: params.account.customerName,
      amountCents: params.amountCents,
      currency: params.account.currency,
      paymentMethod: params.paymentMethod,
      reference: ref,
      notes: clampString(params.notes || '', BLUEPRINT_CONSTRAINTS.NOTES_MAX),
      message,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return reqRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `approvalRequests/${reqRef.id}`);
  }
}

export async function requestOperationDeletion(params: {
  ownerId: string;
  staff: StaffUser;
  tx: LedgerTransaction;
  message: string;
}): Promise<string> {
  if (params.tx.type !== 'deposit' && params.tx.type !== 'withdrawal') {
    throw new BusinessValidationError(
      'Peer transfer legs cannot be deleted individually. Reverse with a balancing operation instead.',
    );
  }
  const msg = clampString(
    params.message ||
      `Request to delete validated ${params.tx.type} (${params.tx.reference}) on ${params.tx.accountNumber}.`,
    STAFF_CONSTRAINTS.MESSAGE_MAX,
  );

  const reqRef = doc(collection(db, 'approvalRequests'));
  try {
    await setDoc(reqRef, {
      ownerId: params.ownerId,
      requestType: 'delete_operation',
      status: 'pending',
      requestedByStaffId: params.staff.id,
      requestedByUsername: clampString(params.staff.username, STAFF_CONSTRAINTS.USERNAME_MAX),
      requestedByEmail: clampString(params.staff.email, STAFF_CONSTRAINTS.EMAIL_MAX),
      accountId: params.tx.accountId,
      accountNumber: params.tx.accountNumber,
      customerName: params.tx.customerName,
      amountCents: params.tx.amountCents,
      currency: params.tx.currency,
      paymentMethod: params.tx.paymentMethod,
      reference: params.tx.reference,
      notes: clampString(params.tx.notes || '', BLUEPRINT_CONSTRAINTS.NOTES_MAX),
      message: msg,
      targetTransactionId: params.tx.id,
      targetTransactionType: params.tx.type,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return reqRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `approvalRequests/${reqRef.id}`);
  }
}

export async function deleteValidatedTransaction(params: {
  ownerId: string;
  adminStaff: StaffUser;
  transactionId: string;
}): Promise<void> {
  if (params.adminStaff.role !== 'admin') {
    throw new BusinessValidationError(
      'User Cat 1 does not have permission to delete a validated operation.',
    );
  }

  const txRef = doc(db, 'transactions', params.transactionId);

  try {
    const deletedInfo = await runTransaction(db, async (tx) => {
      const txSnap = await tx.get(txRef);
      if (!txSnap.exists()) {
        throw new BusinessValidationError('Transaction entry no longer exists.');
      }
      const txData = txSnap.data() as Omit<LedgerTransaction, 'id'>;
      if (txData.ownerId !== params.ownerId) {
        throw new BusinessValidationError('Unauthorized branch transaction deletion.');
      }
      if (txData.type !== 'deposit' && txData.type !== 'withdrawal') {
        throw new BusinessValidationError(
          'Only deposit or withdrawal operations can be deleted directly.',
        );
      }

      const accountRef = doc(db, 'accounts', txData.accountId);
      const acctSnap = await tx.get(accountRef);
      if (!acctSnap.exists()) {
        throw new BusinessValidationError('Associated account was not found.');
      }
      const acct = acctSnap.data() as Omit<Account, 'id'>;
      if (acct.status !== 'active') {
        throw new BusinessValidationError(
          `Cannot delete an operation on a ${acct.status} account.`,
        );
      }
      if (txData.type === 'deposit' && acct.balanceCents < txData.amountCents) {
        throw new BusinessValidationError(
          `Cannot delete this deposit because current balance (${(acct.balanceCents / 100).toFixed(2)} ${acct.currency}) is lower than the deposit amount.`,
        );
      }

      const nextBalance =
        txData.type === 'deposit'
          ? acct.balanceCents - txData.amountCents
          : acct.balanceCents + txData.amountCents;

      const nextDeposits =
        txData.type === 'deposit'
          ? acct.totalDepositsCents - txData.amountCents
          : acct.totalDepositsCents;

      const nextWithdrawals =
        txData.type === 'withdrawal'
          ? acct.totalWithdrawalsCents - txData.amountCents
          : acct.totalWithdrawalsCents;

      tx.update(accountRef, {
        balanceCents: nextBalance,
        totalDepositsCents: nextDeposits,
        totalWithdrawalsCents: nextWithdrawals,
        transactionCount: Math.max(0, acct.transactionCount - 1),
        lastDeletedTxId: params.transactionId,
        updatedAt: serverTimestamp(),
      });
      tx.delete(txRef);

      return { txData, acct, nextBalance };
    });

    await dispatchCustomerEmailNotification({
      ownerId: params.ownerId,
      account: deletedInfo.acct,
      accountId: deletedInfo.txData.accountId,
      accountNumber: deletedInfo.acct.accountNumber,
      customerName: deletedInfo.acct.customerName,
      operationType: `Validated ${deletedInfo.txData.type === 'deposit' ? 'Deposit' : 'Withdrawal'} Deleted`,
      outcome: 'completed',
      amountFormatted: formatCents(deletedInfo.txData.amountCents, deletedInfo.acct.currency),
      reference: deletedInfo.txData.reference,
      details: `Branch Admin removed validated ${deletedInfo.txData.type} (${deletedInfo.txData.reference}). Updated account balance: ${formatCents(deletedInfo.nextBalance, deletedInfo.acct.currency)}.`,
    });
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.DELETE, `transactions/${params.transactionId}`);
  }
}

export async function approveApprovalRequest(params: {
  ownerId: string;
  adminStaff: StaffUser;
  request: ApprovalRequest;
  reviewNote?: string;
}): Promise<{ resultTransactionId?: string }> {
  const reviewer = params.adminStaff;
  const isClientWithdrawal = params.request.requestType === 'client_withdrawal';

  if (isClientWithdrawal) {
    if (reviewer.role !== 'admin' && reviewer.role !== 'cat1') {
      throw new BusinessValidationError('Only Branch Admin or User Cat 1 can confirm client withdrawals.');
    }
  } else if (reviewer.role !== 'admin') {
    throw new BusinessValidationError('Only the Branch Admin can validate this request.');
  }

  const reqRef = doc(db, 'approvalRequests', params.request.id);
  const accountRef = doc(db, 'accounts', params.request.accountId);
  const reviewNote = clampString(
    params.reviewNote || `Approved by ${reviewer.username}`,
    BLUEPRINT_CONSTRAINTS.NOTES_MAX,
  );
  const reviewerStaffId = reviewer.role === 'admin' ? `admin_${params.ownerId}` : reviewer.id;

  try {
    const outcome = await runTransaction(db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) {
        throw new BusinessValidationError('Approval request no longer exists.');
      }
      const reqData = reqSnap.data() as Omit<ApprovalRequest, 'id'>;
      if (reqData.status !== 'pending') {
        throw new BusinessValidationError(`This request has already been ${reqData.status}.`);
      }

      const acctSnap = await tx.get(accountRef);
      if (!acctSnap.exists()) {
        throw new BusinessValidationError('Customer account was not found.');
      }
      const acct = acctSnap.data() as Omit<Account, 'id'>;

      if (reqData.requestType === 'client_account_activation') {
        if (acct.status === 'closed') {
          throw new BusinessValidationError(`Account ${acct.accountNumber} is closed and cannot be activated.`);
        }
        const accessRef = doc(db, 'clientAccess', reqData.accountNumber);
        const accessSnap = await tx.get(accessRef);
        if (!accessSnap.exists()) {
          throw new BusinessValidationError('Client App registration record was not found.');
        }
        const accessData = accessSnap.data() as ClientAccessRecord;

        tx.update(reqRef, {
          status: 'approved',
          reviewedByStaffId: reviewerStaffId,
          reviewedByUsername: clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX),
          reviewNote,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.update(accessRef, {
          approvalStatus: 'approved',
          reviewedByStaffId: reviewerStaffId,
          reviewedByUsername: clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX),
          reviewNote,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.update(accountRef, {
          clientUid: accessData.clientUid,
          clientAccessApproved: true,
          customerEmail: accessData.emailLower,
          updatedAt: serverTimestamp(),
        });

        return {
          acct,
          reqData,
          explicitEmail: accessData.emailLower,
          clientUid: accessData.clientUid,
          balanceAfterCents: acct.balanceCents,
        };
      }

      if (acct.status !== 'active') {
        throw new BusinessValidationError(`Account ${acct.accountNumber} is ${acct.status}.`);
      }

      if (reqData.requestType === 'withdrawal_over_limit' || reqData.requestType === 'client_withdrawal') {
        if (acct.balanceCents < reqData.amountCents) {
          throw new BusinessValidationError(
            `Insufficient balance to confirm withdrawal. Available: ${(acct.balanceCents / 100).toFixed(2)} ${acct.currency}.`,
          );
        }

        const newTxRef = doc(collection(db, 'transactions'));
        const balanceBeforeCents = acct.balanceCents;
        const balanceAfterCents = balanceBeforeCents - reqData.amountCents;

        tx.update(reqRef, {
          status: 'approved',
          reviewedByStaffId: reviewerStaffId,
          reviewedByUsername: clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX),
          reviewNote,
          resultTransactionId: newTxRef.id,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.update(accountRef, {
          balanceCents: balanceAfterCents,
          totalWithdrawalsCents: acct.totalWithdrawalsCents + reqData.amountCents,
          transactionCount: acct.transactionCount + 1,
          updatedAt: serverTimestamp(),
        });

        const txPayload: Record<string, unknown> = {
          ownerId: acct.ownerId,
          accountId: reqData.accountId,
          customerId: acct.customerId,
          accountNumber: acct.accountNumber,
          customerName: acct.customerName,
          type: 'withdrawal' as TransactionType,
          amountCents: reqData.amountCents,
          balanceBeforeCents,
          balanceAfterCents,
          currency: acct.currency,
          paymentMethod: reqData.paymentMethod,
          reference: reqData.reference,
          notes: clampString(
            reqData.requestType === 'client_withdrawal'
              ? `${reqData.notes || 'Client withdrawal'} (Confirmed by ${reviewer.username})`
              : reqData.notes
                ? `${reqData.notes} (Admin validated)`
                : `Validated by ${reviewer.username}`,
            BLUEPRINT_CONSTRAINTS.NOTES_MAX,
          ),
          staffId: reqData.requestType === 'client_withdrawal' ? reviewerStaffId : reqData.requestedByStaffId,
          staffUsername:
            reqData.requestType === 'client_withdrawal'
              ? clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX)
              : reqData.requestedByUsername,
          staffRole: (reqData.requestType === 'client_withdrawal' ? reviewer.role : 'cat1') as StaffRole,
          approvalRequestId: params.request.id,
          createdAt: serverTimestamp(),
        };
        if (acct.customerEmail) txPayload.customerEmail = acct.customerEmail;
        if (acct.clientUid) txPayload.clientUid = acct.clientUid;
        tx.set(newTxRef, txPayload);

        return {
          resultTransactionId: newTxRef.id,
          acct,
          reqData,
          explicitEmail: reqData.requestedByRole === 'client' ? reqData.requestedByEmail : acct.customerEmail,
          clientUid: acct.clientUid || reqData.requestedByUid,
          balanceAfterCents,
        };
      }

      // delete_operation
      if (!reqData.targetTransactionId) {
        throw new BusinessValidationError('Missing target transaction ID on deletion request.');
      }
      const targetTxRef = doc(db, 'transactions', reqData.targetTransactionId);
      const targetTxSnap = await tx.get(targetTxRef);
      if (!targetTxSnap.exists()) {
        throw new BusinessValidationError('Target operation was already deleted.');
      }
      const targetTx = targetTxSnap.data() as Omit<LedgerTransaction, 'id'>;
      if (targetTx.type !== 'deposit' && targetTx.type !== 'withdrawal') {
        throw new BusinessValidationError('Only deposit or withdrawal operations can be deleted.');
      }
      if (targetTx.type === 'deposit' && acct.balanceCents < targetTx.amountCents) {
        throw new BusinessValidationError(
          `Cannot delete this deposit because current balance (${(acct.balanceCents / 100).toFixed(2)} ${acct.currency}) is lower than the deposit amount.`,
        );
      }

      const nextBalance =
        targetTx.type === 'deposit'
          ? acct.balanceCents - targetTx.amountCents
          : acct.balanceCents + targetTx.amountCents;
      const nextDeposits =
        targetTx.type === 'deposit'
          ? acct.totalDepositsCents - targetTx.amountCents
          : acct.totalDepositsCents;
      const nextWithdrawals =
        targetTx.type === 'withdrawal'
          ? acct.totalWithdrawalsCents - targetTx.amountCents
          : acct.totalWithdrawalsCents;

      tx.update(reqRef, {
        status: 'approved',
        reviewedByStaffId: reviewerStaffId,
        reviewedByUsername: clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX),
        reviewNote,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(accountRef, {
        balanceCents: nextBalance,
        totalDepositsCents: nextDeposits,
        totalWithdrawalsCents: nextWithdrawals,
        transactionCount: Math.max(0, acct.transactionCount - 1),
        lastDeletedTxId: reqData.targetTransactionId,
        updatedAt: serverTimestamp(),
      });

      tx.delete(targetTxRef);
      return {
        acct,
        reqData,
        explicitEmail: acct.customerEmail,
        clientUid: acct.clientUid,
        balanceAfterCents: nextBalance,
      };
    });

    const opLabelMap: Record<ApprovalRequest['requestType'], string> = {
      client_account_activation: 'Client Account Registration',
      client_withdrawal: 'Client Withdrawal',
      withdrawal_over_limit: 'Branch Withdrawal Over $350',
      delete_operation: 'Validated Operation Deletion',
    };
    const opLabel = opLabelMap[outcome.reqData.requestType] || 'Account Operation';
    const amtFmt =
      outcome.reqData.amountCents > 0
        ? formatCents(outcome.reqData.amountCents, outcome.reqData.currency)
        : undefined;

    await dispatchCustomerEmailNotification({
      ownerId: params.ownerId,
      recipientEmail: outcome.explicitEmail,
      account: outcome.acct,
      accountId: outcome.reqData.accountId,
      accountNumber: outcome.reqData.accountNumber,
      customerName: outcome.reqData.customerName,
      clientUid: outcome.clientUid,
      operationType: opLabel,
      outcome: 'validated',
      amountFormatted: amtFmt,
      reference: outcome.reqData.reference,
      details:
        outcome.reqData.requestType === 'client_account_activation'
          ? `Your Client App access for Main App account ${outcome.reqData.accountNumber} has been validated by ${reviewer.username}. You can now sign in and operate your account.`
          : outcome.reqData.requestType === 'delete_operation'
            ? `Operation ${outcome.reqData.reference} was removed following Admin validation. Updated balance: ${formatCents(outcome.balanceAfterCents, outcome.acct.currency)}.`
            : `${opLabel} of ${amtFmt} was confirmed by ${reviewer.username}. Updated balance: ${formatCents(outcome.balanceAfterCents, outcome.acct.currency)}.`,
    });

    return { resultTransactionId: outcome.resultTransactionId };
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.WRITE, `approvalRequests/${params.request.id}`);
  }
}

export async function rejectApprovalRequest(params: {
  ownerId: string;
  adminStaff: StaffUser;
  requestId: string;
  reviewNote?: string;
}): Promise<void> {
  const reviewer = params.adminStaff;
  const reqRef = doc(db, 'approvalRequests', params.requestId);
  const reviewNote = clampString(
    params.reviewNote || `Declined by ${reviewer.username}`,
    BLUEPRINT_CONSTRAINTS.NOTES_MAX,
  );
  const reviewerStaffId = reviewer.role === 'admin' ? `admin_${params.ownerId}` : reviewer.id;

  try {
    const rejectedInfo = await runTransaction(db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) {
        throw new BusinessValidationError('Approval request no longer exists.');
      }
      const reqData = reqSnap.data() as Omit<ApprovalRequest, 'id'>;
      if (reqData.status !== 'pending') {
        throw new BusinessValidationError(`This request has already been ${reqData.status}.`);
      }

      if (reqData.requestType === 'client_withdrawal') {
        if (reviewer.role !== 'admin' && reviewer.role !== 'cat1') {
          throw new BusinessValidationError('Only Branch Admin or User Cat 1 can review client withdrawals.');
        }
      } else if (reviewer.role !== 'admin') {
        throw new BusinessValidationError('Only the Branch Admin can review this request.');
      }

      const acctSnap = await tx.get(doc(db, 'accounts', reqData.accountId));
      const acct = acctSnap.exists() ? (acctSnap.data() as Omit<Account, 'id'>) : null;

      tx.update(reqRef, {
        status: 'rejected',
        reviewedByStaffId: reviewerStaffId,
        reviewedByUsername: clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX),
        reviewNote,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      let explicitEmail = reqData.requestedByRole === 'client' ? reqData.requestedByEmail : acct?.customerEmail;
      let clientUid = acct?.clientUid || reqData.requestedByUid;

      if (reqData.requestType === 'client_account_activation') {
        const accessRef = doc(db, 'clientAccess', reqData.accountNumber);
        const accessSnap = await tx.get(accessRef);
        if (accessSnap.exists()) {
          const accessData = accessSnap.data() as ClientAccessRecord;
          explicitEmail = accessData.emailLower;
          clientUid = accessData.clientUid;
          tx.update(accessRef, {
            approvalStatus: 'rejected',
            reviewedByStaffId: reviewerStaffId,
            reviewedByUsername: clampString(reviewer.username, STAFF_CONSTRAINTS.USERNAME_MAX),
            reviewNote,
            reviewedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      return { reqData, acct, explicitEmail, clientUid };
    });

    const opLabelMap: Record<ApprovalRequest['requestType'], string> = {
      client_account_activation: 'Client Account Registration',
      client_withdrawal: 'Client Withdrawal',
      withdrawal_over_limit: 'Branch Withdrawal Over $350',
      delete_operation: 'Validated Operation Deletion',
    };
    const opLabel = opLabelMap[rejectedInfo.reqData.requestType] || 'Account Operation';
    const amtFmt =
      rejectedInfo.reqData.amountCents > 0
        ? formatCents(rejectedInfo.reqData.amountCents, rejectedInfo.reqData.currency)
        : undefined;

    await dispatchCustomerEmailNotification({
      ownerId: params.ownerId,
      recipientEmail: rejectedInfo.explicitEmail,
      account: rejectedInfo.acct,
      accountId: rejectedInfo.reqData.accountId,
      accountNumber: rejectedInfo.reqData.accountNumber,
      customerName: rejectedInfo.reqData.customerName,
      clientUid: rejectedInfo.clientUid,
      operationType: opLabel,
      outcome: 'rejected',
      amountFormatted: amtFmt,
      reference: rejectedInfo.reqData.reference,
      details: `${opLabel} was declined by ${reviewer.username}. Reason: ${reviewNote}`,
    });
  } catch (err) {
    if (err instanceof BusinessValidationError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `approvalRequests/${params.requestId}`);
  }
}

// ---------------------------------------------------------------------------
// Daily Cash Reports (Starting Cash - Cash Withdrawals + Deposits)
// ---------------------------------------------------------------------------

export async function saveDailyCashReport(params: {
  ownerId: string;
  staff: StaffUser;
  reportDate: string;
  currency: CurrencyCode;
  startingCashCents: number;
  cashWithdrawalsCents: number;
  cashDepositsCents: number;
  nonCashDepositsCents: number;
  nonCashWithdrawalsCents: number;
  operationCount: number;
  notes: string;
}): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.reportDate)) {
    throw new BusinessValidationError('Report date must be in YYYY-MM-DD format.');
  }
  if (!Number.isSafeInteger(params.startingCashCents) || params.startingCashCents < 0) {
    throw new BusinessValidationError('Starting cash must be zero or a positive amount.');
  }

  const endingCashCents =
    params.startingCashCents - params.cashWithdrawalsCents + params.cashDepositsCents;
  const reportId = `${params.reportDate}_${params.staff.id}`;
  const reportRef = doc(db, 'dailyReports', reportId);

  try {
    const existing = await getDoc(reportRef);
    const payload = {
      ownerId: params.ownerId,
      staffId: params.staff.id,
      staffUsername: clampString(params.staff.username, STAFF_CONSTRAINTS.USERNAME_MAX),
      staffEmail: clampString(params.staff.email, STAFF_CONSTRAINTS.EMAIL_MAX),
      reportDate: params.reportDate,
      currency: params.currency,
      startingCashCents: params.startingCashCents,
      cashWithdrawalsCents: params.cashWithdrawalsCents,
      cashDepositsCents: params.cashDepositsCents,
      nonCashDepositsCents: params.nonCashDepositsCents,
      nonCashWithdrawalsCents: params.nonCashWithdrawalsCents,
      endingCashCents,
      operationCount: params.operationCount,
      notes: clampString(params.notes || '', BLUEPRINT_CONSTRAINTS.NOTES_MAX),
      updatedAt: serverTimestamp(),
    };

    if (existing.exists()) {
      await updateDoc(reportRef, payload);
    } else {
      await setDoc(reportRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    return reportId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dailyReports/${reportId}`);
  }
}

export type { DailyCashReport };

