/**
 * Prometheus metrics and health endpoints
 */

export class Metrics {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observe(name: string, value: number): void {
    const arr = this.histograms.get(name) ?? [];
    arr.push(value);
    this.histograms.set(name, arr);
  }

  export(): string {
    const lines: string[] = [];
    for (const [name, value] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }
    for (const [name, values] of this.histograms) {
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = values.length > 0 ? sum / values.length : 0;
      lines.push(`# TYPE ${name} histogram`);
      lines.push(`${name}_count ${values.length}`);
      lines.push(`${name}_sum ${sum}`);
      lines.push(`${name}_avg ${avg.toFixed(2)}`);
    }
    return lines.join('\n');
  }
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  checks: Record<string, { ok: boolean; detail: string }>;
}

export function createHealthCheck(
  checks: Record<string, () => Promise<{ ok: boolean; detail: string }>>
): () => Promise<HealthStatus> {
  const start = Date.now();
  return async () => {
    const results: Record<string, { ok: boolean; detail: string }> = {};
    let allOk = true;
    for (const [name, check] of Object.entries(checks)) {
      try {
        results[name] = await check();
        if (!results[name].ok) allOk = false;
      } catch (e) {
        results[name] = {
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        };
        allOk = false;
      }
    }
    return {
      status: allOk ? 'healthy' : 'degraded',
      uptime: Date.now() - start,
      checks: results,
    };
  };
}
