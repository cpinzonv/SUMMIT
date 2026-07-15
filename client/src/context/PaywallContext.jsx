import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { billingApi } from '../api/billing';
import { useAuth } from './AuthContext';
import { setPaywallHandler } from '../lib/paywallBus';
import { PaywallModal } from '../components/PaywallModal';
import { QuietNotice } from '../components/QuietNotice';
import { gateView } from '../lib/gateRouting';

/**
 * App-wide paywall. Holds /api/billing/status, opens the modal on a 402
 * usage_limit (via the paywallBus) or when a component calls openGate() directly
 * (e.g. clicking a locked premium tab). Flipping the admin toggle changes the
 * modal MODE on the next open — no redeploy — because openGate re-fetches status.
 */
const PaywallCtx = createContext(null);
export const usePaywall = () => useContext(PaywallCtx);

export function PaywallProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [gate, setGate] = useState(null); // active gate payload, or null
  const loadedFor = useRef(null); // user id we've fetched status for (null = none)

  const refresh = useCallback(async () => {
    try {
      const s = await billingApi.status();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // logShown: false when a 402 already logged 'shown' server-side (avoid double count).
  const openGate = useCallback(
    async (payload, { logShown = true } = {}) => {
      await refresh(); // fresh flags/slots decide the mode
      setGate(payload || {});
      if (logShown) billingApi.gateEvent({ gate: payload?.gate ?? null, action: 'shown' }).catch(() => {});
    },
    [refresh],
  );

  const close = useCallback(() => {
    setGate((g) => {
      if (g) billingApi.gateEvent({ gate: g.gate ?? null, action: 'dismissed' }).catch(() => {});
      return null;
    });
  }, []);

  // Register the app-wide 402 → paywall handler.
  useEffect(() => {
    setPaywallHandler((payload) => openGate(payload, { logShown: false }));
    return () => setPaywallHandler(null);
  }, [openGate]);

  // Fetch billing status ONCE per signed-in user — and NEVER while logged out.
  // /api/billing/status requires auth, so a 401 there trips the global
  // forceLogout redirect to /login. On public pages that carries the visitor
  // away mid-flow — e.g. it bounced invitees straight off /register before they
  // could sign up. Gating on `user` keeps public pages free of authed calls.
  useEffect(() => {
    if (user?.id) {
      if (loadedFor.current !== user.id) {
        loadedFor.current = user.id;
        refresh();
      }
    } else {
      loadedFor.current = null;
    }
  }, [user, refresh]);

  const onResolved = useCallback(() => refresh(), [refresh]);

  // Institutional (school-paid) students get the QuietNotice; everyone else the
  // B2C PaywallModal. account_type is the ONLY thing that decides this.
  return (
    <PaywallCtx.Provider value={{ status, refresh, openGate, close }}>
      {children}
      {gate && gateView(gate) === 'quiet' && <QuietNotice gate={gate} status={status} onClose={close} />}
      {gate && gateView(gate) === 'paywall' && (
        <PaywallModal gate={gate} status={status} onClose={close} onClaimed={onResolved} onWaitlisted={onResolved} />
      )}
    </PaywallCtx.Provider>
  );
}
