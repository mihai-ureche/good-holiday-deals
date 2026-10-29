#!/bin/sh
# Run from the repository root. Saves a consistent logical database backup.
set -eu
umask 077
mkdir -p backups
destination="backups/holiday-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U holiday -d holiday -Fc > "$destination.partial"
mv "$destination.partial" "$destination"
printf 'Database backup created: %s\n' "$destination"
