import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { billingApi } from '../api/billing';
import { setPaywallHandler } from '../lib/paywallBus';
import { PaywallModal } from '../components/PaywallModal';

/**
 * App-wide paywall. Holds /api/billing/status, opens the modal on a 402
 * usage_limit (via the paywallBus) or when a component calls openGate() directly
 * (e.g. clicking a locked premium tab). Flipping the admin toggle changes the
 * modal MODE on the next open — no redeploy — because openGate re-fetches status.
 */
const PaywallCtx = createContext(null);
export const usePaywall = () => useContext(PaywallCtx);

export function PaywallProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [gate, setGate] = useState(null); // active gate payload, or null
  const loaded = useRef(false);

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

  useEffect(() => {
    setPaywallHandler((payload) => openGate(payload, { logShown: false }));
    if (!loaded.current) {
      loaded.current = true;
      refresh();
    }
    return () => setPaywallHandler(null);
  }, [openGate, refresh]);

  const onResolved = useCallback(() => refresh(), [refresh]);

  return (
    <PaywallCtx.Provider value={{ status, refresh, openGate, close }}>
      {children}
      {gate && (
        <PaywallModal gate={gate} status={status} onClose={close} onClaimed={onResolved} onWaitlisted={onResolved} />
      )}
    </PaywallCtx.Provider>
  );
}
