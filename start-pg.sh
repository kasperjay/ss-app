#!/bin/bash
set -e

EPHEMERAL_PGDATA="/var/lib/postgresql/15/main"
PERSISTENT_PGDATA="/home/workspace/ss-app/.pgdata/15/main"

mkdir -p /var/run/postgresql
chown postgres:postgres /var/run/postgresql
chmod 2775 /var/run/postgresql

if [ ! -f "$PERSISTENT_PGDATA/PG_VERSION" ]; then
    echo "[start-pg] Initializing persistent PGDATA at $PERSISTENT_PGDATA..."
    mkdir -p "/home/workspace/ss-app/.pgdata/15"
    cp -a "$EPHEMERAL_PGDATA" "$PERSISTENT_PGDATA"
fi

chown -R postgres:postgres "/home/workspace/ss-app/.pgdata"
chmod 700 "$PERSISTENT_PGDATA"

exec /usr/bin/su - postgres -c "/usr/lib/postgresql/15/bin/postgres -D $PERSISTENT_PGDATA -c config_file=$EPHEMERAL_PGDATA/postgresql.conf -c data_directory=$PERSISTENT_PGDATA"
