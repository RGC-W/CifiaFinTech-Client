import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  ArrowRightLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  Account,
  ApprovalRequest,
  BLUEPRINT_CONSTRAINTS,
  CLIENT_ACCESS_CONSTRAINTS,
  ClientAccessApprovalStatus,
  ClientAccessRecord,
  CurrencyCode,
  EmailNotification,
  LedgerTransaction,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  TRANSACTION_TYPE_LABELS,
  isCreditTransaction,
} from '../types/microfinance';
import {
  createClientAccountAccess,
  lookupAccountByNumber,
  normalizeEmail,
  requestClientWithdrawal,
  transferBetweenAccounts,
  updateClientAccountPassword,
  verifyClientAccountLogin,
} from '../services/ledgerService';
import {
  downloadTransactionsCsv,
  formatCents,
  formatShortDate,
  formatTimestamp,
  parseAmountToCents,
} from '../utils/currency';
import { TransferModal } from './TransferModal';
import { PWAInstallButton } from './PWAInstallButton';

type ClientTab = 'balance' | 'withdraw' | 'transfer' | 'activity';
type GateMode = 'login' | 'register';

interface UnlockedClientSession {
  accountId: string;
  accountNumber: string;
}

interface PendingClientActivationState {
  accountId: string;
  accountNumber: string;
  customerName: string;
  email: string;
  approvalStatus: ClientAccessApprovalStatus;
  reviewNote?: string;
}

interface ClientPortalProps {
  user: User;
  defaultCurrency: CurrencyCode;
  onSignOut: () => Promise<void>;
}

const SESSION_KEY_PREFIX = 'cairn_client_unlocked_';

