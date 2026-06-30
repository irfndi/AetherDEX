# AetherDEX Monitoring Guide

## Cloudflare Analytics (Built-in)

Cloudflare Workers, Pages, D1, KV, R2 all emit logs and metrics automatically.

### Access

1. Cloudflare Dashboard → Workers & Pages → aetherdex-api → Logs / Analytics
2. Filter by: `env:production`, `level:error`, status >= 500

### Key Metrics to Watch

| Metric | Healthy Range | Alert Threshold |
|--------|---------------|------------------|
| Request duration (p95) | < 500ms | > 1000ms |
| Error rate (5xx) | < 0.1% | > 1% |
| Worker CPU time (p95) | < 10ms | > 25ms |
| D1 query latency (p95) | < 50ms | > 100ms |
| KV get latency (p95) | < 10ms | > 50ms |
| R2 upload latency (p95) | < 200ms | > 500ms |

### Alerts

Configure in Cloudflare Dashboard → Notifications:
- Worker errors > 100 in 5min → Email/Slack
- Worker CPU time > 25ms (p95) for > 5min → Slack
- D1 errors > 10 in 5min → Email

## Health Check Endpoint

```
GET https://api.aetherdex.io/health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": 1719715200000,
  "environment": "production",
  "chainId": "1",
  "checks": {
    "d1": { "healthy": true, "latencyMs": 5 },
    "kv": { "healthy": true, "latencyMs": 3 },
    "r2": { "healthy": true, "latencyMs": 12 }
  }
}
```

Use this for external uptime monitoring (UptimeRobot, Better Uptime, etc.).

## External Uptime Monitoring

Recommended services:
- [Better Uptime](https://betteruptime.com) — checks /health every 30s, alerts via Slack/PagerDuty
- [UptimeRobot](https://uptimerobot.com) — free tier, 5min checks
- [Cloudflare Health Checks](https://developers.cloudflare.com/health-checks/) — native, free

## Log Forwarding

To forward Cloudflare Workers logs to Sentry/Datadog:
1. Use Cloudflare Logpush (paid plan) to export to S3
2. Pipe to your observability platform

For free tier:
1. Use Cloudflare Workers Tail: `bun run tail`
2. Pipe to console → file → custom parser

## Incident Response

If the API goes down:
1. Check Cloudflare status: https://www.cloudflarestatus.com
2. Check Workers analytics: `bun run tail`
3. Roll back: `wrangler rollback --env production`
4. Post-mortem: document in `docs/incidents/YYYY-MM-DD.md`

## On-Call Alerts

Configure PagerDuty integration:
1. Cloudflare Dashboard → Notifications → Add PagerDuty
2. Severity: Critical → Page on-call immediately
3. Severity: Warning → Slack channel, no page
