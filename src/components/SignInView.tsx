import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Landmark,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface SignInViewProps {
  onSignIn: () => Promise<void>;
  isSigningIn: boolean;
  authError: string | null;
}

export const SignInView: React.FC<SignInViewProps> = ({
  onSignIn,
  isSigningIn,
  authError,
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap font-display">
              Cairn Microfinance
            </span>
            <span className="text-xs font-medium text-emerald-800 whitespace-nowrap hidden sm:inline">
              Client App
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#capabilities" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Live Solde
            </a>
            <a href="#capabilities" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Withdrawals
            </a>
            <a href="#capabilities" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Transfers
            </a>
          </nav>
          <button
            type="button"
            onClick={onSignIn}
            disabled={isSigningIn}
            className="px-4 py-2 bg-emerald-800 text-white text-sm font-medium rounded-lg hover:bg-emerald-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {isSigningIn ? 'Signing in...' : 'Client Sign In'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-7xl mx-auto w-full px-6 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-800 tracking-wide mb-3">
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span>Customer Self-Service Banking</span>
              </div>
              <h1
                className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-slate-900 leading-[1.12] mb-5 font-display"
                style={{ textWrap: 'balance' }}
              >
                Check your balance, withdraw funds, and send instant transfers.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
                Access the account opened for you using your Account ID and self-created password. Check your live balance (solde), request withdrawals, and send transfers anytime.
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-10">
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={isSigningIn}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 bg-emerald-800 text-white text-sm font-semibold rounded-lg hover:bg-emerald-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                >
                  <span>
                    {isSigningIn ? 'Connecting...' : 'Open Client App with Google'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="shrink-0">
                  <PWAInstallButton variant="sidebar" />
                </div>
                <span className="text-xs text-slate-500">
                  Account ID + Password required · Verified account access
                </span>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="mb-8 p-3.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
                >
                  {authError}
                </div>
              )}

              <div id="capabilities" className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-slate-200">
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1.5">
                    <Wallet className="w-4 h-4 text-emerald-800 shrink-0" />
                    <span>Live Solde Check</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    View your exact available balance, branch deposits, and posted account ledger.
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1.5">
                    <ArrowRightLeft className="w-4 h-4 text-emerald-800 shrink-0" />
                    <span>Instant Transfers</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Send transfers from your account to any verified Cairn Microfinance Account ID.
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-800 shrink-0" />
                    <span>Self Withdrawals</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Submit cash-out or mobile money withdrawal requests with real-time overdraft guards.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 flex">
              <div className="w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100 relative min-h-[340px] lg:min-h-[480px]">
                {!imageFailed ? (
                  <>
                    <img
                      src="/src/assets/images/microfinance_branch_desk_1795204587946.jpg"
                      alt="Customer banking desk representing Cairn Microfinance self-service account access"
                      referrerPolicy="no-referrer"
                      onError={() => setImageFailed(true)}
                      className="w-full h-full object-cover lg:h-full"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/45 to-transparent p-6">
                      <p className="text-sm font-medium text-white">
                        Direct customer access to balances, withdrawals, and verified account transfers.
                      </p>
                      <p className="text-xs text-slate-200 mt-1">
                        Savings · Business Capital · Group Solidarity · Fixed Deposits
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-10 bg-gradient-to-br from-slate-100 to-emerald-50 text-center">
                    <Landmark className="w-12 h-12 text-emerald-800 mb-3" />
                    <p className="text-base font-semibold text-slate-900">Cairn Microfinance</p>
                    <p className="text-xs text-slate-600 mt-1 max-w-xs">
                      Sign in with your Google account to access your Client App.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
