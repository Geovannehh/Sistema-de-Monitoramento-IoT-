"""Create local development credentials without overwriting an existing environment."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / '.env'
keys = ['POSTGRES_PASSWORD','REDIS_PASSWORD','API_TOKEN','MQTT_MANAGER_PASSWORD','MQTT_DEVICE_001_PASSWORD','MQTT_DEVICE_002_PASSWORD','MQTT_DEVICE_003_PASSWORD']
if target.exists():
    raise SystemExit('.env já existe. Nenhuma credencial foi alterada.')
with target.open('x', encoding='utf-8') as stream:
    for key in keys: stream.write(key + '=' + secrets.token_hex(32) + '\n')
try: target.chmod(0o600)
except OSError: pass
print('.env criado com credenciais aleatórias. Não envie esse arquivo ao Git.')
