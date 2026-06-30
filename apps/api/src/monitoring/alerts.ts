export const ALERT_RULES = {
  highLatency: {
    metric: "requestDurationMs",
    threshold: 1000,
    ratio: 0.05,
    windowMinutes: 5,
    severity: "warn" as const,
    message: "API p95 latency > 1s",
  },

  errorRate: {
    metric: "statusCode",
    filter: "5xx",
    threshold: 0.01,
    windowMinutes: 5,
    severity: "critical" as const,
    message: "API 5xx error rate > 1%",
  },

  cpuTimeHigh: {
    metric: "cpuTimeMs",
    threshold: 25,
    windowMinutes: 5,
    severity: "warn" as const,
    message: "Worker CPU time approaching 30ms limit",
  },

  d1Slow: {
    metric: "d1QueryDurationMs",
    threshold: 100,
    windowMinutes: 5,
    severity: "warn" as const,
    message: "D1 query latency > 100ms",
  },
}

export type AlertSeverity = "warn" | "critical"
export type AlertRule = (typeof ALERT_RULES)[keyof typeof ALERT_RULES]
