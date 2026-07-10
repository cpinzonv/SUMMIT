import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { api, errorMessage } from '../api/client';
import { Spinner, ErrorBanner, EmptyState } from '../components/ui';
import { PremiumWhitelist } from '../components/PremiumWhitelist';
import MonetizationAdmin from '../components/admin/MonetizationAdmin';
import { InstitutionsAdmin } from '../components/InstitutionsAdmin';

const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes

// Summit accent palette — reused for the categorical bar charts.
const BAR_COLORS = ['#ff7a52', '#3fb8c0', '#5aa9d6', '#7e8fe0', '#ff9a3d', '#e8739c', '#5fbf77'];
const LINE_COLOR = '#5aa9d6';

/** Fill in any missing days in the last 30 so the line chart reads continuously. */
function fillSignupDays(rows) {
  const byDate = new Map((rows || []).map((r) => [r.date, r.count]));
  const out = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDate.get(key) || 0 });
  }
  return out;
}

/** Turn a { label: count } map into the array shape Recharts wants. */
function mapToData(map) {
  return Object.entries(map || {}).map(([label, count]) => ({ label, count }));
}

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A glassy stat card for the top-line overview numbers. */
function StatCard({ label, value, accent }) {
  return (
    <div className="glass-panel relative overflow-hidden p-5">
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: accent || 'var(--grad-teal-purple)' }}
      />
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-ink">{value}</p>
    </div>
  );
}

/** A titled glass panel wrapper for each chart/section. */
function Panel({ title, subtitle, children }) {
  return (
    <div className="glass-panel p-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.6)',
  background: 'rgba(255,255,255,0.92)',
  backdropFilter: 'blur(8px)',
  fontSize: 13,
};

export default function AdminAnalytics() {
  const [data, setData] = useState(null); // { overview, signups, referrals, activity, lms }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab, setTab] = useState('analytics'); // 'analytics' | 'institutions'
  const timerRef = useRef(null);

  const load = useCallback(async ({ initial = false } = {}) => {
    initial ? setLoading(true) : setRefreshing(true);
    setError('');
    try {
      const [overview, signups, referrals, activity, lms] = await Promise.all([
        api.get('/api/admin/analytics/overview'),
        api.get('/api/admin/analytics/signups'),
        api.get('/api/admin/analytics/referrals'),
        api.get('/api/admin/analytics/activity'),
        api.get('/api/admin/analytics/lms'),
      ]);
      setData({
        overview: overview.data,
        signups: fillSignupDays(signups.data),
        referrals: mapToData(referrals.data),
        activity: activity.data,
        lms: mapToData(lms.data),
      });
      setLastUpdated(new Date());
    } catch (err) {
      setError(errorMessage(err, 'Could not load analytics.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load + 5-minute auto-refresh.
  useEffect(() => {
    load({ initial: true });
    timerRef.current = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const Tabs = (
    <div className="flex w-fit gap-1 rounded-full bg-white/45 p-1 text-sm">
      {[['analytics', 'Analytics'], ['monetization', 'Monetization'], ['institutions', 'Institutions']].map(([k, l]) => (
        <button
          key={k}
          onClick={() => setTab(k)}
          className={`rounded-full px-4 py-1 font-semibold transition ${tab === k ? 'bg-white/85 text-brand-700 shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );

  if (tab === 'monetization') return <div className="space-y-6">{Tabs}<MonetizationAdmin /></div>;
  if (tab === 'institutions') return <div className="space-y-6">{Tabs}<InstitutionsAdmin /></div>;
  if (loading) return <div className="space-y-6">{Tabs}<Spinner label="Loading analytics…" /></div>;

  const o = data?.overview;
  const activity = data?.activity;

  return (
    <div className="space-y-6">
      {Tabs}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            <span className="text-gradient">Admin</span> Analytics
          </h1>
          <p className="text-sm text-muted">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()} · auto-refreshes every 5 min`
              : 'Platform-wide aggregate metrics'}
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={refreshing}
          className="btn btn-soft"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total users" value={o?.totalUsers ?? '—'} accent="linear-gradient(135deg,#ff7a52,#ff6f73)" />
        <StatCard label="Total classes" value={o?.totalClasses ?? '—'} accent="linear-gradient(135deg,#3fb8c0,#5aa9d6)" />
        <StatCard label="Assignments" value={o?.totalAssignments ?? '—'} accent="linear-gradient(135deg,#7e8fe0,#46c2b0)" />
        <StatCard
          label="Avg GPA"
          value={o?.avgGPA == null ? '—' : o.avgGPA.toFixed(2)}
          accent="linear-gradient(135deg,#ff9a3d,#ff7e9d)"
        />
      </div>

      {/* Signups line chart */}
      <Panel title="Signups" subtitle="New accounts over the last 30 days">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.signups} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 11, fill: '#64748b' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={32} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDate} />
              <Line
                type="monotone"
                dataKey="count"
                name="Signups"
                stroke={LINE_COLOR}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Referral sources bar chart */}
        <Panel title="Referral sources" subtitle="How users found Summit">
          {data.referrals.length === 0 ? (
            <EmptyState title="No referral data yet" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.referrals} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={32} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
                  <Bar dataKey="count" name="Users" radius={[6, 6, 0, 0]}>
                    {data.referrals.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* LMS usage bar chart */}
        <Panel title="LMS usage" subtitle="Connected integrations by provider">
          {data.lms.length === 0 ? (
            <EmptyState title="No LMS connections yet" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.lms} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={32} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
                  <Bar dataKey="count" name="Connections" radius={[6, 6, 0, 0]}>
                    {data.lms.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* Activity */}
      <Panel
        title="Activity"
        subtitle={`${activity?.activeUsers24h ?? 0} user${activity?.activeUsers24h === 1 ? '' : 's'} active in the last 24 hours`}
      >
        {!activity?.activeClasses?.length ? (
          <EmptyState title="No class activity yet" />
        ) : (
          <ul className="divide-y divide-white/40">
            {activity.activeClasses.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5">
                <span className="font-medium text-ink">{c.name}</span>
                <span className="text-sm text-muted">
                  {c.assignments} assignment{c.assignments === 1 ? '' : 's'} · {c.grades} grade
                  {c.grades === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Premium whitelist management */}
      <PremiumWhitelist />
    </div>
  );
}
