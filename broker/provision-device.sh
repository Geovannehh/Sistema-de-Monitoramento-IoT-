#!/bin/sh
set -eu
# Run inside the broker with DEVICE_ID and DEVICE_PASSWORD in the environment.
case "${DEVICE_ID:-}" in ''|*[!A-Z0-9_-]*) echo 'ID inválido' >&2; exit 1;; esac
[ "${#DEVICE_ID}" -ge 4 ] && [ "${#DEVICE_ID}" -le 48 ]
[ "${#DEVICE_PASSWORD}" -ge 16 ]
mosquitto_passwd -b /mosquitto/data/passwd "$DEVICE_ID" "$DEVICE_PASSWORD"
chown mosquitto:mosquitto /mosquitto/data/passwd
kill -HUP 1
