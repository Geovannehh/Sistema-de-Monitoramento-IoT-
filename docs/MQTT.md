# Protocolo MQTT — fleet/v1

O dispositivo usa seu ID como username e uma senha própria. A ACL permite apenas seus tópicos. O serviço manager lê telemetria, status, logs e ack e publica comandos. Senhas não são entregues ao navegador.

| Tópico                       | Direção           | QoS | Retain |
| ---------------------------- | ----------------- | --- | ------ |
| fleet/v1/ESP32-002/telemetry | Dispositivo → API | 1   | false  |
| fleet/v1/ESP32-002/status    | Dispositivo → API | 1   | true   |
| fleet/v1/ESP32-002/logs      | Dispositivo → API | 1   | false  |
| fleet/v1/ESP32-002/commands  | API → Dispositivo | 1   | false  |
| fleet/v1/ESP32-002/ack       | Dispositivo → API | 1   | false  |

Substitua o ID pelo dispositivo. IDs: 4–48 caracteres, letras maiúsculas, números, hífen ou sublinhado; primeiro caractere alfanumérico. Limite MQTT: 16 KiB. Cada messageId é um UUID; reenviá-lo preserva o mesmo ID.

## Telemetria

```json
{
  "messageId": "393026f8-2e85-4df7-9f78-8f7ad4b20f88",
  "timestamp": "2026-10-09T12:00:00.000Z",
  "metrics": { "temperature": 26.4, "humidity": 61.2 }
}
```

Use timestamps atuais em UTC. A API aceita até 24 h no passado e 5 min no futuro; sincronize o relógio da placa. lastSeen usa o horário de recebimento do servidor. Sensores aceitos: temperature, humidity, voltage, current, power, speed, rpm, desde que cadastrados e habilitados.

PostgreSQL deduplica por (device_id, message_id). Mensagens de telemetria retidas são ignoradas. Redis guarda a última amostra por 120 s; falha nesse cache não desfaz a gravação PostgreSQL.

## Status e firmware

```json
{
  "messageId": "c063a44d-249b-4d40-a250-48b7c7ff8d4e",
  "online": true,
  "firmware": "v2.1.0"
}
```

Configure Last Will no mesmo tópico, com online false, QoS 1, retain true e UUID próprio. Um status online entregue como publicação retida não reativa sessão antiga. Telemetria válida ou status online novo atualiza o último contato. Sem sensores ativos, envie status periódico como heartbeat.

Online exige presença reportada e contato há menos de max(90 s, 3 × sampleIntervalSec). Firmware é metadado reportado; não há OTA no MVP.

## Logs

```json
{
  "messageId": "d3bb4c6c-6d63-4e13-88c6-2f8ebbfcd911",
  "level": "INFO",
  "message": "Leitura dos sensores iniciada."
}
```

Níveis INFO, WARN, ERROR. Até 500 caracteres. Deduplicação por dispositivo e ID. Não envie segredos nos logs.

## Comandos

```json
{
  "commandId": "56f4a1a1-6e06-4088-8c8d-f5ee1c8c9c22",
  "name": "UPDATE_CONFIG",
  "params": { "sampleIntervalSec": 30 },
  "expiresAt": "2026-10-09T12:02:00.000Z"
}
```

| name          | params                                      |
| ------------- | ------------------------------------------- |
| RESTART       | objeto vazio                                |
| UPDATE_CONFIG | sampleIntervalSec: inteiro, 5–3.600 s       |
| ENABLE_SENSOR | sensor: chave cadastrada; enabled: booleano |

Estados: QUEUED → SENT → ACKNOWLEDGED / FAILED / EXPIRED. PUBACK confirma entrega ao broker, não execução pela placa. A API marca SENT após PUBACK; configuração só muda depois de ack ok dentro do prazo. Ack tardio não aplica configuração.

Um comando pendente por dispositivo, com prazo de 120 s. O outbox PostgreSQL é retomado após reinício da API e reenvia a cada 15 s usando o mesmo ID. QoS 1 pode repetir mensagens: o firmware deve persistir IDs processados e reenviar o ack original sem executar novamente. O simulador guarda os últimos 1.000 IDs em volume persistente.

Para RESTART físico, grave o comando antes de reiniciar e confirme após a inicialização. Não informe sucesso antecipadamente.

## Confirmação

```json
{
  "messageId": "70609422-464b-427f-8e85-e9c0c0c66255",
  "commandId": "56f4a1a1-6e06-4088-8c8d-f5ee1c8c9c22",
  "status": "ok",
  "message": "Intervalo atualizado para 30 segundos."
}
```

Status: ok ou error. A API associa o comando ao dispositivo do tópico. ACKNOWLEDGED significa execução declarada pelo dispositivo, sem comprovar o estado físico do equipamento.

## Provisionar outro dispositivo

Registre no painel. Defina DEVICE_ID e DEVICE_PASSWORD no ambiente do terminal do operador, com senha própria de pelo menos 16 caracteres, e execute:

```bash
docker compose exec -e DEVICE_ID -e DEVICE_PASSWORD mqtt sh /bootstrap/provision-device.sh
```

A ACL por username é automática. O script atualiza a senha e recarrega o broker. A configuração inicial de senhas ocorre apenas se o arquivo ainda não existe; alterar .env e reiniciar não rotaciona senhas existentes. Use o provisionamento para rotacionar e atualize a API quando trocar a senha do manager.

O Compose expõe as portas apenas em loopback. Para placas em uma LAN, ajuste o bind do broker e use o endereço da máquina. MQTT TCP sem TLS serve ao desenvolvimento local; configure TLS e políticas de acesso antes de expor fora desse ambiente.
