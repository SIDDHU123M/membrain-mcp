// One command for every external signal we have. Membrain ships zero telemetry
// by principle, so these public sources are the whole dashboard.
const j = (u, headers = {}) => fetch(u, { headers }).then((r) => (r.ok ? r.json() : null));

const [day, week, month, repo] = await Promise.all([
  j('https://api.npmjs.org/downloads/point/last-day/membrain-mcp'),
  j('https://api.npmjs.org/downloads/point/last-week/membrain-mcp'),
  j('https://api.npmjs.org/downloads/point/last-month/membrain-mcp'),
  j('https://api.github.com/repos/SIDDHU123M/membrain-mcp'),
]);

const row = (k, v) => console.log(`  ${k.padEnd(26, '.')} ${v ?? 'n/a (npm aggregates daily)'}`);
console.log('membrain — public signals\n');
row('npm downloads (day)', day?.downloads);
row('npm downloads (week)', week?.downloads);
row('npm downloads (month)', month?.downloads);
row('github stars', repo?.stargazers_count);
row('github forks', repo?.forks_count);
row('open issues', repo?.open_issues_count);
console.log(
  '\n  more: npmjs.com/package/membrain-mcp (graphs) · npm-stat.com · repo Insights → Traffic\n' +
    '  (traffic API needs auth: gh api repos/SIDDHU123M/membrain-mcp/traffic/views)',
);
