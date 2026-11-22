import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  Eye,
  Lock,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  Account,
  Customer,
  StaffRole,
} from '../types/microfinance';
import { formatCents, formatShortDate } from '../utils/currency';

interface CustomerDetailDrawerProps {
  customer: Customer | null;
  accounts: Account[];
  staffRole?: StaffRole;
  onClose: () => void;
  onEditCustomer: (customer: Customer) => void;
  onDeleteCustomer: (customerId: string, linkedAccountsCount: number) => Promise<void>;
  onOpenAccountForCustomer: (customerId: string) => void;
  onInspectAccount: (accountId: string) => void;
  onStartOperation: (accountId: string, type: 'deposit' | 'withdrawal') => void;
}

export const CustomerDetailDrawer: React.FC<CustomerDetailDrawerProps> = ({
  customer,
  accounts,
  staffRole = 'admin',
  onClose,
  onEditCustomer,
  onDeleteCustomer,
  onOpenAccountForCustomer,
  onInspectAccount,
  onStartOperation,
}) => {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ title: string; src: string } | null>(null);

  if (!customer) return null;

  const isAdmin = staffRole === 'admin';
  const customerAccounts = accounts.filter((a) => a.customerId === customer.id);
  const hasProfilePhoto = Boolean(customer.profilePhotoDataUrl);
  const hasIdCard = Boolean(customer.idCardPhotoDataUrl);
  const kycDocsIncomplete = !hasProfilePhoto || !hasIdCard;

  const totalsByCurrency = customerAccounts.reduce<Record<string, number>>((acc, acct) => {
    acc[acct.currency] = (acc[acct.currency] || 0) + acct.balanceCents;
    return acc;
  }, {});

  const handleDelete = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await onDeleteCustomer(customer.id, customerAccounts.length);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to remove customer.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Customer Profile ${customer.fullName}`}
        className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            {isAdmin && (
              customer.profilePhotoDataUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    setLightboxImage({
                      title: `${customer.fullName} — Profile Photo`,
                      src: customer.profilePhotoDataUrl!,
                    })
                  }
                  className="shrink-0 rounded-lg overflow-hidden border border-slate-200 hover:opacity-90 transition-opacity cursor-pointer"
                  title="View customer profile photo"
                >
                  <img
                    src={customer.profilePhotoDataUrl}
                    alt={customer.fullName}
                    className="w-12 h-12 object-cover"
                  />
                </button>
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                  <User className="w-5 h-5" />
                </div>
              )
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                {isAdmin && (
                  <>
                    <span className="font-mono text-slate-700">{customer.nationalId}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {customer.kycStatus === 'verified' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>KYC Verified</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    <span>KYC Pending</span>
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold text-slate-900 font-display truncate">{customer.fullName}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAdmin ? `${customer.occupation} · ` : ''}Member since {formatShortDate(customer.createdAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customer drawer"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {deleteError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {deleteError}
            </div>
          )}

          {/* KYC Contact Grid & Documents (Full for Admin, Basic-Info Notice for User Cat 1) */}
          {isAdmin ? (
            <>
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-slate-500">Phone</p>
                  <p className="font-mono text-slate-900 font-medium mt-0.5">{customer.phone}</p>
                </div>
                <div>
                  <p className="text-slate-500">Email</p>
                  <p className="text-slate-900 font-medium mt-0.5 truncate">
                    {customer.email || 'Not provided'}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-slate-500">Business / Residential Address</p>
                  <p className="text-slate-900 font-medium mt-0.5">
                    {customer.address || 'Not recorded'}
                  </p>
                </div>
              </div>

              {/* KYC Photo & ID Card Section */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">
                      Branch KYC Documents
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {kycDocsIncomplete
                        ? 'Upload missing documents below to complete branch KYC.'
                        : 'Profile photo and National ID card on file.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEditCustomer(customer)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{kycDocsIncomplete ? 'Complete KYC' : 'Update Docs'}</span>
                  </button>
                </div>

                {kycDocsIncomplete && (
                  <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                    <span>
                      {!hasProfilePhoto && !hasIdCard
                        ? 'Profile photo and National ID card are not uploaded yet.'
                        : !hasProfilePhoto
                          ? 'Customer profile photo is still pending.'
                          : 'National ID card scan is still pending.'}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Profile Photo Card */}
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70 flex items-center gap-3">
                    {customer.profilePhotoDataUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxImage({
                            title: `${customer.fullName} — Profile Photo`,
                            src: customer.profilePhotoDataUrl!,
                          })
                        }
                        className="relative group shrink-0 rounded-md overflow-hidden border border-slate-200 cursor-pointer"
                      >
                        <img
                          src={customer.profilePhotoDataUrl}
                          alt="Customer profile"
                          className="w-14 h-14 object-cover"
                        />
                        <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                          <Eye className="w-4 h-4" />
                        </span>
                      </button>
                    ) : (
                      <div className="w-14 h-14 rounded-md border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900">Profile Photo</p>
                      {customer.profilePhotoDataUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxImage({
                              title: `${customer.fullName} — Profile Photo`,
                              src: customer.profilePhotoDataUrl!,
                            })
                          }
                          className="text-[11px] font-medium text-emerald-800 hover:underline mt-0.5 cursor-pointer"
                        >
                          View full photo
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEditCustomer(customer)}
                          className="text-[11px] font-medium text-amber-800 hover:underline mt-0.5 cursor-pointer"
                        >
                          Upload photo
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ID Card Photo Card */}
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/70 flex items-center gap-3">
                    {customer.idCardPhotoDataUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxImage({
                            title: `${customer.fullName} — ID Card (${customer.nationalId})`,
                            src: customer.idCardPhotoDataUrl!,
                          })
                        }
                        className="relative group shrink-0 rounded-md overflow-hidden border border-slate-200 cursor-pointer"
                      >
                        <img
                          src={customer.idCardPhotoDataUrl}
                          alt="Customer ID card"
                          className="w-20 h-14 object-cover"
                        />
                        <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                          <Eye className="w-4 h-4" />
                        </span>
                      </button>
                    ) : (
                      <div className="w-20 h-14 rounded-md border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0">
                        <CreditCard className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900">National ID Card</p>
                      {customer.idCardPhotoDataUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxImage({
                              title: `${customer.fullName} — ID Card (${customer.nationalId})`,
                              src: customer.idCardPhotoDataUrl!,
                            })
                          }
                          className="text-[11px] font-medium text-emerald-800 hover:underline mt-0.5 cursor-pointer"
                        >
                          Inspect ID card
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEditCustomer(customer)}
                          className="text-[11px] font-medium text-amber-800 hover:underline mt-0.5 cursor-pointer"
                        >
                          Upload ID card
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex items-start gap-2.5 text-xs text-slate-600">
              <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <span>
                Basic client view active for <strong className="text-slate-800">User Cat 1</strong>. Sensitive KYC details (National ID, ID card scan, phone, email, address) and KYC editing are restricted to the Admin.
              </span>
            </div>
          )}

          {/* Combined Customer Balance Summary */}
          <div className="border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500">Total Customer Balance ({customerAccounts.length} accounts)</p>
              {Object.keys(totalsByCurrency).length === 0 ? (
                <p className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">$0.00</p>
              ) : (
                <div className="flex flex-wrap items-baseline gap-4 mt-1">
                  {Object.entries(totalsByCurrency).map(([curr, cents]) => (
                    <span key={curr} className="text-xl font-bold text-slate-900 font-mono tabular-nums">
                      {formatCents(cents, curr as Account['currency'])}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenAccountForCustomer(customer.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Open Account</span>
            </button>
          </div>

          {/* Customer Accounts List */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 font-display mb-3">
              Linked Accounts
            </h3>
            {customerAccounts.length === 0 ? (
              <div className="border border-slate-200 rounded-xl p-6 text-center">
                <p className="text-sm font-medium text-slate-900">No accounts opened yet</p>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  Open a savings, business, or solidarity account for {customer.fullName}.
                </p>
                <button
                  type="button"
                  onClick={() => onOpenAccountForCustomer(customer.id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Open First Account</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {customerAccounts.map((acct) => (
                  <div key={acct.id} className="p-4 bg-white hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <button
                          type="button"
                          onClick={() => onInspectAccount(acct.id)}
                          className="font-mono text-sm font-semibold text-emerald-800 hover:underline cursor-pointer"
                        >
                          {acct.accountNumber}
                        </button>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {ACCOUNT_TYPE_LABELS[acct.accountType]} · {ACCOUNT_STATUS_LABELS[acct.status]} ·{' '}
                          {acct.transactionCount} ops
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold text-slate-900 font-mono tabular-nums">
                          {formatCents(acct.balanceCents, acct.currency)}
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                          +{formatCents(acct.totalDepositsCents, acct.currency)} / -
                          {formatCents(acct.totalWithdrawalsCents, acct.currency)}
                        </p>
                      </div>
                    </div>
                    {acct.status === 'active' && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => onStartOperation(acct.id, 'deposit')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 rounded-md hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          <ArrowDownLeft className="w-3.5 h-3.5" />
                          <span>Deposit</span>
                        </button>
                        <button
                          type="button"
                          disabled={acct.balanceCents === 0}
                          onClick={() => onStartOperation(acct.id, 'withdrawal')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>Withdraw</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectAccount(acct.id)}
                          className="ml-auto text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          View Statement
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions (Admin only) */}
        {isAdmin && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isDeleting ? 'Removing...' : 'Delete Customer'}</span>
            </button>
            <button
              type="button"
              onClick={() => onEditCustomer(customer)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit KYC Profile</span>
            </button>
          </div>
        )}
      </div>

      {/* Document Lightbox Preview */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-2xl w-full bg-white rounded-xl overflow-hidden shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-900 truncate">{lightboxImage.title}</p>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="Close document preview"
                className="p-1 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center">
              <img
                src={lightboxImage.src}
                alt={lightboxImage.title}
                className="max-h-[75vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
