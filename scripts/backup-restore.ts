#!/usr/bin/env bun

/**
 * Backup and restore script for Singularity data
 * Usage:
 *   bun scripts/backup-restore.ts backup [output-dir]
 *   bun scripts/backup-restore.ts restore [backup-file]
 */

import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const SINGULARITY_HOME =
	process.env.SINGULARITY_HOME ?? join(process.env.HOME ?? "~", ".singularity");
const PROFILES_DIR = join(SINGULARITY_HOME, "profiles");
const BACKUP_DIR = join(SINGULARITY_HOME, "backups");

interface BackupMetadata {
	version: string;
	createdAt: string;
	profiles: string[];
	size: number;
	checksum: string;
}

function hashFile(path: string): string {
	const content = readFileSync(path);
	return createHash("sha256").update(content).digest("hex");
}

async function backup(outputDir?: string): Promise<string> {
	const dir = outputDir ?? join(BACKUP_DIR, `backup-${Date.now()}`);
	mkdirSync(dir, { recursive: true });

	const profiles: string[] = [];
	let totalSize = 0;

	if (existsSync(PROFILES_DIR)) {
		const { readdirSync } = await import("node:fs");
		const entries = readdirSync(PROFILES_DIR, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory()) {
				const profilePath = join(PROFILES_DIR, entry.name);
				const profileBackupDir = join(dir, "profiles", entry.name);
				mkdirSync(profileBackupDir, { recursive: true });

				// Copy state.db if exists
				const dbPath = join(profilePath, "state.db");
				if (existsSync(dbPath)) {
					cpSync(dbPath, join(profileBackupDir, "state.db"));
					totalSize += (await import("node:fs")).statSync(dbPath).size;
				}

				profiles.push(entry.name);
			}
		}
	}

	// Create manifest
	const manifest: BackupMetadata = {
		version: "1.0.0",
		createdAt: new Date().toISOString(),
		profiles,
		size: totalSize,
		checksum: "",
	};

	// Calculate checksum of all files
	const hash = createHash("sha256");
	hash.update(JSON.stringify(manifest));
	for (const profile of profiles) {
		const dbPath = join(dir, "profiles", profile, "state.db");
		if (existsSync(dbPath)) {
			hash.update(readFileSync(dbPath));
		}
	}
	manifest.checksum = hash.digest("hex");

	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

	console.log(`✅ Backup created: ${dir}`);
	console.log(`   Profiles: ${profiles.join(", ") || "none"}`);
	console.log(`   Size: ${(totalSize / 1024).toFixed(1)} KB`);
	console.log(`   Checksum: ${manifest.checksum.slice(0, 16)}...`);

	return dir;
}

async function restore(backupPath: string): Promise<void> {
	if (!existsSync(backupPath)) {
		throw new Error(`Backup not found: ${backupPath}`);
	}

	const manifestPath = join(backupPath, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error("Invalid backup: manifest.json not found");
	}

	const manifest: BackupMetadata = JSON.parse(
		readFileSync(manifestPath, "utf-8"),
	);

	// Verify checksum
	const hash = createHash("sha256");
	hash.update(JSON.stringify({ ...manifest, checksum: "" }));
	for (const profile of manifest.profiles) {
		const dbPath = join(backupPath, "profiles", profile, "state.db");
		if (existsSync(dbPath)) {
			hash.update(readFileSync(dbPath));
		}
	}
	const expectedChecksum = hash.digest("hex");

	if (manifest.checksum !== expectedChecksum) {
		throw new Error("Backup integrity check failed - checksum mismatch");
	}

	// Create backup of current state
	const currentBackupDir = join(BACKUP_DIR, `pre-restore-${Date.now()}`);
	if (existsSync(PROFILES_DIR)) {
		cpSync(PROFILES_DIR, currentBackupDir, { recursive: true });
		console.log(`📦 Current state backed up to: ${currentBackupDir}`);
	}

	// Restore profiles
	for (const profile of manifest.profiles) {
		const srcDb = join(backupPath, "profiles", profile, "state.db");
		const destDir = join(PROFILES_DIR, profile);
		mkdirSync(destDir, { recursive: true });

		if (existsSync(srcDb)) {
			cpSync(srcDb, join(destDir, "state.db"));
			console.log(`✅ Restored profile: ${profile}`);
		}
	}

	console.log(`\n✅ Restore complete`);
	console.log(`   Restored ${manifest.profiles.length} profile(s)`);
	console.log(`   Backup of current state: ${currentBackupDir}`);
}

async function listBackups(): Promise<void> {
	if (!existsSync(BACKUP_DIR)) {
		console.log("No backups found");
		return;
	}

	const { readdirSync } = await import("node:fs");
	const entries = readdirSync(BACKUP_DIR, { withFileTypes: true });
	const backups = entries.filter((e) => e.isDirectory());

	if (backups.length === 0) {
		console.log("No backups found");
		return;
	}

	console.log("Available backups:\n");
	for (const backup of backups.sort((a, b) => b.name.localeCompare(a.name))) {
		const manifestPath = join(BACKUP_DIR, backup.name, "manifest.json");
		if (existsSync(manifestPath)) {
			const manifest: BackupMetadata = JSON.parse(
				readFileSync(manifestPath, "utf-8"),
			);
			console.log(`  ${backup.name}`);
			console.log(`    Created: ${manifest.createdAt}`);
			console.log(`    Profiles: ${manifest.profiles.join(", ") || "none"}`);
			console.log(`    Size: ${(manifest.size / 1024).toFixed(1)} KB`);
			console.log();
		}
	}
}

const [command, arg] = process.argv.slice(2);

switch (command) {
	case "backup":
		backup(arg);
		break;
	case "restore":
		if (!arg) {
			console.error(
				"Usage: bun scripts/backup-restore.ts restore <backup-dir>",
			);
			process.exit(1);
		}
		restore(arg).catch(console.error);
		break;
	case "list":
		listBackups();
		break;
	default:
		console.log(`
Singularity Backup/Restore

Usage:
  bun scripts/backup-restore.ts backup [output-dir]  Create backup
  bun scripts/backup-restore.ts restore <backup-dir>  Restore from backup
  bun scripts/backup-restore.ts list                 List available backups

Examples:
  bun scripts/backup-restore.ts backup
  bun scripts/backup-restore.ts backup /path/to/backup
  bun scripts/backup-restore.ts restore .singularity/backups/backup-1234567890
  bun scripts/backup-restore.ts list
`);
}
