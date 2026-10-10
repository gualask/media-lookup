// Prints how the deployed Worker uses its cache and CPU, from the Cloudflare APIs.
// Credentials come from .env.cloudflare (see README, "Analytics"), never from .env.
import { existsSync } from 'node:fs';

const ENV_FILE = '.env.cloudflare';
const SCRIPT_NAME = 'media-lookup';
const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
// Workers Logs keeps events for 3 days on the Free plan.
const LOGS_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const days = parseDays(process.argv.slice(2));

if (!existsSync(ENV_FILE)) {
  fail(`${ENV_FILE} not found: create it with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.`);
}

process.loadEnvFile(ENV_FILE);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !apiToken) {
  fail(`${ENV_FILE} must define CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.`);
}

const now = Date.now();

await printLookupCache(now - Math.min(days, LOGS_DAYS) * DAY_MS, now);
await printInvocations(now - days * DAY_MS, now);

async function printLookupCache(from, to) {
  const rows = new Map();

  // A sum over a field that no event has yet empties the whole result, so `errors`, added
  // later than the others, gets its own query.
  for (const keys of [['items', 'cacheHits', 'warmupHits', 'tmdbCalls'], ['errors']]) {
    await sumByRoute(from, to, keys, rows);
  }

  console.log(`\nLookup cache, Workers Logs, last ${Math.min(days, LOGS_DAYS)} days`);
  printTable(
    ['route', 'events', 'items', 'errors', 'cacheHits', 'hit rate', 'warmupHits', 'tmdbCalls'],
    [...rows.values()].map((row) => [
      row.route,
      row.itemsEvents ?? 0,
      row.items ?? 0,
      row.errors ?? 0,
      row.cacheHits ?? 0,
      percent(row.cacheHits, row.items),
      row.warmupHits ?? 0,
      row.tmdbCalls ?? 0,
    ]),
  );
}

async function sumByRoute(from, to, keys, rows) {
  const result = await callApi(`/accounts/${accountId}/workers/observability/telemetry/query`, {
    queryId: 'media-lookup-analytics',
    timeframe: { from, to },
    view: 'calculations',
    dry: true,
    parameters: {
      datasets: ['cloudflare-workers'],
      filters: [
        { key: '$metadata.service', operation: 'eq', type: 'string', value: SCRIPT_NAME },
        { key: keys[0], operation: 'exists', type: 'number', value: 0 },
      ],
      calculations: [
        { operator: 'count', alias: `${keys[0]}Events` },
        ...keys.map((key) => ({ operator: 'sum', key, keyType: 'number', alias: key })),
      ],
      groupBys: [{ type: 'string', value: 'route' }],
    },
  });

  for (const calculation of result.calculations ?? []) {
    for (const aggregate of calculation.aggregates ?? []) {
      const route = aggregate.groups?.[0]?.value ?? '?';
      const row = rows.get(route) ?? { route };
      row[calculation.alias] = aggregate.value ?? 0;
      rows.set(route, row);
    }
  }
}

async function printInvocations(from, to) {
  const data = await callApi('/graphql', {
    query: `query ($account: String!, $script: String!, $from: Time!, $to: Time!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          workersInvocationsAdaptive(
            limit: 1000
            filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }
            orderBy: [date_ASC]
          ) {
            dimensions { date status }
            sum { requests errors subrequests }
            quantiles { cpuTimeP50 cpuTimeP99 }
            max { cpuTime }
          }
        }
      }
    }`,
    variables: {
      account: accountId,
      script: SCRIPT_NAME,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
  });
  const rows = data.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];

  console.log(`\nInvocations, GraphQL Analytics, last ${days} days (Free plan CPU limit: 10 ms)`);
  printTable(
    ['date', 'status', 'requests', 'errors', 'subrequests', 'cpu p50', 'cpu p99', 'cpu max'],
    rows.map((row) => [
      row.dimensions.date,
      row.dimensions.status,
      row.sum.requests,
      row.sum.errors,
      row.sum.subrequests,
      milliseconds(row.quantiles.cpuTimeP50),
      milliseconds(row.quantiles.cpuTimeP99),
      milliseconds(row.max.cpuTime),
    ]),
  );
}

async function callApi(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  const errors = payload.errors ?? [];

  if (!response.ok || errors.length > 0 || payload.success === false) {
    fail(`${path} failed (${response.status}): ${errors.map((error) => error.message).join('; ')}`);
  }

  return payload.result ?? payload.data;
}

function printTable(headers, rows) {
  if (rows.length === 0) {
    console.log('  no data');
    return;
  }

  const cells = [headers, ...rows].map((row) => row.map(String));
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));

  for (const row of cells) {
    console.log(`  ${row.map((cell, column) => cell.padEnd(widths[column])).join('  ')}`.trimEnd());
  }
}

function percent(part, total) {
  return total ? `${Math.round(((part ?? 0) / total) * 100)}%` : '-';
}

// GraphQL reports CPU time in microseconds.
function milliseconds(microseconds) {
  return `${(microseconds / 1000).toFixed(1)} ms`;
}

function parseDays(args) {
  const value = args.find((arg) => arg.startsWith('--days='))?.slice('--days='.length);
  const parsed = Number(value ?? 7);

  if (!Number.isInteger(parsed) || parsed < 1) {
    fail('Usage: pnpm analytics [--days=N]');
  }

  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
