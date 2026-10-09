# IoT Device Manager

Infraestrutura inicial para registrar dispositivos, acompanhar status, firmware, sensores, logs e telemetria e enviar RESTART, UPDATE_CONFIG e ENABLE_SENSOR.

**React + TypeScript · NestJS · MQTT/Mosquitto · PostgreSQL · Redis · Docker**.

## Funcionalidades

- Cadastro com ID único, projeto, modelo, firmware e sensores.
- Status online/offline por último contato e intervalo de amostragem.
- Energy Monitor, Temperature Sensor e Baja Telemetry no cadastro inicial.
- Gráficos por sensor, unidade e última leitura; logs por dispositivo e nível.
- Configuração confirmada e firmware reportado; sem atualização OTA.
- Comandos com fila, envio, confirmação, falha e expiração de 120 s.
- Configuração só muda depois da confirmação do dispositivo.
- Credenciais MQTT individuais e ACL para os tópicos de cada dispositivo.
- Outbox PostgreSQL retomado depois de reiniciar a API.
- Redis para última leitura e limite global de 60 escritas HTTP por minuto.
- Simulador MQTT dos três dispositivos, com IDs de comandos persistidos.

## Rodar com Docker

Requer Docker com Compose e Python 3 para gerar o ambiente local.

```bash
python scripts/init-env.py
docker compose --profile demo up --build -d
```

No Windows, py scripts/init-env.py também funciona. Abra **http://localhost:3000**. O perfil demo inicia três dispositivos simulados usando comunicação MQTT real pelo Mosquitto. Eles começam online e enviam leituras conforme a configuração.

O script cria senhas diferentes e um token aleatório, sem imprimir os valores e sem sobrescrever .env existente. Alternativamente, copie .env.example para .env e substitua os valores. Use senhas hexadecimais nas URLs PostgreSQL e Redis. Nunca envie .env ao Git.

```bash
docker compose logs -f api simulator
docker compose stop simulator
```

Sem simulação, execute docker compose up --build -d e conecte dispositivos usando [docs/MQTT.md](docs/MQTT.md). O PostgreSQL inicia apenas o cadastro dos três exemplos, offline, sem telemetria fictícia. Dados chegam pelo broker.

```bash
docker compose down
```

Os volumes mantêm banco, cache, credenciais e estado do simulador. docker compose down -v apaga esses dados. Frontend: 3000; MQTT: 1883; ambos em 127.0.0.1 por padrão. PostgreSQL, Redis e API não expõem portas no host. Nginx injeta o token no servidor, sem entregá-lo ao navegador.

## Testar o fluxo

1. Selecione ESP32-002 e acompanhe temperatura e umidade.
2. Envie UPDATE_CONFIG com intervalo de 30 s.
3. Veja QUEUED/SENT até ACKNOWLEDGED no histórico.
4. Confira o intervalo na aba Configuração.
5. Desabilite um sensor e veja que ele deixa de publicar.
6. Pare o simulador e confira status offline e LWT nos logs.

No simulador, RESTART representa uma reinicialização por transição de status e resposta. No hardware, o firmware executa e confirma o resultado.

## Demonstração online

A versão hospedada reutiliza a interface e contratos, com **D1/SQLite** para persistir uma demonstração acessível. Ela não conecta NestJS, Redis ou Mosquitto da stack Docker. Dispositivos e mensagens são simulados; a interface informa isso.

Use **Simular ciclo** para gerar uma leitura do dispositivo selecionado, atualizar presença e confirmar seus comandos simulados. Recarregar preserva os dados. Limites: 50 dispositivos, 600 amostras, 250 logs e 150 comandos. Os registros mais antigos saem dessas janelas. A primeira carga tem 30 amostras fictícias por dispositivo, sem medição física.

## Estrutura

| Parte                             | Caminho                                 |
| --------------------------------- | --------------------------------------- |
| Interface React                   | app/page.tsx                            |
| Frontend portátil / Nginx         | frontend/, vite.portable.config.ts      |
| Contratos e validação             | shared/contracts.ts                     |
| Controllers, guard e erros NestJS | services/api/src/main.ts                |
| PostgreSQL, Redis e MQTT          | services/api/src/fleet.service.ts       |
| Validação MQTT                    | services/api/src/protocol.ts            |
| Migração PostgreSQL               | services/api/migrations/001_initial.sql |
| Broker e ACL                      | broker/                                 |
| Simulador                         | simulator/client.ts                     |
| Demonstração D1                   | server/fleet-store.ts, drizzle/         |
| Docker Compose                    | docker-compose.yml                      |

