# Singularity Production Backup Procedure

## Overview
Singularity stores all data in `~/.singularity/`. This guide covers backup of all critical files.

## Files to Back Up

| Path | Description | Priority |
|------|-------------|----------|
| `~/.singularity/config.json` | Global configuration | High |
| `~/.singularity/providers.json` | API keys (encrypted) | High |
| `~/.singularity/profiles/*/state.db` | Per-profile SQLite database | High |
| `~/.singularity/sessions/` | Session data | Medium |

## SQLite Backup (WAL Mode)

Singularity uses SQLite with WAL mode enabled, which allows online backups without locking:

```bash
# Create a hot backup
sqlite3 ~/.singularity/profiles/default/state.db ".backup '/path/to/backup.db'"
```

## Automated Backup Script

```bash
#!/bin/bash
# backup-singularity.sh
BACKUP_DIR="/var/backups/singularity"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup each profile database
for db in ~/.singularity/profiles/*/state.db; do
  profile=$(basename $(dirname "$db"))
  sqlite3 "$db" ".backup '$BACKUP_DIR/${profile}_${DATE}.db'"
done

# Copy config and providers
cp ~/.singularity/config.json "$BACKUP_DIR/config_${DATE}.json"
cp ~/.singularity/providers.json "$BACKUP_DIR/providers_${DATE}.json"

# Rotation: keep last 7 backups
cd "$BACKUP_DIR"
ls -t profiles_*_*.db | tail -n +8 | xargs rm -f 2>/dev/null || true

echo "Backup complete: $DATE"
```

## Cron Schedule

```cron
# Daily backup at 3am
0 3 * * * /path/to/backup-singularity.sh

# Weekly rotation (Sunday midnight)
0 0 * * 0 find /var/backups/singularity -mtime +30 -delete
```

## Restoration

To restore from backup:
```bash
# Stop singularity first
sqlite3 ~/.singularity/profiles/default/state.db ".restore '/path/to/backup.db'"
```

## Notes
- Back up BEFORE running updates or migrations
- Test restoration procedure in a non-production environment
- WAL mode enables concurrent read access during backup