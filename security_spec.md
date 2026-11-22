# Microfinance Ledger & Client Self-Service Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Ownership & Client Account Access**:
   - `/users/{userId}` is strictly private to `request.auth.uid == userId`.
   - `/customers/{customerId}`, `/accounts/{accountId}`, and `/transactions/{transactionId}` are accessible to the managing branch officer (`ownerId == request.auth.uid`) or the verified customer linked via `clientUid == request.auth.uid` or normalized `customerEmail == request.auth.token.email.lower()`.
   - `/clientAccess/{accountNumber}` stores salted PBKDF2-SHA256 client password credentials (`passwordSalt`, `passwordHash`) with `allow list: if false;` and `allow get` restricted so existing credentials are only readable by `clientUid == request.auth.uid` or `ownerId == request.auth.uid`.
2. **Verified Email Gate**: All mutations require `request.auth != null && request.auth.token.email_verified == true`.
3. **No Client-Side Money Creation (Deposits Restricted to Main App)**:
   - Clients (`request.auth.uid != ownerId`) CANNOT create `deposit` transactions, CANNOT increase their own account balance via Action 1, and CANNOT open funded accounts on `/accounts`. Only the Branch Officer in the Main App can create accounts and record deposits.
4. **Admin-Validated Client Enrollment Gate (Action 5)**:
   - Client self-service registrations on `/clientAccess/{accountNumber}` require customer email, password hash, and Main App Account ID, and are created strictly with `approvalStatus: 'pending'` WITHOUT linking `clientUid` or `clientAccessApproved: true` on `/accounts/{accountId}`.
   - Unapproved clients (`approvalStatus != 'approved'` or `account.clientAccessApproved != true`) CANNOT read `/accounts/{accountId}` or execute withdrawals/transfers. Only the Branch Owner (Admin) can validate `client_account_activation` and atomically set `clientUid`, `clientAccessApproved: true`, and `customerEmail` on `/accounts/{accountId}`.
5. **Directory Lookup Isolation (`/accountDirectory/{accountNumber}`)**:
   - `allow list: if false;` prevents directory scraping.
   - `allow get` is only permitted by exact `accountNumber` (`^[A-Z0-9\-]+$`, 4–24 chars) for enrollment verification and transfer routing without exposing customer PII (`email`, `phone`, `nationalId`, `address`, or `balanceCents`).
6. **Cent-Denominated Balance Conservation & Atomic Peer Transfers**:
   - `balanceCents >= 0`, `totalDepositsCents >= 0`, `totalWithdrawalsCents >= 0`, `transactionCount >= 0`, `balanceCents == totalDepositsCents - totalWithdrawalsCents`.
   - Incoming peer transfer credits (`transfer_in` via Action 2) must be bound atomically via `getAfter` to a valid `transfer_out` transaction created in the same batch by `request.auth.uid`.
7. **Immutable Audit Ledger & Terminal Account Locking**:
   - `/transactions/{transactionId}` updates are always forbidden (`allow update: if false;`), and deletions are restricted strictly to the Branch Owner (`ownerId == request.auth.uid`, Admin role in UI) atomically paired with an exact balance/counter reversal (`lastDeletedTxId` via Action 6 on `/accounts/{accountId}`).
   - Closed accounts cannot be modified, and `createdAt`/`updatedAt` must equal `request.time`.
8. **Single Admin & Unlimited User Cat 1 Staff RBAC (`/staffUsers/{staffId}`)**:
   - Only ONE Admin document per branch is permitted (`role == 'admin'` strictly requires `staffId == 'admin_' + ownerId`), whereas any number of `cat1` tellers may be created with unique email, username, and salted PBKDF2-SHA256 credentials.
   - `cat1` staff cannot escalate their own role (`incoming().role == existing().role`) and cannot directly execute withdrawals above `35000` cents (`$350.00`) without an Admin-approved `/approvalRequests/{requestId}` document.
9. **Approval Messages, Client Withdrawals, Daily Cash Reports & Email Receipts (`/approvalRequests`, `/dailyReports`, `/emailNotifications`)**:
   - `/approvalRequests/{requestId}` can only be created with `status == 'pending'`, and once reviewed (`approved` / `rejected`) is terminally locked. Client withdrawals (`requestType == 'client_withdrawal'`) must never exceed the customer's available balance and require confirmation by Admin or User Cat 1 before debiting `/accounts/{accountId}`. `client_account_activation`, `withdrawal_over_limit`, and `delete_operation` remain strictly Admin-only.
   - `/dailyReports/{reportId}` strictly enforces the drawer cash invariant `endingCashCents == startingCashCents - cashWithdrawalsCents + cashDepositsCents`.
   - `/emailNotifications/{notificationId}` records immutable operation receipts (`operationType`, `outcome`, `recipientEmail`) in Firestore for customer visibility.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Customer Read**: `GET /customers/cust_1` with `auth: null`.
2. **Client Attempting Self-Deposit**: Client (`uid != ownerId`) attempts `CREATE /transactions/tx_dep` with `type: "deposit"` or Action 1 `balanceCents` increase.
3. **Client Credential Enumeration**: `LIST /clientAccess` to enumerate registered client accounts or password hashes.
4. **Cross-User Password Hash Read**: `GET /clientAccess/MF-2026-10001` signed in as a user who is neither `clientUid` nor `ownerId`.
5. **Duplicate Enrollment / Account Hijack**: Attempting Action 5 `clientUid` overwrite on an `/accounts/{accountId}` that already has `clientUid` set.
6. **Second Admin Creation Attempt**: `CREATE /staffUsers/admin_2` with `role: "admin"` (violates `staffId == 'admin_' + request.auth.uid`).
7. **Staff Privilege Escalation**: `UPDATE /staffUsers/cat1_abc` changing `role` from `"cat1"` to `"admin"`.
8. **Cat 1 Direct Over-Limit Withdrawal**: `CREATE /transactions/tx_wd` with `staffRole: "cat1"`, `type: "withdrawal"`, `amountCents: 35001` without an approved `approvalRequestId`.
9. **Standalone Balance Tamper via Action 6**: `UPDATE /accounts/acc_1` claiming `lastDeletedTxId` without actually deleting that transaction in the same atomic write.
10. **Daily Report Cash Math Forgery**: `CREATE /dailyReports/rep_1` where `endingCashCents != startingCashCents - cashWithdrawalsCents + cashDepositsCents`.
11. **Approval Request Re-Opening**: `UPDATE /approvalRequests/req_1` changing `status` after it is already `"approved"` or `"rejected"`.
12. **Shadow Field Injection**: Adding `"isAdmin": true` or `"plaintextPassword": "..."` to `/clientAccess/{accountNumber}`, `/staffUsers/{staffId}`, or `/accounts/{accountId}`.
