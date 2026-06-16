#!/usr/bin/env bun
// Singularity CLI — main bin entrypoint
import { runCli } from './index.js';

const result = await runCli(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
// Use process.exitCode if set (from early exit in runCli), otherwise use result.exitCode
process.exit(process.exitCode ?? result.exitCode);