export const ClientPortal: React.FC<ClientPortalProps> = ({
  user,
  defaultCurrency,
  onSignOut,
}) => {
  const userEmail = normalizeEmail(user.email);
  const sessionStorageKey = `${SESSION_KEY_PREFIX}${user.uid}`;

  // Account ID + Password Gate state
  const [unlockedSession, setUnlockedSession] = useState<UnlockedClientSession | null>(null);
  const [pendingActivation, setPendingActivation] = useState<PendingClientActivationState | null>(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [gateMode, setGateMode] = useState<GateMode>('login');

  const [loginAccountNumber, setLoginAccountNumber] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [regEmail, setRegEmail] = useState(() => user.email || '');
  const [regAccountNumber, setRegAccountNumber] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  const [gateError, setGateError] = useState<string | null>(null);
  const [isAuthenticatingGate, setIsAuthenticatingGate] = useState(false);

  // Linked Main App single account & ledger state
  const [account, setAccount] = useState<Account | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountLoadError, setAccountLoadError] = useState<string | null>(null);
  const [withdrawalRequests, setWithdrawalRequests] = useState<ApprovalRequest[]>([]);
  const [emailNotifications, setEmailNotifications] = useState<EmailNotification[]>([]);

  const [clientUidTransactions, setClientUidTransactions] = useState<LedgerTransaction[]>([]);
  const [emailTransactions, setEmailTransactions] = useState<LedgerTransaction[]>([]);
  const [ownerTransactions, setOwnerTransactions] = useState<LedgerTransaction[]>([]);

  const [activeTab, setActiveTab] = useState<ClientTab>('balance');
  const [hideBalances, setHideBalances] = useState(false);
  const [copiedAccountNumber, setCopiedAccountNumber] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastBalanceCheckedAt, setLastBalanceCheckedAt] = useState<Date>(() => new Date());

  // Withdrawal-only form state (no deposits in Client App)
  const [withdrawAmountInput, setWithdrawAmountInput] = useState('');
  const [withdrawChannel, setWithdrawChannel] = useState<PaymentMethod>('mobile_money');
  const [withdrawNotes, setWithdrawNotes] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [isPostingWithdraw, setIsPostingWithdraw] = useState(false);

  // Transfer form state
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [trfAcctNum, setTrfAcctNum] = useState('');
  const [trfRecipient, setTrfRecipient] = useState<{
    accountId: string;
    accountNumber: string;
    customerName: string;
    currency: CurrencyCode;
  } | null>(null);
  const [trfLookupError, setTrfLookupError] = useState<string | null>(null);
  const [isVerifyingTrf, setIsVerifyingTrf] = useState(false);
  const [trfAmountInput, setTrfAmountInput] = useState('');
  const [trfNotes, setTrfNotes] = useState('');
  const [trfError, setTrfError] = useState<string | null>(null);
  const [isSendingTrf, setIsSendingTrf] = useState(false);

  // Activity filter state
  const [activityView, setActivityView] = useState<'statement' | 'emails'>('statement');
  const [activitySearch, setActivitySearch] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'withdrawals' | 'transfers' | 'deposits'>('all');

  // Change password modal state
  const [changePwModalOpen, setChangePwModalOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [confirmNextPw, setConfirmNextPw] = useState('');
  const [changePwError, setChangePwError] = useState<string | null>(null);
  const [isChangingPw, setIsChangingPw] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Verify any tab-persisted unlocked Account ID belongs to this signed-in Google user
  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      setSessionChecking(true);
      try {
        const raw = window.sessionStorage.getItem(sessionStorageKey);
        if (!raw) {
          if (!cancelled) setUnlockedSession(null);
          return;
        }
        const parsed = JSON.parse(raw) as Partial<UnlockedClientSession>;
        if (!parsed.accountId || !parsed.accountNumber) {
          window.sessionStorage.removeItem(sessionStorageKey);
          if (!cancelled) setUnlockedSession(null);
          return;
        }

        const accessSnap = await getDoc(doc(db, 'clientAccess', parsed.accountNumber));
        if (accessSnap.exists()) {
          const accessData = accessSnap.data() as ClientAccessRecord;
          if (accessData.clientUid === user.uid && accessData.accountId === parsed.accountId) {
            if (accessData.approvalStatus === 'approved') {
              if (!cancelled) {
                setUnlockedSession({
                  accountId: parsed.accountId,
                  accountNumber: parsed.accountNumber,
                });
                setPendingActivation(null);
              }
            } else {
              window.sessionStorage.removeItem(sessionStorageKey);
              if (!cancelled) {
                setUnlockedSession(null);
                setPendingActivation({
                  accountId: accessData.accountId,
                  accountNumber: accessData.accountNumber,
                  customerName: accessData.customerName,
                  email: accessData.emailLower || accessData.email,
                  approvalStatus: accessData.approvalStatus || 'pending',
                  reviewNote: accessData.reviewNote,
                });
              }
            }
          } else {
            window.sessionStorage.removeItem(sessionStorageKey);
            if (!cancelled) setUnlockedSession(null);
          }
        } else {
          window.sessionStorage.removeItem(sessionStorageKey);
          if (!cancelled) setUnlockedSession(null);
        }
      } catch {
        window.sessionStorage.removeItem(sessionStorageKey);
        if (!cancelled) setUnlockedSession(null);
      } finally {
        if (!cancelled) setSessionChecking(false);
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [user.uid, sessionStorageKey]);

  // Listen in real time while client registration is awaiting Admin validation
  useEffect(() => {
    if (!pendingActivation) return;

    const unsubAccess = onSnapshot(
      doc(db, 'clientAccess', pendingActivation.accountNumber),
      (snap) => {
        if (!snap.exists()) {
          setPendingActivation(null);
          return;
        }
        const data = snap.data() as ClientAccessRecord;
        if (data.approvalStatus === 'approved') {
          const nextSession: UnlockedClientSession = {
            accountId: data.accountId,
            accountNumber: data.accountNumber,
          };
          window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
          setPendingActivation(null);
          setUnlockedSession(nextSession);
          setLastBalanceCheckedAt(new Date());
          setToast(`Client App account ${data.accountNumber} validated by Branch Admin!`);
        } else {
          setPendingActivation({
            accountId: data.accountId,
            accountNumber: data.accountNumber,
            customerName: data.customerName,
            email: data.emailLower || data.email,
            approvalStatus: data.approvalStatus || 'pending',
            reviewNote: data.reviewNote,
          });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `clientAccess/${pendingActivation.accountNumber}`);
      },
    );

    return () => unsubAccess();
  }, [pendingActivation?.accountNumber, sessionStorageKey]);

  // Subscribe strictly to the unlocked Main App account document (only when Admin-validated)
  useEffect(() => {
    if (!unlockedSession) {
      setAccount(null);
      setAccountLoading(false);
      setAccountLoadError(null);
      return;
    }

    setAccountLoading(true);
    setAccountLoadError(null);

    const unsubAccount = onSnapshot(
      doc(db, 'accounts', unlockedSession.accountId),
      (snap) => {
        if (snap.exists()) {
          const loaded = { id: snap.id, ...(snap.data() as Omit<Account, 'id'>) };
          if (!loaded.clientAccessApproved) {
            window.sessionStorage.removeItem(sessionStorageKey);
            setAccount(null);
            setUnlockedSession(null);
            setAccountLoadError('This Client App account requires Branch Admin validation before access.');
          } else {
            setAccount(loaded);
            setAccountLoadError(null);
          }
        } else {
          setAccount(null);
          setAccountLoadError('This Main App account could not be found.');
        }
        setAccountLoading(false);
      },
      (err) => {
        setAccountLoading(false);
        setAccountLoadError('Unable to load account details for this session.');
        handleFirestoreError(err, OperationType.GET, `accounts/${unlockedSession.accountId}`);
      },
    );

    return () => unsubAccount();
  }, [unlockedSession?.accountId, sessionStorageKey]);

  // Subscribe strictly to transactions readable by this client and scoped to unlocked account
  useEffect(() => {
    if (!unlockedSession) {
      setClientUidTransactions([]);
      setEmailTransactions([]);
      setOwnerTransactions([]);
      return;
    }

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'transactions'), where('clientUid', '==', user.uid)),
        (snap) => {
          setClientUidTransactions(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerTransaction, 'id'>) })),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'transactions(clientUid)'),
      ),
    );

    if (userEmail) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'transactions'), where('customerEmail', '==', userEmail)),
          (snap) => {
            setEmailTransactions(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerTransaction, 'id'>) })),
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'transactions(clientEmail)'),
        ),
      );
    } else {
      setEmailTransactions([]);
    }

    if (account && account.ownerId === user.uid) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'transactions'), where('ownerId', '==', user.uid)),
          (snap) => {
            setOwnerTransactions(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerTransaction, 'id'>) })),
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'transactions(ownerId)'),
        ),
      );
    } else {
      setOwnerTransactions([]);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [unlockedSession?.accountId, user.uid, userEmail, account?.ownerId]);

  // Subscribe to client withdrawal requests & customer email notification log
  useEffect(() => {
    if (!unlockedSession) {
      setWithdrawalRequests([]);
      setEmailNotifications([]);
      return;
    }

    const unsubReq = onSnapshot(
      query(collection(db, 'approvalRequests'), where('requestedByUid', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ApprovalRequest, 'id'>) }))
          .filter(
            (r) =>
              r.requestType === 'client_withdrawal' &&
              r.accountId === unlockedSession.accountId,
          )
          .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
        setWithdrawalRequests(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'approvalRequests(client)'),
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'emailNotifications'), where('clientUid', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<EmailNotification, 'id'>) }))
          .filter((n) => n.accountId === unlockedSession.accountId)
          .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
        setEmailNotifications(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'emailNotifications(client)'),
    );

    return () => {
      unsubReq();
      unsubNotifs();
    };
  }, [unlockedSession?.accountId, user.uid]);

  const accountTransactions = useMemo(() => {
    if (!unlockedSession) return [];
    const map = new Map<string, LedgerTransaction>();
    for (const tx of [...clientUidTransactions, ...emailTransactions, ...ownerTransactions]) {
      if (tx.accountId === unlockedSession.accountId) {
        map.set(tx.id, tx);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
    );
  }, [unlockedSession, clientUidTransactions, emailTransactions, ownerTransactions]);

  const pendingWithdrawalCents = useMemo(
    () =>
      withdrawalRequests
        .filter((r) => r.status === 'pending')
        .reduce((sum, r) => sum + r.amountCents, 0),
    [withdrawalRequests],
  );

  const availableForOperationsCents = useMemo(
    () => Math.max(0, (account?.balanceCents ?? 0) - pendingWithdrawalCents),
    [account?.balanceCents, pendingWithdrawalCents],
  );

  const filteredTransactions = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return accountTransactions.filter((tx) => {
      if (activityFilter === 'withdrawals' && tx.type !== 'withdrawal') return false;
      if (activityFilter === 'deposits' && tx.type !== 'deposit') return false;
      if (
        activityFilter === 'transfers' &&
        tx.type !== 'transfer_in' &&
        tx.type !== 'transfer_out'
      ) {
        return false;
      }
      if (
        q &&
        !tx.reference.toLowerCase().includes(q) &&
        !tx.accountNumber.toLowerCase().includes(q) &&
        !(tx.counterpartyAccountNumber || '').toLowerCase().includes(q) &&
        !(tx.counterpartyName || '').toLowerCase().includes(q) &&
        !tx.notes.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [accountTransactions, activityFilter, activitySearch]);

  const handleLockAccount = () => {
    window.sessionStorage.removeItem(sessionStorageKey);
    setUnlockedSession(null);
    setPendingActivation(null);
    setAccount(null);
    setActiveTab('balance');
    setLoginPassword('');
    setRegPassword('');
    setRegConfirmPassword('');
    setGateError(null);
  };

  const handleFullSignOut = async () => {
    window.sessionStorage.removeItem(sessionStorageKey);
    await onSignOut();
  };

  const handleGateLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError(null);
    setIsAuthenticatingGate(true);
    try {
      const res = await verifyClientAccountLogin({
        uid: user.uid,
        accountNumber: loginAccountNumber,
        password: loginPassword,
      });
      setLoginPassword('');
      if (res.approvalStatus !== 'approved') {
        window.sessionStorage.removeItem(sessionStorageKey);
        setUnlockedSession(null);
        setPendingActivation({
          accountId: res.accountId,
          accountNumber: res.accountNumber,
          customerName: res.customerName,
          email: res.email,
          approvalStatus: res.approvalStatus,
          reviewNote: res.reviewNote,
        });
        return;
      }
      const sessionObj: UnlockedClientSession = {
        accountId: res.accountId,
        accountNumber: res.accountNumber,
      };
      window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(sessionObj));
      setPendingActivation(null);
      setUnlockedSession(sessionObj);
      setLastBalanceCheckedAt(new Date());
      setToast(`Signed in to Main App account ${res.accountNumber}.`);
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Unable to unlock account.');
    } finally {
      setIsAuthenticatingGate(false);
    }
  };

  const handleGateRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError(null);

    if (!regEmail.trim() || !regEmail.includes('@')) {
      setGateError('Please enter a valid customer email address.');
      return;
    }
    if (regPassword.length < CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN) {
      setGateError(
        `Password must be at least ${CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN} characters.`,
      );
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setGateError('Passwords do not match.');
      return;
    }

    setIsAuthenticatingGate(true);
    try {
      const res = await createClientAccountAccess({
        uid: user.uid,
        email: regEmail,
        accountNumber: regAccountNumber,
        password: regPassword,
      });
      setRegPassword('');
      setRegConfirmPassword('');
      setPendingActivation({
        accountId: res.accountId,
        accountNumber: res.accountNumber,
        customerName: res.customerName,
        email: res.email,
        approvalStatus: res.approvalStatus,
      });
      setToast(
        `Registration submitted for ${res.accountNumber}. Awaiting Branch Admin validation; confirmation sent to ${res.email}.`,
      );
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Unable to create client account.');
    } finally {
      setIsAuthenticatingGate(false);
    }
  };

  const handleCopyAccountNumber = async (acctNum: string) => {
    try {
      await navigator.clipboard.writeText(acctNum);
      setCopiedAccountNumber(acctNum);
      window.setTimeout(() => setCopiedAccountNumber(null), 2000);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleBalanceCheckRefresh = () => {
    setLastBalanceCheckedAt(new Date());
    if (account) {
      setToast(
        `Solde verified for ${account.accountNumber}: ${formatCents(account.balanceCents, account.currency)}`,
      );
    }
  };

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);
    if (!account) {
      setWithdrawError('No active account loaded.');
      return;
    }
    if (account.status !== 'active') {
      setWithdrawError(`This account is ${account.status} and cannot process withdrawals.`);
      return;
    }
    const cents = parseAmountToCents(withdrawAmountInput);
    if (cents === null || cents <= 0) {
      setWithdrawError('Enter a valid positive withdrawal amount (up to 2 decimal places).');
      return;
    }
    if (cents > availableForOperationsCents || cents > account.balanceCents) {
      setWithdrawError(
        `Amount exceeds available balance (${formatCents(availableForOperationsCents, account.currency)}).`,
      );
      return;
    }

    setIsPostingWithdraw(true);
    try {
      const res = await requestClientWithdrawal({
        clientUid: user.uid,
        clientEmail: userEmail || account.customerEmail || '',
        account,
        amountCents: cents,
        paymentMethod: withdrawChannel,
        notes: withdrawNotes.trim() || 'Client withdrawal request',
        pendingReservedCents: pendingWithdrawalCents,
      });
      setWithdrawAmountInput('');
      setWithdrawNotes('');
      setToast(
        `Withdrawal request ${res.reference} (${formatCents(cents, account.currency)}) sent for Branch Admin or User Cat 1 confirmation.`,
      );
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Unable to submit withdrawal request.');
    } finally {
      setIsPostingWithdraw(false);
    }
  };

  const handleVerifyRecipient = async () => {
    const raw = trfAcctNum.trim().toUpperCase();
    setTrfLookupError(null);
    setTrfRecipient(null);

    if (!raw) {
      setTrfLookupError('Enter a recipient Account ID (for example MF-2026-48219).');
      return;
    }
    if (account && raw === account.accountNumber) {
      setTrfLookupError('Source and recipient accounts cannot be the same.');
      return;
    }

    setIsVerifyingTrf(true);
    try {
      const entry = await lookupAccountByNumber(raw);
      if (!entry) {
        setTrfLookupError('No Main App account found with that Account ID.');
        return;
      }
      if (entry.status !== 'active') {
        setTrfLookupError(`Recipient account ${entry.accountNumber} is ${entry.status}.`);
        return;
      }
      if (account && entry.currency !== account.currency) {
        setTrfLookupError(
          `Currency mismatch: your account is ${account.currency}, recipient is ${entry.currency}.`,
        );
        return;
      }
      setTrfRecipient({
        accountId: entry.accountId,
        accountNumber: entry.accountNumber,
        customerName: entry.customerName,
        currency: entry.currency,
      });
    } catch (err) {
      setTrfLookupError(err instanceof Error ? err.message : 'Unable to verify recipient.');
    } finally {
      setIsVerifyingTrf(false);
    }
  };

  const handleInlineTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrfError(null);

    if (!account) {
      setTrfError('No active source account.');
      return;
    }
    if (!trfRecipient) {
      setTrfError('Verify a recipient Account ID first.');
      return;
    }
    const cents = parseAmountToCents(trfAmountInput);
    if (cents === null || cents <= 0) {
      setTrfError('Enter a valid positive amount (up to 2 decimal places).');
      return;
    }
    if (cents > availableForOperationsCents || cents > account.balanceCents) {
      setTrfError(
        `Insufficient balance. Available funds: ${formatCents(availableForOperationsCents, account.currency)}.`,
      );
      return;
    }

    setIsSendingTrf(true);
    try {
      const res = await transferBetweenAccounts({
        initiatorUid: user.uid,
        sourceAccountId: account.id,
        destinationAccountId: trfRecipient.accountId,
        amountCents: cents,
        notes: trfNotes.trim() || 'Client transfer',
      });
      setTrfAmountInput('');
      setTrfNotes('');
      setTrfAcctNum('');
      setTrfRecipient(null);
      setLastBalanceCheckedAt(new Date());
      setToast(
        `Transferred ${formatCents(cents, account.currency)} to ${res.destinationCustomerName} (${res.destinationAccountNumber}) · Remaining balance: ${formatCents(res.sourceBalanceAfterCents, account.currency)}`,
      );
    } catch (err) {
      setTrfError(err instanceof Error ? err.message : 'Transfer could not be completed.');
    } finally {
      setIsSendingTrf(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwError(null);
    if (!unlockedSession) return;
    if (nextPw.length < CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN) {
      setChangePwError(
        `New password must be at least ${CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN} characters.`,
      );
      return;
    }
    if (nextPw !== confirmNextPw) {
      setChangePwError('New passwords do not match.');
      return;
    }

    setIsChangingPw(true);
    try {
      await updateClientAccountPassword({
        uid: user.uid,
        accountNumber: unlockedSession.accountNumber,
        currentPassword: currentPw,
        newPassword: nextPw,
      });
      setCurrentPw('');
      setNextPw('');
      setConfirmNextPw('');
      setChangePwModalOpen(false);
      setToast('Client App password updated.');
    } catch (err) {
      setChangePwError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setIsChangingPw(false);
    }
  };

  const parsedWithdrawAmount = parseAmountToCents(withdrawAmountInput);
  const withdrawProjectedBalance =
    account && parsedWithdrawAmount !== null && parsedWithdrawAmount > 0
      ? availableForOperationsCents - parsedWithdrawAmount
      : availableForOperationsCents;
  const withdrawIsOverdraft =
    account !== null &&
    parsedWithdrawAmount !== null &&
    (parsedWithdrawAmount > availableForOperationsCents || parsedWithdrawAmount > account.balanceCents);

  const parsedTrfAmount = parseAmountToCents(trfAmountInput);
  const trfProjectedBalance =
    account && parsedTrfAmount !== null && parsedTrfAmount > 0
      ? availableForOperationsCents - parsedTrfAmount
      : availableForOperationsCents;
  const trfIsOverdraft =
    account !== null &&
    parsedTrfAmount !== null &&
    (parsedTrfAmount > availableForOperationsCents || parsedTrfAmount > account.balanceCents);

  const maskAmount = (formatted: string) => (hideBalances ? '••••••' : formatted);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col pb-20 lg:pb-0">
      {/* Sticky Compact Header (3-zone Top Bar Contract, mobile <= 56px) */}
      <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-base lg:text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap">
              Cairn Microfinance
            </span>
            <span className="text-[11px] font-medium text-emerald-800 whitespace-nowrap hidden sm:inline">
              Client App
            </span>
          </div>

          {unlockedSession && account && (
            <nav
              className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600"
              aria-label="Client banking navigation"
            >
              {(
                [
                  { id: 'balance', label: 'Balance (Solde)' },
                  { id: 'withdraw', label: 'Withdraw' },
                  { id: 'transfer', label: 'Transfer' },
                  { id: 'activity', label: 'Activity' },
                ] as { id: ClientTab; label: string }[]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === item.id
                      ? 'text-emerald-900 font-semibold border-b-2 border-emerald-800'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {unlockedSession && (
              <button
                type="button"
                onClick={handleLockAccount}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[40px]"
              >
                <Lock className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">Switch Account</span>
                <span className="sm:hidden">Switch</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleFullSignOut}
              aria-label="Sign out"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[40px]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Inline Notification */}
      {toast && (
        <div className="px-4 sm:px-6 pt-4">
          <div
            role="status"
            className="max-w-7xl mx-auto px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs font-medium text-emerald-950"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{toast}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss alert"
              className="p-1 text-emerald-800 hover:text-emerald-950 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {sessionChecking ? (
          <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-8 animate-pulse space-y-4 mt-6">
            <div className="h-5 w-48 bg-slate-200 rounded" />
            <div className="h-10 bg-slate-100 rounded-xl" />
            <div className="h-10 bg-slate-100 rounded-xl" />
          </div>
        ) : !unlockedSession && pendingActivation ? (
          /* PENDING BRANCH ADMIN VALIDATION / REJECTION GATE */
          <div className="max-w-lg mx-auto pt-4 sm:pt-8">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5">
              <div className="flex items-start gap-3">
                {pendingActivation.approvalStatus === 'rejected' ? (
                  <div className="p-2.5 rounded-xl bg-red-50 text-red-700 shrink-0">
                    <XCircle className="w-6 h-6" />
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700 shrink-0">
                    <Clock className="w-6 h-6" />
                  </div>
                )}
                <div className="space-y-1">
                  <h1 className="text-xl font-bold text-slate-900 font-display">
                    {pendingActivation.approvalStatus === 'rejected'
                      ? 'Client Account Not Validated'
                      : 'Awaiting Branch Admin Validation'}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {pendingActivation.approvalStatus === 'rejected'
                      ? 'Your Client App registration was declined by the Branch Admin. Please contact your branch office for assistance.'
                      : 'Your Client App registration has been submitted. The Branch Admin must validate your account before you can view your balance or perform any operations.'}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Account Holder</span>
                  <span className="font-semibold text-slate-900">{pendingActivation.customerName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Main App Account ID</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {pendingActivation.accountNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Notification Email</span>
                  <span className="font-medium text-slate-900 break-all">{pendingActivation.email}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Validation Status</span>
                  <span
                    className={`font-semibold ${
                      pendingActivation.approvalStatus === 'rejected'
                        ? 'text-red-700'
                        : 'text-amber-800'
                    }`}
                  >
                    {pendingActivation.approvalStatus === 'rejected'
                      ? 'Rejected by Admin'
                      : 'Pending Admin Validation'}
                  </span>
                </div>
              </div>

              {pendingActivation.reviewNote && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900">
                  <span className="font-semibold">Admin note:</span> {pendingActivation.reviewNote}
                </div>
              )}

              {pendingActivation.approvalStatus === 'pending' && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-950">
                  <Mail className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
                  <span>
                    This screen unlocks automatically once validated by the Branch Admin, and a confirmation email will be sent to{' '}
                    <span className="font-semibold">{pendingActivation.email}</span>.
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleLockAccount}
                className="w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer min-h-[44px]"
              >
                Return to Account Sign In
              </button>
            </div>
          </div>
        ) : !unlockedSession ? (
          /* ACCOUNT ID + PASSWORD ACCESS GATE */
          <div className="max-w-lg mx-auto pt-4 sm:pt-8">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-800 text-xs font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Linked to Cairn Microfinance Main Ledger</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 font-display">
                  {gateMode === 'login' ? 'Sign In to Your Account' : 'Create Your Client Account'}
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {gateMode === 'login'
                    ? 'Enter your Main App Account ID and your Client App password to check your balance, withdraw funds, or send transfers.'
                    : 'Enter your email address, your Main App Account ID, and choose a password. Branch Admin validation is required before your account becomes active.'}
                </p>
              </div>

              {/* Gate Mode Switch */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setGateMode('login');
                    setGateError(null);
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer min-h-[44px] ${
                    gateMode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Sign In</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGateMode('register');
                    setGateError(null);
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer min-h-[44px] ${
                    gateMode === 'register'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Create Client Account</span>
                </button>
              </div>

              {gateError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                  {gateError}
                </div>
              )}

              {gateMode === 'login' ? (
                <form onSubmit={handleGateLogin} className="space-y-4">
                  <div>
                    <label htmlFor="client-login-acct" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Main App Account ID
                    </label>
                    <input
                      id="client-login-acct"
                      type="text"
                      required
                      maxLength={BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX}
                      value={loginAccountNumber}
                      onChange={(e) => setLoginAccountNumber(e.target.value.toUpperCase())}
                      placeholder="MF-2026-48219"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>

                  <div>
                    <label htmlFor="client-login-pw" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="client-login-pw"
                        type={showLoginPassword ? 'text' : 'password'}
                        required
                        maxLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your Client App password"
                        className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((v) => !v)}
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isAuthenticatingGate}
                    className="w-full py-3 px-4 text-sm font-semibold text-white bg-emerald-800 rounded-xl hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60 min-h-[48px]"
                  >
                    {isAuthenticatingGate ? 'Verifying...' : 'Unlock Account'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleGateRegister} className="space-y-4">
                  <div>
                    <label htmlFor="client-reg-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Email Address
                    </label>
                    <input
                      id="client-reg-email"
                      type="email"
                      required
                      maxLength={BLUEPRINT_CONSTRAINTS.EMAIL_MAX}
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="customer@example.com"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Used for operation receipts, validation updates, and rejection notices.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="client-reg-acct" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Main App Account ID
                    </label>
                    <input
                      id="client-reg-acct"
                      type="text"
                      required
                      maxLength={BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX}
                      value={regAccountNumber}
                      onChange={(e) => setRegAccountNumber(e.target.value.toUpperCase())}
                      placeholder="MF-2026-48219"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Provided by your branch officer when your account was opened in the Main App.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="client-reg-pw" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Create Password (min. {CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN} characters)
                    </label>
                    <div className="relative">
                      <input
                        id="client-reg-pw"
                        type={showRegPassword ? 'text' : 'password'}
                        required
                        minLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN}
                        maxLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Choose a password"
                        className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword((v) => !v)}
                        aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="client-reg-confirm" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Confirm Password
                    </label>
                    <input
                      id="client-reg-confirm"
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      minLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN}
                      maxLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX}
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAuthenticatingGate}
                    className="w-full py-3 px-4 text-sm font-semibold text-white bg-emerald-800 rounded-xl hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60 min-h-[48px]"
                  >
                    {isAuthenticatingGate ? 'Creating Access...' : 'Create Client Account'}
                  </button>
                </form>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                <span>Signed in as {userEmail || user.displayName}</span>
                <PWAInstallButton variant="sidebar" />
              </div>
            </div>
          </div>
        ) : accountLoading ? (
          <div className="space-y-4">
            <div className="h-44 bg-white border border-slate-200 rounded-2xl p-6 animate-pulse" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="h-56 bg-white border border-slate-200 rounded-2xl p-6 animate-pulse" />
              <div className="h-56 bg-white border border-slate-200 rounded-2xl p-6 animate-pulse" />
            </div>
          </div>
        ) : accountLoadError || !account ? (
          <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center mt-6 space-y-4">
            <Landmark className="w-10 h-10 text-slate-400 mx-auto" />
            <h2 className="text-lg font-bold text-slate-900 font-display">Account Unavailable</h2>
            <p className="text-xs text-slate-600">
              {accountLoadError || 'Unable to load the linked Main App account.'}
            </p>
            <button
              type="button"
              onClick={handleLockAccount}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-emerald-800 rounded-xl hover:bg-emerald-900 cursor-pointer"
            >
              Return to Account Sign In
            </button>
          </div>
        ) : (
          <>
            {/* Client Summary Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500">
                  Account Holder: <span className="font-medium text-slate-700">{account.customerName}</span> ·{' '}
                  <span className="font-mono text-slate-700">{account.accountNumber}</span>
                </p>
                <h1 className="text-2xl font-bold text-slate-900 font-display mt-0.5">
                  {activeTab === 'balance' && 'Account Balance & Solde'}
                  {activeTab === 'withdraw' && 'Withdraw Funds'}
                  {activeTab === 'transfer' && 'Send a Transfer'}
                  {activeTab === 'activity' && 'Account Activity & Statement'}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setHideBalances((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer min-h-[40px]"
                >
                  {hideBalances ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{hideBalances ? 'Show Balance' : 'Hide Balance'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleBalanceCheckRefresh}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer min-h-[40px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Check Solde</span>
                </button>
              </div>
            </div>

            {/* BALANCE (SOLDE) TAB */}
            {activeTab === 'balance' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  <section className="lg:col-span-7 bg-emerald-950 text-white rounded-2xl p-6 flex flex-col justify-between space-y-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs text-emerald-200">
                          {ACCOUNT_TYPE_LABELS[account.accountType]} · {ACCOUNT_STATUS_LABELS[account.status]}
                        </p>
                        <p className="text-xs text-emerald-100/80 mt-0.5">{account.customerName}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyAccountNumber(account.accountNumber)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-emerald-50 bg-white/10 hover:bg-white/15 rounded-lg transition-colors cursor-pointer"
                      >
                        <span>{account.accountNumber}</span>
                        {copiedAccountNumber === account.accountNumber ? (
                          <Check className="w-3.5 h-3.5 text-emerald-300" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <div>
                      <p className="text-xs text-emerald-200">
                        {pendingWithdrawalCents > 0
                          ? 'Available for Operations (Solde Disponible)'
                          : 'Available Balance (Solde Disponible)'}
                      </p>
                      <p className="text-3xl sm:text-4xl font-bold font-mono tabular-nums tracking-tight mt-1">
                        {maskAmount(formatCents(availableForOperationsCents, account.currency))}
                      </p>
                      {pendingWithdrawalCents > 0 && (
                        <p className="text-xs text-amber-200 mt-1.5 font-mono tabular-nums">
                          Ledger: {maskAmount(formatCents(account.balanceCents, account.currency))} · Pending withdrawal hold: -
                          {maskAmount(formatCents(pendingWithdrawalCents, account.currency))}
                        </p>
                      )}
                      <p className="text-xs text-emerald-200/80 mt-2">
                        Synced with Main App · Verified{' '}
                        {lastBalanceCheckedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                        {account.transactionCount} posted operations
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/15">
                      <div>
                        <p className="text-[11px] text-emerald-200">Total Credited (Main App &amp; Transfers)</p>
                        <p className="text-sm font-semibold font-mono tabular-nums mt-0.5">
                          +{maskAmount(formatCents(account.totalDepositsCents, account.currency))}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-emerald-200">Total Withdrawn &amp; Sent</p>
                        <p className="text-sm font-semibold font-mono tabular-nums mt-0.5">
                          -{maskAmount(formatCents(account.totalWithdrawalsCents, account.currency))}
                        </p>
                      </div>
                    </div>

                    {/* Client Self-Service Actions: Withdraw & Transfer ONLY (no deposits) */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button
                        type="button"
                        disabled={account.status !== 'active' || availableForOperationsCents === 0}
                        onClick={() => setActiveTab('withdraw')}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-emerald-950 bg-white rounded-xl hover:bg-emerald-50 transition-colors cursor-pointer disabled:opacity-50 min-h-[44px]"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        <span>Withdraw</span>
                      </button>
                      <button
                        type="button"
                        disabled={account.status !== 'active' || availableForOperationsCents === 0}
                        onClick={() => setTransferModalOpen(true)}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-white bg-emerald-700 rounded-xl hover:bg-emerald-600 transition-colors cursor-pointer disabled:opacity-50 min-h-[44px]"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        <span>Transfer</span>
                      </button>
                    </div>
                  </section>

                  {/* Account Details & Security Card */}
                  <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-900 font-display">
                          Main App Account Link
                        </h2>
                        <span className="text-xs font-mono text-slate-500">{account.currency}</span>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                          <span className="text-slate-500">Account ID</span>
                          <span className="font-mono font-semibold text-slate-900">{account.accountNumber}</span>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                          <span className="text-slate-500">Account Product</span>
                          <span className="font-medium text-slate-900">{ACCOUNT_TYPE_LABELS[account.accountType]}</span>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                          <span className="text-slate-500">Status</span>
                          <span className="font-medium text-emerald-800">{ACCOUNT_STATUS_LABELS[account.status]}</span>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                          <span className="text-slate-500">Opened Date</span>
                          <span className="text-slate-900">{formatShortDate(account.createdAt)}</span>
                        </div>
                      </div>

                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 leading-relaxed">
                        Deposits are posted exclusively by your branch officer in the Main App and reflect here in real time. You can check your balance, withdraw funds, and transfer to other accounts.
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setChangePwError(null);
                          setChangePwModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Change Password</span>
                      </button>
                      <PWAInstallButton variant="sidebar" />
                    </div>
                  </section>
                </div>

                {/* Recent Activity for Unlocked Account */}
                <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 font-display">
                        Recent Operations · {account.accountNumber}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Registered operations from your Main App ledger
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('activity')}
                      className="text-xs font-medium text-emerald-800 hover:underline cursor-pointer whitespace-nowrap"
                    >
                      Full Statement
                    </button>
                  </div>

                  {accountTransactions.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No operations recorded on this account yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {accountTransactions.slice(0, 6).map((tx) => {
                        const credit = isCreditTransaction(tx.type);
                        return (
                          <div
                            key={tx.id}
                            className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/60"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900">
                                {TRANSACTION_TYPE_LABELS[tx.type]}
                                {tx.counterpartyAccountNumber ? ` · ${tx.counterpartyAccountNumber}` : ''}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5 truncate">
                                <span className="font-mono">{tx.reference}</span> · {formatTimestamp(tx.createdAt)}
                                {tx.notes ? ` · ${tx.notes}` : ''}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={`text-sm font-bold font-mono tabular-nums ${
                                  credit ? 'text-emerald-800' : 'text-red-700'
                                }`}
                              >
                                {credit ? '+' : '-'}
                                {maskAmount(formatCents(tx.amountCents, tx.currency))}
                              </p>
                              <p className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                                Bal: {maskAmount(formatCents(tx.balanceAfterCents, tx.currency))}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* WITHDRAW TAB (Withdrawals Require Branch Admin or User Cat 1 Confirmation) */}
            {activeTab === 'withdraw' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleSubmitWithdrawal}
                  className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <ArrowUpRight className="w-4 h-4 text-red-700" />
                      <span>Request Withdrawal from {account.accountNumber}</span>
                    </div>
                    <span className="text-xs font-mono text-slate-500">
                      Available: {maskAmount(formatCents(availableForOperationsCents, account.currency))}
                    </span>
                  </div>

                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>
                      Your account is debited only after a Branch Admin or User Cat 1 confirms your withdrawal request. Email updates are sent when submitted, confirmed, or declined.
                    </span>
                  </div>

                  {withdrawError && (
                    <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                      {withdrawError}
                    </div>
                  )}

                  {account.status !== 'active' && (
                    <div role="alert" className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                      This account is currently {account.status}. Withdrawals are paused until reactivated by your branch.
                    </div>
                  )}

                  <div>
                    <label htmlFor="client-wd-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Withdrawal Amount ({account.currency})
                    </label>
                    <input
                      id="client-wd-amount"
                      type="text"
                      inputMode="decimal"
                      required
                      value={withdrawAmountInput}
                      onChange={(e) => setWithdrawAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3.5 py-3 text-lg border border-slate-300 rounded-xl font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      {['25.00', '50.00', '100.00', '250.00'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setWithdrawAmountInput(preset)}
                          className="px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                        >
                          {preset}
                        </button>
                      ))}
                      {availableForOperationsCents > 0 && (
                        <button
                          type="button"
                          onClick={() => setWithdrawAmountInput((availableForOperationsCents / 100).toFixed(2))}
                          className="px-3 py-1.5 text-xs font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                        >
                          Max Available
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="client-wd-channel" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Payout Channel
                      </label>
                      <select
                        id="client-wd-channel"
                        value={withdrawChannel}
                        onChange={(e) => setWithdrawChannel(e.target.value as PaymentMethod)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      >
                        {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
                          <option key={method} value={method}>
                            {PAYMENT_METHOD_LABELS[method]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="client-wd-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Note (Optional)
                      </label>
                      <input
                        id="client-wd-notes"
                        type="text"
                        maxLength={BLUEPRINT_CONSTRAINTS.NOTES_MAX}
                        value={withdrawNotes}
                        onChange={(e) => setWithdrawNotes(e.target.value)}
                        placeholder="Cash-out or bill payment"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      isPostingWithdraw ||
                      account.status !== 'active' ||
                      withdrawIsOverdraft ||
                      !parsedWithdrawAmount
                    }
                    className="w-full py-3 px-4 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-xl transition-colors cursor-pointer disabled:opacity-60 min-h-[48px]"
                  >
                    {isPostingWithdraw ? 'Submitting Request...' : 'Submit Withdrawal Request'}
                  </button>
                </form>

                {/* Live Balance Impact Summary + Withdrawal Requests Status */}
                <aside className="lg:col-span-5 space-y-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                    <h2 className="text-sm font-semibold text-slate-900 font-display">
                      Balance Impact Preview
                    </h2>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Account ID</span>
                        <span className="font-mono font-medium text-slate-900">
                          {account.accountNumber}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Ledger Balance (Solde)</span>
                        <span className="font-mono tabular-nums font-medium text-slate-900">
                          {formatCents(account.balanceCents, account.currency)}
                        </span>
                      </div>
                      {pendingWithdrawalCents > 0 && (
                        <div className="flex items-center justify-between text-amber-800">
                          <span>Pending Withdrawal Holds</span>
                          <span className="font-mono tabular-nums font-medium">
                            -{formatCents(pendingWithdrawalCents, account.currency)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Requested Withdrawal</span>
                        <span className="font-mono tabular-nums font-semibold text-red-700">
                          -{formatCents(parsedWithdrawAmount ?? 0, account.currency)}
                        </span>
                      </div>
                      <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                        <span className="font-semibold text-slate-900">Available After Confirmation</span>
                        <span
                          className={`text-lg font-bold font-mono tabular-nums ${
                            withdrawIsOverdraft ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {formatCents(withdrawProjectedBalance, account.currency)}
                        </span>
                      </div>
                    </div>
                    {withdrawIsOverdraft && (
                      <p className="text-xs text-red-700 font-medium">
                        Amount exceeds your available balance.
                      </p>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-900 font-display">
                        Withdrawal Requests ({withdrawalRequests.length})
                      </h3>
                      <span className="text-[11px] text-slate-500">Branch confirmation status</span>
                    </div>
                    {withdrawalRequests.length === 0 ? (
                      <div className="p-5 text-xs text-slate-500">
                        No withdrawal requests submitted yet.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {withdrawalRequests.slice(0, 8).map((req) => (
                          <div key={req.id} className="px-5 py-3 flex items-start justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <p className="font-mono font-semibold text-slate-900">
                                {req.reference} · {formatCents(req.amountCents, req.currency)}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {PAYMENT_METHOD_LABELS[req.paymentMethod]} · {formatTimestamp(req.createdAt)}
                              </p>
                              {req.reviewNote && (
                                <p className="text-[11px] text-slate-600 mt-0.5 truncate">
                                  Note: {req.reviewNote}
                                </p>
                              )}
                            </div>
                            <span
                              className={`shrink-0 inline-flex items-center gap-1 font-medium ${
                                req.status === 'approved'
                                  ? 'text-emerald-800'
                                  : req.status === 'rejected'
                                    ? 'text-red-700'
                                    : 'text-amber-800'
                              }`}
                            >
                              {req.status === 'approved' && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {req.status === 'rejected' && <XCircle className="w-3.5 h-3.5" />}
                              {req.status === 'pending' && <Clock className="w-3.5 h-3.5" />}
                              <span>
                                {req.status === 'approved'
                                  ? 'Confirmed'
                                  : req.status === 'rejected'
                                    ? 'Declined'
                                    : 'Pending'}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            )}

            {/* TRANSFER TAB */}
            {activeTab === 'transfer' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleInlineTransferSubmit}
                  className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
                >
                  {trfError && (
                    <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                      {trfError}
                    </div>
                  )}

                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <p className="text-slate-500">From Main App Account</p>
                      <p className="font-mono font-semibold text-slate-900 mt-0.5">
                        {account.accountNumber} · {ACCOUNT_TYPE_LABELS[account.accountType]}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-500">Available for Operations</p>
                      <p className="font-mono tabular-nums font-bold text-slate-900 mt-0.5">
                        {maskAmount(formatCents(availableForOperationsCents, account.currency))}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <label htmlFor="inline-trf-num" className="block text-xs font-medium text-slate-700">
                      Recipient Main App Account ID
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="inline-trf-num"
                        type="text"
                        maxLength={BLUEPRINT_CONSTRAINTS.ACCOUNT_NUMBER_MAX}
                        value={trfAcctNum}
                        onChange={(e) => {
                          setTrfAcctNum(e.target.value.toUpperCase());
                          setTrfRecipient(null);
                          setTrfLookupError(null);
                        }}
                        placeholder="MF-2026-48219"
                        className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                      <button
                        type="button"
                        disabled={isVerifyingTrf}
                        onClick={handleVerifyRecipient}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap min-h-[44px]"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>{isVerifyingTrf ? 'Checking...' : 'Verify'}</span>
                      </button>
                    </div>

                    {trfLookupError && <p className="text-xs text-red-700">{trfLookupError}</p>}

                    {trfRecipient && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-2 font-medium text-emerald-950">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>
                            {trfRecipient.customerName} ·{' '}
                            <span className="font-mono">{trfRecipient.accountNumber}</span>
                          </span>
                        </span>
                        <span className="font-mono font-semibold text-emerald-800">
                          {trfRecipient.currency}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="inline-trf-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Amount ({account.currency})
                      </label>
                      <input
                        id="inline-trf-amount"
                        type="text"
                        inputMode="decimal"
                        required
                        value={trfAmountInput}
                        onChange={(e) => setTrfAmountInput(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3.5 py-2.5 text-base border border-slate-300 rounded-xl font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                    <div>
                      <label htmlFor="inline-trf-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
                        Reference Note
                      </label>
                      <input
                        id="inline-trf-notes"
                        type="text"
                        maxLength={BLUEPRINT_CONSTRAINTS.NOTES_MAX}
                        value={trfNotes}
                        onChange={(e) => setTrfNotes(e.target.value)}
                        placeholder="Payment or transfer reason"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      isSendingTrf ||
                      account.status !== 'active' ||
                      trfIsOverdraft ||
                      !parsedTrfAmount ||
                      !trfRecipient
                    }
                    className="w-full py-3 px-4 text-sm font-semibold text-white bg-emerald-800 rounded-xl hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60 min-h-[48px]"
                  >
                    {isSendingTrf ? 'Processing Transfer...' : 'Send Transfer Now'}
                  </button>
                </form>

                <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-slate-900 font-display">
                    Transfer Summary
                  </h2>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Sending Account</span>
                      <span className="font-mono font-medium text-slate-900">
                        {account.accountNumber}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Available Balance</span>
                      <span className="font-mono tabular-nums font-medium text-slate-900">
                        {formatCents(availableForOperationsCents, account.currency)}
                      </span>
                    </div>
                    {pendingWithdrawalCents > 0 && (
                      <div className="flex items-center justify-between text-amber-800">
                        <span>Pending Withdrawal Holds</span>
                        <span className="font-mono tabular-nums font-medium">
                          -{formatCents(pendingWithdrawalCents, account.currency)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Transfer Amount</span>
                      <span className="font-mono tabular-nums font-semibold text-red-700">
                        -{formatCents(parsedTrfAmount ?? 0, account.currency)}
                      </span>
                    </div>
                    <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-900">Remaining Balance</span>
                      <span
                        className={`text-lg font-bold font-mono tabular-nums ${
                          trfIsOverdraft ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {formatCents(trfProjectedBalance, account.currency)}
                      </span>
                    </div>
                  </div>
                  {trfIsOverdraft && (
                    <p className="text-xs text-red-700 font-medium">
                      Insufficient balance for this transfer.
                    </p>
                  )}
                </aside>
              </div>
            )}

            {/* ACTIVITY, STATEMENTS & EMAIL NOTIFICATIONS TAB */}
            {activeTab === 'activity' && (
              <div className="space-y-4">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
                  <button
                    type="button"
                    onClick={() => setActivityView('statement')}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      activityView === 'statement'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Account Statement ({accountTransactions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityView('emails')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      activityView === 'emails'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Email Notifications ({emailNotifications.length})</span>
                  </button>
                </div>

                {activityView === 'statement' ? (
                  <>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="relative flex-1 max-w-md">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={activitySearch}
                          onChange={(e) => setActivitySearch(e.target.value)}
                          placeholder="Search by reference, counterparty, or note..."
                          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                          {(
                            [
                              { id: 'all', label: 'All' },
                              { id: 'withdrawals', label: 'Withdrawals' },
                              { id: 'transfers', label: 'Transfers' },
                              { id: 'deposits', label: 'Deposits' },
                            ] as { id: typeof activityFilter; label: string }[]
                          ).map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActivityFilter(tab.id)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                                activityFilter === tab.id
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          disabled={filteredTransactions.length === 0}
                          onClick={() =>
                            downloadTransactionsCsv(
                              filteredTransactions,
                              `cifia-${account.accountNumber}-statement.csv`,
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Export CSV</span>
                        </button>
                      </div>
                    </div>

                    {filteredTransactions.length === 0 ? (
                      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                        <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-slate-900">No matching operations</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Operations registered in the Main App and your self-service withdrawals or transfers appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="divide-y divide-slate-100">
                          {filteredTransactions.map((tx) => {
                            const credit = isCreditTransaction(tx.type);
                            return (
                              <div
                                key={tx.id}
                                className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/70"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                                    <span>{TRANSACTION_TYPE_LABELS[tx.type]}</span>
                                    {tx.counterpartyName && (
                                      <span className="text-slate-500 font-normal truncate">
                                        {tx.type === 'transfer_out' ? 'to' : 'from'} {tx.counterpartyName} (
                                        <span className="font-mono">{tx.counterpartyAccountNumber}</span>)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    <span className="font-mono">{tx.reference}</span> ·{' '}
                                    {PAYMENT_METHOD_LABELS[tx.paymentMethod]} · {formatTimestamp(tx.createdAt)}
                                  </div>
                                  {tx.notes && (
                                    <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xl">
                                      {tx.notes}
                                    </p>
                                  )}
                                </div>

                                <div className="text-right shrink-0">
                                  <p
                                    className={`text-sm font-bold font-mono tabular-nums ${
                                      credit ? 'text-emerald-800' : 'text-red-700'
                                    }`}
                                  >
                                    {credit ? '+' : '-'}
                                    {maskAmount(formatCents(tx.amountCents, tx.currency))}
                                  </p>
                                  <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                                    Solde: {maskAmount(formatCents(tx.balanceAfterCents, tx.currency))}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : emailNotifications.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                    <Mail className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-900">No email notifications yet</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Notifications are generated whenever an operation is submitted, completed, validated, or rejected.
                    </p>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="divide-y divide-slate-100">
                      {emailNotifications.map((notif) => (
                        <div key={notif.id} className="px-5 py-4 space-y-1.5 hover:bg-slate-50/70">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold text-slate-900">{notif.operationType}</span>
                              <span
                                className={`px-2 py-0.5 rounded-md font-semibold uppercase text-[10px] tracking-wide ${
                                  notif.outcome === 'rejected'
                                    ? 'bg-red-50 text-red-700'
                                    : notif.outcome === 'pending'
                                      ? 'bg-amber-50 text-amber-800'
                                      : 'bg-emerald-50 text-emerald-800'
                                }`}
                              >
                                {notif.outcome}
                              </span>
                              {notif.amountFormatted && (
                                <span className="font-mono font-semibold text-slate-900">
                                  {notif.amountFormatted}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500">
                              {formatTimestamp(notif.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700">{notif.details}</p>
                          <p className="text-[11px] text-slate-500">
                            To: <span className="font-medium text-slate-700">{notif.recipientEmail}</span> ·{' '}
                            {notif.reference ? <span className="font-mono">{notif.reference} · </span> : null}
                            Status:{' '}
                            <span className="font-medium">
                              {notif.deliveryStatus === 'sent'
                                ? 'Dispatched'
                                : 'Recorded In-App'}
                            </span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb Bar (<= 64px height, 44px+ hitboxes) */}
      {unlockedSession && account && (
        <nav
          aria-label="Mobile client navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200"
        >
          <div className="grid grid-cols-4 h-16">
            {(
              [
                { id: 'balance', label: 'Solde', icon: Wallet },
                { id: 'withdraw', label: 'Withdraw', icon: ArrowUpRight },
                { id: 'transfer', label: 'Transfer', icon: ArrowRightLeft },
                { id: 'activity', label: 'Activity', icon: BookOpen },
              ] as { id: ClientTab; label: string; icon: React.ComponentType<{ className?: string }> }[]
            ).map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[44px] cursor-pointer transition-colors ${
                    active ? 'text-emerald-800 font-semibold' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] leading-none">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Quick Transfer Modal (from Solde card, bounded by available balance after pending withdrawal holds) */}
      {account && (
        <TransferModal
          isOpen={transferModalOpen}
          accounts={[{ ...account, balanceCents: availableForOperationsCents }]}
          preselectedSourceId={account.id}
          onClose={() => setTransferModalOpen(false)}
          onSubmit={async ({ sourceAccountId, destinationAccountId, amountCents, notes }) => {
            if (amountCents > availableForOperationsCents || amountCents > account.balanceCents) {
              throw new Error(
                `Insufficient balance. Available funds: ${formatCents(availableForOperationsCents, account.currency)}.`,
              );
            }
            const res = await transferBetweenAccounts({
              initiatorUid: user.uid,
              sourceAccountId,
              destinationAccountId,
              amountCents,
              notes,
            });
            setLastBalanceCheckedAt(new Date());
            setToast(
              `Transferred ${formatCents(amountCents, account.currency || defaultCurrency)} to ${res.destinationCustomerName} (${res.destinationAccountNumber}).`,
            );
          }}
        />
      )}

      {/* Change Password Modal */}
      {changePwModalOpen && unlockedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-pw-title"
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="change-pw-title" className="text-base font-semibold text-slate-900 font-display">
                Change Client Password · {unlockedSession.accountNumber}
              </h2>
              <button
                type="button"
                onClick={() => setChangePwModalOpen(false)}
                aria-label="Close modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="p-6 space-y-4">
              {changePwError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {changePwError}
                </div>
              )}

              <div>
                <label htmlFor="cur-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  id="cur-pw"
                  type="password"
                  required
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label htmlFor="new-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  New Password (min. {CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN} chars)
                </label>
                <input
                  id="new-pw"
                  type="password"
                  required
                  minLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN}
                  maxLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX}
                  value={nextPw}
                  onChange={(e) => setNextPw(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label htmlFor="confirm-new-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  id="confirm-new-pw"
                  type="password"
                  required
                  minLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MIN}
                  maxLength={CLIENT_ACCESS_CONSTRAINTS.PASSWORD_MAX}
                  value={confirmNextPw}
                  onChange={(e) => setConfirmNextPw(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setChangePwModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isChangingPw}
                  className="px-4 py-2 text-sm font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 cursor-pointer disabled:opacity-60"
                >
                  {isChangingPw ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