PostgreSQL separa dispositivos, telemetria, logs e comandos. Cadastro e sensores usam JSONB. A consulta retorna até 60 amostras por dispositivo usando índice por ID/horário, e até 100 logs e 100 comandos recentes. O histórico completo permanece no PostgreSQL; ainda não há retenção automática ou paginação desse histórico completo.

Gravações usam transações e bloqueio por dispositivo; UUIDs e unicidade impedem duplicatas. A migração inicial é aplicada uma vez e registrada em schema_migrations. Não altere uma migração já aplicada: novas mudanças exigem novas migrações e evolução do migrador.

## API HTTP

| Rota            | Função                                         |
| --------------- | ---------------------------------------------- |
| GET /api/health | Disponibilidade de banco, Redis e conexão MQTT |
| GET /api/fleet  | Cadastro, últimas amostras, logs e comandos    |
| POST /api/fleet | Cadastro ou enfileiramento de comando          |

A frota exige Authorization: Bearer API_TOKEN. O navegador usa o Nginx, que injeta o token. Payload máximo: 10 KiB.

```json
{
  "action": {
    "action": "command",
    "requestId": "56f4a1a1-6e06-4088-8c8d-f5ee1c8c9c22",
    "deviceId": "ESP32-002",
    "payload": {
      "name": "UPDATE_CONFIG",
      "params": { "sampleIntervalSec": 30 }
    }
  }
}
```

O frontend também envia revision: D1 usa para impedir sobrescrita; PostgreSQL usa transações por dispositivo e unicidade dos comandos. Veja todos os contratos em shared/contracts.ts.

## Desenvolvimento sem Docker

Requer Node.js 22.13+, pnpm, PostgreSQL, Redis e Mosquitto disponíveis.

```bash
pnpm install --frozen-lockfile
npm ci --prefix services/api
npm ci --prefix simulator
```

Defina DATABASE_URL, REDIS_URL, MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD e API_TOKEN no ambiente da API. Execute dentro de services/api para localizar a migração:

```bash
npm run build
npm start
```

Em outro terminal, na raiz, defina API_TOKEN para o proxy Vite e opcionalmente IOT_API_URL (padrão http://localhost:8000):

```bash
pnpm exec vite --config vite.portable.config.ts
```

O simulador usa MQTT_URL e MQTT_DEVICE_001_PASSWORD, MQTT_DEVICE_002_PASSWORD, MQTT_DEVICE_003_PASSWORD. Dentro de simulator, execute npm run build e npm start.

## Verificações

```bash
pnpm exec tsc --noEmit
npm run build --prefix services/api
npm test --prefix services/api
npm run build --prefix simulator
python -m unittest discover -s tests -p '*_test.py'
pnpm build:portable
```

Testes cobrem status, cadastro, idempotência, fila, confirmação, expiração, sensores, limites, contrato MQTT, retenção, timestamp e concorrência SQLite.

Foram verificados TypeScript, compilação NestJS, simulador, frontend, testes e migração SQLite. **Este ambiente não possui Docker, PostgreSQL, Redis ou Mosquitto executáveis**: a execução integrada ainda precisa ser validada em ambiente com Docker. A interface e o recurso opcional WebMCP não passaram por navegação automatizada. Isso não equivale à validação em produção.

## Escopo e acesso

O MVP atende um workspace. A stack local autentica o gateway, sem login individual ou papéis na interface. A versão hospedada é privada e verifica a sessão do usuário. TLS, login individual, autorização por papel, isolamento entre clientes, rotação automática de credenciais, alertas externos, OTA e AWS não fazem parte desta versão.

Para ampliar a infraestrutura comum, evolua autenticação, TLS, retenção, paginação, migrador, observabilidade e testes com hardware. O projeto é independente; pequeno AWS IoT é a inspiração funcional.
