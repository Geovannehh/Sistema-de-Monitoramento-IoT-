#!/bin/sh
set -eu
umask 077
mkdir -p /mosquitto/data
if [ ! -f /mosquitto/data/passwd ]; then
 : "${MQTT_MANAGER_PASSWORD:?Configure MQTT_MANAGER_PASSWORD}"
 : "${MQTT_DEVICE_001_PASSWORD:?Configure MQTT_DEVICE_001_PASSWORD}"
 : "${MQTT_DEVICE_002_PASSWORD:?Configure MQTT_DEVICE_002_PASSWORD}"
 : "${MQTT_DEVICE_003_PASSWORD:?Configure MQTT_DEVICE_003_PASSWORD}"
 mosquitto_passwd -b -c /mosquitto/data/passwd manager "$MQTT_MANAGER_PASSWORD"
 mosquitto_passwd -b /mosquitto/data/passwd ESP32-001 "$MQTT_DEVICE_001_PASSWORD"
 mosquitto_passwd -b /mosquitto/data/passwd ESP32-002 "$MQTT_DEVICE_002_PASSWORD"
 mosquitto_passwd -b /mosquitto/data/passwd ESP32-003 "$MQTT_DEVICE_003_PASSWORD"
 cat > /mosquitto/data/acl <<'ACL'
user manager
topic read fleet/v1/+/telemetry
topic read fleet/v1/+/status
topic read fleet/v1/+/logs
topic read fleet/v1/+/ack
topic write fleet/v1/+/commands
pattern write fleet/v1/%u/telemetry
pattern write fleet/v1/%u/status
pattern write fleet/v1/%u/logs
pattern write fleet/v1/%u/ack
pattern read fleet/v1/%u/commands
ACL
fi
chown -R mosquitto:mosquitto /mosquitto/data
exec mosquitto -c /mosquitto/config/mosquitto.conf
