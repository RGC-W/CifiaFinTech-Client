import React, { useState } from 'react';
import { MonitorDown, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'settings';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'sidebar' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    if (variant === 'settings') {
      return (
        <p className="text-xs font-medium text-emerald-800">
          Running in installed standalone desktop window mode.
        </p>
      );
    }
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'sidebar'
            ? 'w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer whitespace-nowrap'
            : 'inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-800 rounded-lg hover:bg-emerald-900 transition-colors cursor-pointer whitespace-nowrap'
        }
      >
        <MonitorDown className="w-3.5 h-3.5 shrink-0" />
        <span>Install Desktop App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
        >
          <MonitorDown className="w-3.5 h-3.5 shrink-0" />
          <span>Install on iOS</span>
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold text-slate-900 font-display">
                  Install on iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  aria-label="Close instructions"
                  className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="mt-4 w-full py-2 text-xs font-medium text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (variant === 'settings') {
    return (
      <p className="text-xs text-slate-600 leading-relaxed">
        In Microsoft Edge or Google Chrome on Windows, click the <strong>Install</strong> icon in the browser address bar (or open browser menu &rarr; <strong>Apps</strong> &rarr; <strong>Install this site as an app</strong>) to pin Cifia Fintech to your Desktop and Start Menu.
      </p>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-medium text-white shadow-md"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — Reconnect to sync new ledger operations</span>
    </div>
  );
};
