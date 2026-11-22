import React, { useEffect, useRef, useState } from 'react';
import { Camera, CreditCard, Trash2, Upload, User, X } from 'lucide-react';
import { BLUEPRINT_CONSTRAINTS, Customer, KycStatus } from '../types/microfinance';
import { CustomerInput } from '../services/ledgerService';
import { compressKycImageFile, formatApproxKb } from '../utils/imageCompression';

interface CustomerModalProps {
  isOpen: boolean;
  editingCustomer: Customer | null;
  onClose: () => void;
  onSubmit: (input: CustomerInput) => Promise<void>;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({
  isOpen,
  editingCustomer,
  onClose,
  onSubmit,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [occupation, setOccupation] = useState('');
  const [address, setAddress] = useState('');
  const [kycStatus, setKycStatus] = useState<KycStatus>('pending');
  const [profilePhotoDataUrl, setProfilePhotoDataUrl] = useState<string | null>(null);
  const [idCardPhotoDataUrl, setIdCardPhotoDataUrl] = useState<string | null>(null);
  const [processingTarget, setProcessingTarget] = useState<'profile' | 'id' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const idCardInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (editingCustomer) {
        setFullName(editingCustomer.fullName);
        setPhone(editingCustomer.phone);
        setEmail(editingCustomer.email);
        setNationalId(editingCustomer.nationalId);
        setOccupation(editingCustomer.occupation);
        setAddress(editingCustomer.address);
        setKycStatus(editingCustomer.kycStatus);
        setProfilePhotoDataUrl(editingCustomer.profilePhotoDataUrl || null);
        setIdCardPhotoDataUrl(editingCustomer.idCardPhotoDataUrl || null);
      } else {
        setFullName('');
        setPhone('');
        setEmail('');
        setNationalId('');
        setOccupation('');
        setAddress('');
        setKycStatus('pending');
        setProfilePhotoDataUrl(null);
        setIdCardPhotoDataUrl(null);
      }
      setProcessingTarget(null);
      setError(null);
      setIsSaving(false);
    }
  }, [isOpen, editingCustomer]);

  if (!isOpen) return null;

  const handlePhotoSelect = async (
    target: 'profile' | 'id',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setProcessingTarget(target);
    try {
      if (target === 'profile') {
        const result = await compressKycImageFile(file, {
          maxDimension: 420,
          maxDataUrlChars: BLUEPRINT_CONSTRAINTS.PROFILE_PHOTO_MAX,
          initialQuality: 0.76,
        });
        setProfilePhotoDataUrl(result.dataUrl);
      } else {
        const result = await compressKycImageFile(file, {
          maxDimension: 1024,
          maxDataUrlChars: BLUEPRINT_CONSTRAINTS.ID_CARD_PHOTO_MAX,
          initialQuality: 0.8,
        });
        setIdCardPhotoDataUrl(result.dataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process selected image.');
    } finally {
      setProcessingTarget(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < BLUEPRINT_CONSTRAINTS.FULL_NAME_MIN) {
      setError('Please enter the customer full name (at least 2 characters).');
      return;
    }
    if (phone.trim().length < BLUEPRINT_CONSTRAINTS.PHONE_MIN) {
      setError('Please enter a valid phone number (at least 5 characters).');
      return;
    }
    if (nationalId.trim().length < BLUEPRINT_CONSTRAINTS.NATIONAL_ID_MIN) {
      setError('Please enter a National ID or KYC reference.');
      return;
    }
    if (occupation.trim().length < BLUEPRINT_CONSTRAINTS.OCCUPATION_MIN) {
      setError('Please enter the customer occupation or business activity.');
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        nationalId: nationalId.trim(),
        occupation: occupation.trim(),
        address: address.trim(),
        kycStatus,
        profilePhotoDataUrl,
        idCardPhotoDataUrl,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save customer profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const docsMissing = !profilePhotoDataUrl || !idCardPhotoDataUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-modal-title"
        className="w-full max-w-2xl max-h-[92vh] bg-white border border-slate-200 rounded-xl shadow-lg flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 id="customer-modal-title" className="text-base font-semibold text-slate-900 font-display">
              {editingCustomer ? 'Edit Customer KYC Profile' : 'Register New Customer'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Record identity details now — profile photo and ID card can be attached now or completed later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="cust-fullname" className="block text-xs font-medium text-slate-700 mb-1.5">
                Full Legal Name
              </label>
              <input
                id="cust-fullname"
                type="text"
                required
                maxLength={BLUEPRINT_CONSTRAINTS.FULL_NAME_MAX}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Amina Wanjiku"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="cust-phone" className="block text-xs font-medium text-slate-700 mb-1.5">
                Phone Number
              </label>
              <input
                id="cust-phone"
                type="tel"
                required
                maxLength={BLUEPRINT_CONSTRAINTS.PHONE_MAX}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+254 712 440 819"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700 font-mono"
              />
            </div>

            <div>
              <label htmlFor="cust-national-id" className="block text-xs font-medium text-slate-700 mb-1.5">
                National ID / KYC Ref
              </label>
              <input
                id="cust-national-id"
                type="text"
                required
                maxLength={BLUEPRINT_CONSTRAINTS.NATIONAL_ID_MAX}
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="NID-2984410"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700 font-mono"
              />
            </div>

            <div>
              <label htmlFor="cust-occupation" className="block text-xs font-medium text-slate-700 mb-1.5">
                Occupation / Enterprise
              </label>
              <input
                id="cust-occupation"
                type="text"
                required
                maxLength={BLUEPRINT_CONSTRAINTS.OCCUPATION_MAX}
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                placeholder="Produce & Grain Trade"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="cust-kyc" className="block text-xs font-medium text-slate-700 mb-1.5">
                KYC Verification
              </label>
              <select
                id="cust-kyc"
                value={kycStatus}
                onChange={(e) => setKycStatus(e.target.value as KycStatus)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              >
                <option value="verified">Verified</option>
                <option value="pending">Pending Review (Complete Later)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cust-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                Email Address (Optional)
              </label>
              <input
                id="cust-email"
                type="email"
                maxLength={BLUEPRINT_CONSTRAINTS.EMAIL_MAX}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>

            <div>
              <label htmlFor="cust-address" className="block text-xs font-medium text-slate-700 mb-1.5">
                Physical Address / Stall (Optional)
              </label>
              <input
                id="cust-address"
                type="text"
                maxLength={BLUEPRINT_CONSTRAINTS.ADDRESS_MAX}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Stall 14, Central Market Road"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700"
              />
            </div>
          </div>

          {/* Optional KYC Photos (Complete Now or Later) */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  KYC Photo &amp; ID Card (Optional — Can Complete Later)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Images are automatically compressed for branch storage. Leave blank if not yet available.
                </p>
              </div>
              {!docsMissing && kycStatus === 'pending' && (
                <button
                  type="button"
                  onClick={() => setKycStatus('verified')}
                  className="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer"
                >
                  Mark KYC Verified
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Customer Profile Photo */}
              <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/70 flex items-center gap-3.5">
                <input
                  ref={profileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  onChange={(e) => handlePhotoSelect('profile', e)}
                  className="hidden"
                />
                {profilePhotoDataUrl ? (
                  <img
                    src={profilePhotoDataUrl}
                    alt="Customer portrait preview"
                    className="w-16 h-16 rounded-lg object-cover border border-slate-200 bg-white shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0">
                    <User className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">Customer Profile Photo</p>
                    <p className="text-[11px] text-slate-500">
                      {processingTarget === 'profile'
                        ? 'Compressing image...'
                        : profilePhotoDataUrl
                          ? `Attached · ${formatApproxKb(profilePhotoDataUrl.length)}`
                          : 'Optional · Upload later'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={processingTarget !== null}
                      onClick={() => profileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-3 h-3" />
                      <span>{profilePhotoDataUrl ? 'Replace' : 'Add Photo'}</span>
                    </button>
                    {profilePhotoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setProfilePhotoDataUrl(null)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Customer National ID Card */}
              <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/70 flex items-center gap-3.5">
                <input
                  ref={idCardInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  onChange={(e) => handlePhotoSelect('id', e)}
                  className="hidden"
                />
                {idCardPhotoDataUrl ? (
                  <img
                    src={idCardPhotoDataUrl}
                    alt="Customer ID card preview"
                    className="w-20 h-16 rounded-lg object-cover border border-slate-200 bg-white shrink-0"
                  />
                ) : (
                  <div className="w-20 h-16 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-400 shrink-0">
                    <CreditCard className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">National ID Card</p>
                    <p className="text-[11px] text-slate-500">
                      {processingTarget === 'id'
                        ? 'Compressing ID scan...'
                        : idCardPhotoDataUrl
                          ? `Attached · ${formatApproxKb(idCardPhotoDataUrl.length)}`
                          : 'Optional · Upload later'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={processingTarget !== null}
                      onClick={() => idCardInputRef.current?.click()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      <span>{idCardPhotoDataUrl ? 'Replace' : 'Add ID Card'}</span>
                    </button>
                    {idCardPhotoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setIdCardPhotoDataUrl(null)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {docsMissing && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {!profilePhotoDataUrl && !idCardPhotoDataUrl
                  ? 'Neither profile photo nor ID card is attached yet. You can save now and complete KYC later from this customer’s profile.'
                  : !profilePhotoDataUrl
                    ? 'Customer profile photo is still missing — you can save now and upload it later.'
                    : 'Customer ID card scan is still missing — you can save now and upload it later.'}
              </p>
            )}
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
              disabled={isSaving || processingTarget !== null}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSaving
                ? 'Saving...'
                : editingCustomer
                  ? 'Save KYC Changes'
                  : docsMissing
                    ? 'Save & Complete KYC Later'
                    : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
