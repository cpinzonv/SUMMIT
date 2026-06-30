// Generate the dates a class meets, from its schedule. Shared by the attendance
// service (to list sessions) and the grade service (to score attendance over the
// same set), so the attendance % is identical everywhere.

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/**
 * Every date between start and end (inclusive) that falls on one of the meeting
 * weekdays. Inputs are local-calendar 'YYYY-MM-DD' strings; output is the same.
 */
export function generateSessionDates(startStr, endStr, days) {
  if (!startStr || !endStr || !Array.isArray(days) || days.length === 0) return [];
  const wanted = new Set(days.map((d) => DAY_INDEX[d]).filter((n) => n !== undefined));
  if (wanted.size === 0) return [];

  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  const out = [];
  let guard = 0;
  while (cur <= end && guard < 3000) {
    if (wanted.has(cur.getDay())) out.push(fmt(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}
