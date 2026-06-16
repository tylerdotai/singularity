#!/usr/bin/env bun
/**
 * Load testing script for production server
 * Usage: bun scripts/load-test.ts [--concurrent=10] [--requests=1000] [--url=http://localhost:18678]
 */

interface LoadTestOptions {
	concurrent: number;
	requests: number;
	url: string;
}

function parseArgs(): LoadTestOptions {
	const args = process.argv.slice(2);
	const opts: LoadTestOptions = {
		concurrent: 10,
		requests: 1000,
		url: "http://localhost:18678",
	};

	for (const arg of args) {
		if (arg.startsWith("--concurrent=")) {
			opts.concurrent = parseInt(arg.split("=")[1], 10);
		} else if (arg.startsWith("--requests=")) {
			opts.requests = parseInt(arg.split("=")[1], 10);
		} else if (arg.startsWith("--url=")) {
			opts.url = arg.split("=")[1];
		}
	}

	return opts;
}

interface RequestResult {
	latency: number;
	status: number;
	error?: string;
}

async function makeRequest(url: string): Promise<RequestResult> {
	const start = Date.now();
	try {
		const res = await fetch(url);
		return { latency: Date.now() - start, status: res.status };
	} catch (e) {
		return { latency: Date.now() - start, status: 0, error: String(e) };
	}
}

async function runLoadTest(opts: LoadTestOptions) {
	console.log(`\n🚀 Load Test Configuration`);
	console.log(`   URL: ${opts.url}`);
	console.log(`   Concurrent: ${opts.concurrent}`);
	console.log(`   Total Requests: ${opts.requests}`);
	console.log(`\n⏳ Running load test...\n`);

	const results: RequestResult[] = [];
	const batches = Math.ceil(opts.requests / opts.concurrent);

	for (let i = 0; i < batches; i++) {
		const batch = Math.min(
			opts.concurrent,
			opts.requests - i * opts.concurrent,
		);
		const promises = Array(batch)
			.fill(null)
			.map(() => makeRequest(`${opts.url}/health`));

		const batchResults = await Promise.all(promises);
		results.push(...batchResults);

		const progress = Math.min((i + 1) * opts.concurrent, opts.requests);
		process.stdout.write(
			`\r   Progress: ${progress}/${opts.requests} requests`,
		);
	}

	console.log(`\n\n📊 Results`);
	console.log(`   Total: ${results.length}`);
	console.log(
		`   Successful: ${results.filter((r) => r.status === 200).length}`,
	);
	console.log(`   Failed: ${results.filter((r) => r.status !== 200).length}`);

	const latencies = results.map((r) => r.latency).sort((a, b) => a - b);
	const p50 = latencies[Math.floor(latencies.length * 0.5)];
	const p95 = latencies[Math.floor(latencies.length * 0.95)];
	const p99 = latencies[Math.floor(latencies.length * 0.99)];
	const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

	console.log(`\n📈 Latency (ms)`);
	console.log(`   Avg: ${avg.toFixed(2)}`);
	console.log(`   P50: ${p50}`);
	console.log(`   P95: ${p95}`);
	console.log(`   P99: ${p99}`);
	console.log(`   Min: ${latencies[0]}`);
	console.log(`   Max: ${latencies[latencies.length - 1]}`);

	const rps = results.length / (latencies[latencies.length - 1] / 1000);
	console.log(`\n⚡ Throughput: ${rps.toFixed(2)} req/sec`);

	const errorRate =
		(results.filter((r) => r.status !== 200).length / results.length) * 100;
	if (errorRate > 1) {
		console.log(`\n❌ Error rate: ${errorRate.toFixed(2)}% - FAIL`);
		process.exit(1);
	} else {
		console.log(`\n✅ Error rate: ${errorRate.toFixed(2)}% - PASS`);
	}
}

const opts = parseArgs();
runLoadTest(opts).catch(console.error);
