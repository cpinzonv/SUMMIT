/** Billing / fake-door paywall API. No Stripe — see server/src/services/billing.service.js. */
import { api } from './client';

export const billingApi = {
  status: () => api.get('/api/billing/status').then((r) => r.data),
  claimFounding: () => api.post('/api/billing/claim-founding').then((r) => r.data),
  joinWaitlist: (body) => api.post('/api/billing/waitlist', body).then((r) => r.data),
  gateEvent: (body) => api.post('/api/billing/gate-event', body).then((r) => r.data),
  // Real checkout — 501 today. Only reachable in real mode (both flags on).
  checkout: (body) => api.post('/api/billing/checkout', body).then((r) => r.data),

  admin: {
    flags: () => api.get('/api/billing/admin/flags').then((r) => r.data),
    setFlag: (key, value) => api.patch('/api/billing/admin/flags', { key, value }).then((r) => r.data),
    founding: () => api.get('/api/billing/admin/founding').then((r) => r.data),
    waitlist: () => api.get('/api/billing/admin/waitlist').then((r) => r.data),
    waitlistCsvUrl: '/api/billing/admin/waitlist.csv',
    gateAnalytics: (params) => api.get('/api/billing/admin/gate-analytics', { params }).then((r) => r.data),
  },
};
