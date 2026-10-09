"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Cpu,
  Radio,
  Activity,
  Terminal,
  Layers,
  Plus,
  Search,
  Wifi,
  WifiOff,
  RefreshCw,
  Power,
  Settings2,
  SlidersHorizontal,
  Command as CommandIcon,
  Clock,
  AlertCircle,
  Play,
  Code2,
  Copy,
  LoaderCircle,
  Box,
  Zap,
  Thermometer,
  Gauge,
  Check,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis } from "recharts";
import { Toaster, toast } from "sonner";
import {
  type Fleet,
  type Device,
  type FleetAction,
  type SensorKey,
  type DeviceCommand,
  online,
  sensorCatalog,
  sensorKeys,
} from "@/shared/contracts";
const nav = [
  { id: "devices", title: "Dispositivos", icon: Cpu },
  { id: "telemetry", title: "Telemetria", icon: Activity },
  { id: "commands", title: "Comandos", icon: CommandIcon },
  { id: "logs", title: "Logs", icon: Terminal },
];
const commandLabel = {
  RESTART: "Reiniciar dispositivo",
  UPDATE_CONFIG: "Atualizar configuração",
  ENABLE_SENSOR: "Configurar sensor",
};
const statusLabel = {
  QUEUED: "Na fila",
  SENT: "Enviado",
  ACKNOWLEDGED: "Confirmado",
  FAILED: "Falhou",
  EXPIRED: "Expirado",
};
function commandState(c: DeviceCommand) {
  return ["QUEUED", "SENT"].includes(c.status) &&
    Date.parse(c.expiresAt) < Date.now()
    ? "EXPIRED"
    : c.status;
}
function date(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function age(value: string | null) {
  if (!value) return "Sem contato";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 1000),
  );
  return seconds < 60
    ? seconds + " s atrás"
    : seconds < 3600
      ? Math.floor(seconds / 60) + " min atrás"
      : Math.floor(seconds / 3600) + " h atrás";
}
function number(value: number | undefined, key: SensorKey) {
  return value === undefined
    ? "—"
    : value.toLocaleString("pt-BR", {
        maximumFractionDigits: key === "rpm" || key === "power" ? 0 : 1,
      });
}
function Picker({
  value,
  setValue,
  options,
  label,
}: {
  value: string;
  setValue: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger className="iot-select" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Navigation({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate: (v: string) => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <nav className="nav-items">
      {nav.map((n) => (
        <button
          key={n.id}
          className={view === n.id ? "selected" : ""}
          aria-current={view === n.id ? "page" : undefined}
          onClick={() => {
            onNavigate(n.id);
            setOpenMobile(false);
          }}
        >
          <n.icon size={19} />
          {n.title}
        </button>
      ))}
    </nav>
  );
}
function CommandsTable({
  commands,
  all = false,
}: {
  commands: DeviceCommand[];
  all?: boolean;
}) {
  return (
    <div className="table-scroll">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Comando</TableHead>
            {all && <TableHead>Dispositivo</TableHead>}
            <TableHead>Estado</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead>Resposta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...commands].reverse().map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <strong className="mono">{c.name}</strong>
                <small className="mono">{c.id.slice(0, 8)}</small>
              </TableCell>
              {all && <TableCell className="mono">{c.deviceId}</TableCell>}
              <TableCell>
                <span className={"state " + commandState(c).toLowerCase()}>
                  {statusLabel[commandState(c)]}
                </span>
              </TableCell>
              <TableCell>{date(c.createdAt)}</TableCell>
              <TableCell className="response-cell">
                {c.message || "Aguardando retorno do dispositivo"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!commands.length && (
        <div className="empty">
          <CommandIcon size={25} />
          <strong>Nenhum comando enviado</strong>
          <p>Use os controles do dispositivo para enviar o primeiro comando.</p>
        </div>
      )}
    </div>
  );
}
function LogList({
  logs,
  all = false,
}: {
  logs: Fleet["logs"];
  all?: boolean;
}) {
  return (
    <div className="log-list">
      {[...logs]
        .reverse()
        .slice(0, 100)
        .map((l) => (
          <div className="log-row" key={l.id}>
            <span className="log-time">{date(l.createdAt)}</span>
            <span className={"log-level " + l.level.toLowerCase()}>
              {l.level}
            </span>
            {all && <span className="mono log-device">{l.deviceId}</span>}
            <p>{l.message}</p>
          </div>
        ))}
      {!logs.length && <div className="empty">Nenhum log neste filtro.</div>}
    </div>
  );
}
function TelemetryChart({
  device,
  samples,
  metric,
  setMetric,
}: {
  device: Device;
  samples: Fleet["telemetry"];
  metric: SensorKey;
  setMetric: (key: SensorKey) => void;
}) {
  const key = device.sensors.some((s) => s.key === metric)
      ? metric
      : device.sensors[0].key,
    catalog = sensorCatalog[key],
    latest = samples.at(-1),
    data = samples
      .filter((t) => t.metrics[key] !== undefined)
      .slice(-60)
      .map((t) => ({
        time: new Date(t.recordedAt).toLocaleTimeString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        value: t.metrics[key],
      }));
  return (
    <section className="panel telemetry-panel">
      <div className="panel-heading">
        <div>
          <h2>Telemetria</h2>
          <p>
            Últimas {data.length} amostras · {catalog.name}
          </p>
        </div>
        <Picker
          value={key}
          setValue={(v) => setMetric(v as SensorKey)}
          label="Sensor no gráfico"
          options={device.sensors.map((s) => ({
            value: s.key,
            label: sensorCatalog[s.key].name,
          }))}
        />
      </div>
      <div className="chart-value">
        <strong>
          {number(latest?.metrics[key], key)}
          <span>{catalog.unit}</span>
        </strong>
        <span>
          {latest
            ? "Última amostra: " + age(latest.recordedAt)
            : "Aguardando a primeira amostra"}
        </span>
      </div>
      {data.length ? (
        <ChartContainer
          config={{ value: { label: catalog.name, color: catalog.color } }}
          className="main-chart"
        >
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id={"fill-" + key} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={catalog.color}
                  stopOpacity={0.22}
                />
                <stop offset="100%" stopColor={catalog.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="#223149"
              strokeDasharray="3 4"
            />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              minTickGap={50}
              tick={{ fill: "#8b9cb4", fontSize: 12 }}
            />
            <YAxis
              width={50}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#8b9cb4", fontSize: 12 }}
              domain={["auto", "auto"]}
              tickFormatter={(v) =>
                Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(v) =>
                    Number(v).toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    }) +
                    " " +
                    catalog.unit
                  }
                />
              }
            />
            <Area
              dataKey="value"
              type="monotone"
              stroke={catalog.color}
              strokeWidth={2.5}
              fill={"url(#fill-" + key + ")"}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="empty chart-empty">
          Este sensor ainda não recebeu telemetria.
        </div>
      )}
      <div className="topic-label">
        <Radio size={14} />
        <code>fleet/v1/{device.id}/telemetry</code>
        <button
          aria-label="Copiar tópico"
          onClick={() =>
            navigator.clipboard
              .writeText("fleet/v1/" + device.id + "/telemetry")
              .then(() => toast.success("Tópico copiado."))
              .catch(() => toast.error("Não foi possível copiar."))
          }
        >
          <Copy size={14} />
        </button>
      </div>
    </section>
  );
}
export default function DeviceManager() {
  const [fleet, setFleet] = useState<Fleet | null>(null),
    [error, setError] = useState(""),
    [view, setView] = useState("devices"),
    [selected, setSelected] = useState("ESP32-002"),
    [search, setSearch] = useState(""),
    [metric, setMetric] = useState<SensorKey>("temperature"),
    [busy, setBusy] = useState(false),
    [register, setRegister] = useState(false),
    [command, setCommand] = useState<DeviceCommand["name"] | null>(null),
    [logLevel, setLogLevel] = useState("all"),
    [filterStatus, setFilterStatus] = useState("all");
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet", { cache: "no-store" });
      const data = (await res.json()) as Fleet & { error?: string };
      if (!res.ok)
        throw new Error(
          data.error || "Não foi possível carregar os dispositivos.",
        );
      setFleet(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [reload]);
  async function save(action: FleetAction) {
    if (!fleet) return false;
    try {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: fleet.revision, action }),
      });
      const data = (await res.json()) as Fleet & { error?: string };
      if (!res.ok) {
        if (res.status === 409) await reload();
        throw new Error(data.error || "Não foi possível salvar.");
      }
      setFleet(data);
      toast.success(
        action.action === "register"
          ? "Dispositivo cadastrado."
          : action.action === "simulate"
            ? "Ciclo simulado recebido."
            : "Comando enfileirado. Aguardando confirmação.",
      );
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }
  const device =
      fleet?.devices.find((d) => d.id === selected) || fleet?.devices[0],
    isOnline = device ? online(device) : false;
  const samples =
      fleet?.telemetry
        .filter((t) => t.deviceId === device?.id)
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)) || [],
    latest = samples.at(-1),
    commands = fleet?.commands.filter((c) => c.deviceId === device?.id) || [],
    logs = fleet?.logs.filter((l) => l.deviceId === device?.id) || [];
  const items =
      fleet?.devices.filter(
        (d) =>
          (filterStatus === "all" ||
            (filterStatus === "online") === online(d)) &&
          [d.id, d.name, d.project]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) || [],
    pending = commands.some((c) =>
      ["QUEUED", "SENT"].includes(commandState(c)),
    );
  function selectDevice(d: Device) {
    setSelected(d.id);
    setMetric(d.sensors[0].key);
  }
  async function simulate() {
    if (!device || busy) return;
    setBusy(true);
    await save({
      action: "simulate",
      requestId: crypto.randomUUID(),
      deviceId: device.id,
    });
    setBusy(false);
  }
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (x: unknown, o: unknown) => unknown };
      }
    ).modelContext;
    if (!context || !fleet) return;
    const life = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "read_iot_fleet",
            title: "Consultar dispositivos IoT",
            description:
              "Consulta status, firmware e último contato. Não envia comandos.",
            inputSchema: {
              type: "object",
              properties: { deviceId: { type: "string" } },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: (raw: unknown) => {
              const id = (raw as { deviceId?: unknown })?.deviceId;
              if (
                id !== undefined &&
                (typeof id !== "string" ||
                  !fleet.devices.some((d) => d.id === id))
              )
                throw Error("Dispositivo inválido");
              return {
                mode: fleet.mode,
                devices: fleet.devices
                  .filter((d) => !id || d.id === id)
                  .map((d) => ({
                    id: d.id,
                    name: d.name,
                    online: online(d),
                    firmware: d.firmware,
                    lastSeen: d.lastSeen,
                  })),
              };
            },
          },
          { signal: life.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => life.abort();
  }, [fleet]);
  return (
    <SidebarProvider className="iot-shell">
      <Toaster theme="dark" position="top-center" richColors />
      <Sidebar className="iot-sidebar">
        <SidebarHeader>
          <a className="brand" href="/">
            <span className="brand-icon">
              <Cpu size={25} />
            </span>
            <div>
              IoT<span>Device Manager</span>
            </div>
          </a>
          <div className="workspace">
            <span className="workspace-icon">
              <Layers size={17} />
            </span>
            <div>
              GeoLab<small>Workspace de dispositivos</small>
            </div>
            <span className="workspace-mark">01</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="sidebar-label">GERENCIAMENTO</div>
          <Navigation view={view} onNavigate={setView} />
          <div className="sidebar-status">
            <Radio size={19} />
            <strong>
              {fleet?.mode === "mqtt"
                ? "Broker MQTT"
                : "Ambiente de demonstração"}
            </strong>
            <p>
              {fleet?.mode === "mqtt"
                ? fleet.broker.connected
                  ? "Conectado ao broker"
                  : "Broker desconectado"
                : "Dispositivos e mensagens simulados"}
            </p>
            <span className="protocol-tag">MQTT · QoS 1</span>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="profile">
            <span>GP</span>
            <div>
              <strong>Geovane Paixão</strong>
              <small>Controle de dispositivos</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="iot-main">
        <header className="topbar">
          <div>
            <SidebarTrigger className="menu-trigger" />
            <span>GeoLab</span>
            <span className="slash">/</span>
            <strong>{nav.find((n) => n.id === view)?.title}</strong>
          </div>
          <div className="top-status">
            <span className="environment">
              {fleet?.mode === "mqtt" ? "MQTT REAL" : "DEMONSTRAÇÃO"}
            </span>
            <span className="top-avatar">GP</span>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <span className="eyebrow">WORKSPACE / GEOLAB</span>
              <h1>
                {view === "devices"
                  ? "Seus dispositivos. Conectados."
                  : view === "telemetry"
                    ? "Telemetria dos dispositivos"
                    : view === "commands"
                      ? "Histórico de comandos"
                      : "Logs da operação"}
              </h1>
              <p>
                {view === "devices"
                  ? "Monitore sensores, acompanhe dados e controle sua frota IoT."
                  : view === "telemetry"
                    ? "Amostras recebidas por dispositivo e sensor."
                    : view === "commands"
                      ? "Da fila à confirmação: acompanhe cada comando remoto."
                      : "Eventos dos dispositivos e respostas da operação."}
              </p>
            </div>
            <button
              className="primary-button"
              disabled={!fleet}
              onClick={() => setRegister(true)}
            >
              <Plus size={18} /> Registrar dispositivo
            </button>
          </div>
          {error ? (
            <div className="error-panel">
              <AlertCircle />
              <h2>Não foi possível carregar a frota</h2>
              <p>{error}</p>
              <button className="primary-button" onClick={reload}>
                Tentar novamente
              </button>
              {error.includes("Entre") && (
                <a href="/signin-with-chatgpt?return_to=/" target="_top">
                  Entrar com ChatGPT
                </a>
              )}
            </div>
          ) : !fleet ? (
            <div className="loading">
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <span>Carregando dispositivos…</span>
            </div>
          ) : (
            <>
              <div className="fleet-metrics">
                <div>
                  <span className="metric-icon blue">
                    <Cpu size={21} />
                  </span>
                  <span>
                    Dispositivos
                    <strong>
                      {fleet.devices.length.toString().padStart(2, "0")}
                    </strong>
                  </span>
                  <small>registrados no workspace</small>
                </div>
                <div>
                  <span className="metric-icon green">
                    <Wifi size={21} />
                  </span>
                  <span>
                    Online
                    <strong>
                      {fleet.devices
                        .filter((d) => online(d))
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                  </span>
                  <small>contato dentro do intervalo</small>
                </div>
                <div>
                  <span className="metric-icon gray">
                    <WifiOff size={21} />
                  </span>
                  <span>
                    Offline
                    <strong>
                      {fleet.devices
                        .filter((d) => !online(d))
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                  </span>
                  <small>aguardando conexão</small>
                </div>
                <div>
                  <span className="metric-icon purple">
                    <Activity size={21} />
                  </span>
                  <span>
                    Sensores
                    <strong>
                      {fleet.devices
                        .reduce(
                          (n, d) =>
                            n + d.sensors.filter((s) => s.enabled).length,
                          0,
                        )
                        .toString()
                        .padStart(2, "0")}
                    </strong>
                  </span>
                  <small>habilitados na frota</small>
                </div>
              </div>
              {view === "devices" ? (
                <>
                  <div className="inventory-heading">
                    <h2>
                      Dispositivos registrados{" "}
                      <span>{fleet.devices.length}</span>
                    </h2>
                    <div>
                      <label className="search">
                        <Search size={16} />
                        <input
                          aria-label="Buscar dispositivo"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Buscar dispositivo…"
                        />
                      </label>
                      <Picker
                        label="Filtrar status"
                        value={filterStatus}
                        setValue={setFilterStatus}
                        options={[
                          { value: "all", label: "Todos os status" },
                          { value: "online", label: "Online" },
                          { value: "offline", label: "Offline" },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="device-grid">
                    {items.map((d) => {
                      const active = online(d),
                        last = fleet.telemetry
                          .filter((t) => t.deviceId === d.id)
                          .at(-1),
                        key = d.sensors[0].key;
                      return (
                        <button
                          className={
                            "device-card " +
                            (device?.id === d.id ? "active" : "")
                          }
                          key={d.id}
                          onClick={() => selectDevice(d)}
                          aria-pressed={device?.id === d.id}
                        >
                          <div className="device-card-top">
                            <span
                              className={
                                "device-icon " +
                                (d.id === "ESP32-001"
                                  ? "energy"
                                  : d.id === "ESP32-003"
                                    ? "baja"
                                    : "temperature")
                              }
                            >
                              {d.id === "ESP32-001" ? (
                                <Zap size={25} />
                              ) : d.id === "ESP32-003" ? (
                                <Gauge size={25} />
                              ) : (
                                <Thermometer size={25} />
                              )}
                            </span>
                            <span
                              className={
                                "connection " + (active ? "online" : "offline")
                              }
                            >
                              <span />
                              {active ? "Online" : "Offline"}
                            </span>
                          </div>
                          <span className="device-id mono">{d.id}</span>
                          <h3>{d.name}</h3>
                          <div className="device-project">
                            <Box size={13} />
                            {d.project}
                          </div>
                          <div className="device-card-data">
                            <span>
                              <small>Firmware</small>
                              <strong className="mono">{d.firmware}</strong>
                            </span>
                            <span>
                              <small>Sensores</small>
                              <strong>
                                {d.sensors.filter((s) => s.enabled).length}{" "}
                                ativos
                              </strong>
                            </span>
                            <span>
                              <small>Último contato</small>
                              <strong>{age(d.lastSeen)}</strong>
                            </span>
                          </div>
                          <div className="card-footer">
                            <span>
                              <Activity size={14} />
                              {number(last?.metrics[key], key)}{" "}
                              {sensorCatalog[key].unit}
                            </span>
                            <span className="card-selection">
                              {device?.id === d.id ? (
                                <>
                                  <Check size={14} />
                                  Selecionado
                                </>
                              ) : (
                                "Ver detalhes"
                              )}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    {!items.length && (
                      <div className="empty">
                        Nenhum dispositivo encontrado.
                      </div>
                    )}
                  </div>
                </>
              ) : view === "telemetry" ? (
                <div className="device-picker-row">
                  <span>Dispositivo</span>
                  <Picker
                    label="Dispositivo"
                    value={device?.id || ""}
                    setValue={(v) => {
                      const d = fleet.devices.find((x) => x.id === v);
                      if (d) selectDevice(d);
                    }}
                    options={fleet.devices.map((d) => ({
                      value: d.id,
                      label: d.id + " · " + d.name,
                    }))}
                  />
                </div>
              ) : null}
              {(view === "devices" || view === "telemetry") && device && (
                <>
                  <div className="selected-heading">
                    <div>
                      <span className="detail-indicator" />
                      <h2>{device.name}</h2>
                      <span className="mono selected-id">{device.id}</span>
                      <span
                        className={
                          "connection " + (isOnline ? "online" : "offline")
                        }
                      >
                        <span />
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    </div>
                    <div>
                      {fleet.mode === "demo" && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={simulate}
                        >
                          {busy ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <Play size={16} />
                          )}{" "}
                          Simular ciclo
                        </button>
                      )}
                      <button
                        className="icon-button"
                        onClick={reload}
                        aria-label="Atualizar dados"
                      >
                        <RefreshCw size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="device-detail-grid">
                    <TelemetryChart
                      device={device}
                      samples={samples}
                      metric={metric}
                      setMetric={setMetric}
                    />
                    <section className="panel command-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Comandos remotos</h2>
                          <p>Controle pelo canal do dispositivo</p>
                        </div>
                        <Terminal size={19} />
                      </div>
                      <div className="command-buttons">
                        {(
                          ["RESTART", "UPDATE_CONFIG", "ENABLE_SENSOR"] as const
                        ).map((name, i) => {
                          const Icon = [Power, Settings2, SlidersHorizontal][i];
                          return (
                            <button
                              key={name}
                              onClick={() => setCommand(name)}
                              disabled={pending}
                            >
                              <span className="command-symbol">
                                <Icon size={18} />
                              </span>
                              <div>
                                <strong>{commandLabel[name]}</strong>
                                <code>{name.replace("_", " ")}</code>
                              </div>
                              <CommandIcon size={15} />
                            </button>
                          );
                        })}
                      </div>
                      <div className="command-note">
                        <Clock size={16} />
                        <p>
                          {pending
                            ? "Há um comando aguardando resposta."
                            : !isOnline
                              ? "Comandos ficam na fila por até 120 s enquanto o dispositivo está offline."
                              : "Execução é confirmada somente após a resposta do dispositivo."}
                        </p>
                      </div>
                      {fleet.mode === "demo" && (
                        <div className="demo-note">
                          Use <strong>Simular ciclo</strong> para gerar dados e
                          confirmar comandos nesta demonstração.
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="sensor-strip">
                    {device.sensors.map((s) => (
                      <div key={s.key}>
                        <span
                          className="sensor-indicator"
                          style={{ background: sensorCatalog[s.key].color }}
                        />
                        <span>
                          {sensorCatalog[s.key].name}
                          <small>
                            {s.enabled ? "Habilitado" : "Desabilitado"}
                          </small>
                        </span>
                        <strong>
                          {s.enabled
                            ? number(latest?.metrics[s.key], s.key)
                            : "—"}
                          <small>{sensorCatalog[s.key].unit}</small>
                        </strong>
                      </div>
                    ))}
                  </div>
                  <section className="panel device-history">
                    <Tabs defaultValue="logs">
                      <div className="history-heading">
                        <TabsList>
                          <TabsTrigger value="logs">
                            <Terminal size={15} /> Logs do dispositivo
                          </TabsTrigger>
                          <TabsTrigger value="commands">
                            <CommandIcon size={15} /> Comandos
                          </TabsTrigger>
                          <TabsTrigger value="info">
                            <Code2 size={15} /> Configuração
                          </TabsTrigger>
                        </TabsList>
                        <span>Último contato: {age(device.lastSeen)}</span>
                      </div>
                      <TabsContent value="logs">
                        <LogList logs={logs} />
                      </TabsContent>
                      <TabsContent value="commands">
                        <CommandsTable commands={commands} />
                      </TabsContent>
                      <TabsContent value="info">
                        <div className="info-grid">
                          <div>
                            <span>Modelo</span>
                            <strong>{device.model}</strong>
                          </div>
                          <div>
                            <span>Firmware reportado</span>
                            <strong className="mono">{device.firmware}</strong>
                          </div>
                          <div>
                            <span>Intervalo de amostragem</span>
                            <strong>{device.config.sampleIntervalSec} s</strong>
                          </div>
                          <div>
                            <span>Cadastro</span>
                            <strong>{date(device.createdAt)}</strong>
                          </div>
                        </div>
                        <div className="config-json">
                          <span>Configuração confirmada</span>
                          <pre>
                            {JSON.stringify(
                              {
                                deviceId: device.id,
                                firmware: device.firmware,
                                ...device.config,
                                sensors: device.sensors,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </section>
                </>
              )}
              {view === "commands" && (
                <section className="panel full-history">
                  <div className="panel-heading">
                    <div>
                      <h2>Comandos da frota</h2>
                      <p>Fila, envio, confirmação e prazo de execução</p>
                    </div>
                    <span>{fleet.commands.length} registros</span>
                  </div>
                  <CommandsTable commands={fleet.commands} all />
                </section>
              )}
              {view === "logs" && (
                <section className="panel full-history">
                  <div className="panel-heading">
                    <div>
                      <h2>Eventos da frota</h2>
                      <p>Até 100 eventos exibidos, mais recentes primeiro</p>
                    </div>
                    <Picker
                      value={logLevel}
                      setValue={setLogLevel}
                      label="Filtrar nível do log"
                      options={[
                        { value: "all", label: "Todos os níveis" },
                        { value: "INFO", label: "INFO" },
                        { value: "WARN", label: "WARN" },
                        { value: "ERROR", label: "ERROR" },
                      ]}
                    />
                  </div>
                  <LogList
                    logs={fleet.logs.filter(
                      (l) => logLevel === "all" || l.level === logLevel,
                    )}
                    all
                  />
                </section>
              )}
              <footer>
                <span>
                  <Radio size={14} />
                  {fleet.mode === "demo"
                    ? "Demonstração persistente · dados simulados"
                    : fleet.broker.connected
                      ? "Broker MQTT conectado"
                      : "Broker MQTT desconectado"}
                </span>
                <span>Atualização a cada 10 s · horários de Brasília</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {fleet && register && (
        <RegisterDialog
          save={save}
          close={() => setRegister(false)}
          onRegistered={(id) => {
            setSelected(id);
            setView("devices");
          }}
        />
      )}
      {device && command && (
        <CommandDialog
          device={device}
          name={command}
          demo={fleet?.mode === "demo"}
          save={save}
          close={() => setCommand(null)}
        />
      )}
    </SidebarProvider>
  );
}
function RegisterDialog({
  save,
  close,
  onRegistered,
}: {
  save: (a: FleetAction) => Promise<boolean>;
  close: () => void;
  onRegistered: (id: string) => void;
}) {
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [project, setProject] = useState(""),
    [firmware, setFirmware] = useState("v1.0.0"),
    [model, setModel] = useState("ESP32-WROOM"),
    [sensors, setSensors] = useState<SensorKey[]>(["temperature"]),
    [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && !saving && close()}>
      <DialogContent className="iot-dialog">
        <DialogHeader>
          <DialogTitle>Registrar dispositivo</DialogTitle>
          <DialogDescription>
            Cadastre a identidade e os sensores da sua placa.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            setSaving(true);
            if (
              await save({
                action: "register",
                requestId: crypto.randomUUID(),
                device: { id, name, project, firmware, model, sensors },
              })
            ) {
              onRegistered(id);
              close();
            }
            setSaving(false);
          }}
        >
          <div className="form-row">
            <label>
              Identificador
              <input
                value={id}
                onChange={(e) => setId(e.target.value.toUpperCase())}
                pattern="[A-Z0-9][A-Z0-9_-]{3,47}"
                maxLength={48}
                required
                placeholder="ESP32-004"
              />
            </label>
            <label>
              Nome
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={80}
                required
                placeholder="Nome do dispositivo"
              />
            </label>
          </div>
          <label>
            Projeto
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              minLength={2}
              maxLength={80}
              required
              placeholder="Projeto ou aplicação"
            />
          </label>
          <div className="form-row">
            <label>
              Modelo
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                maxLength={40}
                required
              />
            </label>
            <label>
              Firmware
              <input
                value={firmware}
                onChange={(e) => setFirmware(e.target.value)}
                maxLength={40}
                required
              />
            </label>
          </div>
          <fieldset>
            <legend>Sensores disponíveis</legend>
            <div className="sensor-checks">
              {sensorKeys.map((key) => (
                <label key={key}>
                  <Checkbox
                    checked={sensors.includes(key)}
                    onCheckedChange={(v) =>
                      setSensors((s) =>
                        v ? [...s, key] : s.filter((k) => k !== key),
                      )
                    }
                  />
                  {sensorCatalog[key].name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="form-note">
            Use um ID único, sem espaços. O dispositivo ficará offline até o
            primeiro contato.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={close}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={saving || !sensors.length}
            >
              {saving && <LoaderCircle size={16} className="spin" />} Registrar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function CommandDialog({
  device,
  name,
  demo,
  save,
  close,
}: {
  device: Device;
  name: DeviceCommand["name"];
  demo: boolean;
  save: (a: FleetAction) => Promise<boolean>;
  close: () => void;
}) {
  const [interval, setInterval] = useState(
      String(device.config.sampleIntervalSec),
    ),
    [sensor, setSensor] = useState(device.sensors[0].key),
    [enabled, setEnabled] = useState(true),
    [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && !saving && close()}>
      <DialogContent className="iot-dialog">
        <DialogHeader>
          <DialogTitle>{commandLabel[name]}</DialogTitle>
          <DialogDescription>
            {device.id} · {device.name}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            setSaving(true);
            const payload =
              name === "RESTART"
                ? { name, params: {} }
                : name === "UPDATE_CONFIG"
                  ? { name, params: { sampleIntervalSec: Number(interval) } }
                  : { name, params: { sensor, enabled } };
            if (
              await save({
                action: "command",
                requestId: crypto.randomUUID(),
                deviceId: device.id,
                payload,
              })
            )
              close();
            setSaving(false);
          }}
        >
          <div className="command-code">
            <Terminal size={17} />
            <code>{name}</code>
            <span>QoS 1</span>
          </div>
          {name === "RESTART" ? (
            <p className="command-description">
              O dispositivo pode interromper a transmissão durante a
              reinicialização. A confirmação depende da resposta dele.
            </p>
          ) : name === "UPDATE_CONFIG" ? (
            <label>
              Intervalo de amostragem (segundos)
              <input
                type="number"
                min={5}
                max={3600}
                step={1}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                required
              />
              <small>De 5 a 3.600 segundos.</small>
            </label>
          ) : (
            <>
              <label>
                Sensor
                <Picker
                  value={sensor}
                  setValue={(v) => setSensor(v as SensorKey)}
                  label="Sensor do comando"
                  options={device.sensors.map((s) => ({
                    value: s.key,
                    label: sensorCatalog[s.key].name,
                  }))}
                />
              </label>
              <div className="switch-row">
                <label htmlFor="sensor-enabled">Habilitar sensor</label>
                <Switch
                  id="sensor-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>
            </>
          )}
          <p className="form-note">
            {demo
              ? "Este comando atua no dispositivo simulado. Use Simular ciclo para confirmar a execução."
              : "O comando expira após 120 s. A configuração só muda após confirmação do dispositivo."}
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={close}
              disabled={saving}
            >
              Cancelar
            </button>
            <button className="primary-button" disabled={saving}>
              {saving && <LoaderCircle className="spin" size={16} />} Enviar
              comando
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
