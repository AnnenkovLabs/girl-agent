import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function DiagnosticsPage() {
  const [version, setVersion] = useState<{ current: string; latest: string | null } | null>(null);
  const [diag, setDiag] = useState<{ platform: string; arch: string; node: string; hostname: string; uptime: number; dataRoot: string; ipv4: string[]; memTotalMB: number } | null>(null);

  useEffect(() => {
    void api.getVersion().then(setVersion).catch(() => { /* silent */ });
    void api.getDiagnostics().then(setDiag).catch(() => { /* silent */ });
  }, []);

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 720 }}>
      <div className="card">
        <div className="card-header"><div className="h-title">Версия</div></div>
        <div className="grid cols-2">
          <div className="form-row"><label>Текущая</label><div>{version?.current ?? "..."}</div></div>
          <div className="form-row"><label>Последняя</label><div>{version?.latest ?? "—"}</div></div>
        </div>
        <div className="hint">обновление: <code>npm i -g @thesashadev/girl-agent</code> или <code>docker pull ghcr.io/thesashadev/girl-agent:latest</code></div>
      </div>

      <div className="card">
        <div className="card-header"><div className="h-title">Окружение</div></div>
        {diag && (
          <div className="grid cols-2">
            <div className="form-row"><label>Платформа</label><div>{diag.platform} / {diag.arch}</div></div>
            <div className="form-row"><label>Node</label><div>{diag.node}</div></div>
            <div className="form-row"><label>Хост</label><div>{diag.hostname}</div></div>
            <div className="form-row"><label>RAM</label><div>{diag.memTotalMB} MB</div></div>
            <div className="form-row"><label>Uptime</label><div>{Math.round(diag.uptime)} сек</div></div>
            <div className="form-row"><label>Data root</label><div style={{ fontFamily: "var(--ga-font-mono)", fontSize: 12 }}>{diag.dataRoot}</div></div>
            <div className="form-row" style={{ gridColumn: "span 2" }}><label>IPv4</label><div>{diag.ipv4.length ? diag.ipv4.join(", ") : "(только loopback)"}</div></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><div className="h-title">VPN / прокси</div></div>
        <div className="hint">girl-agent использует WSS (websocket) для Telegram по умолчанию — это обходит большинство блокировок.<br />
          Если из РФ не подключается к LLM — выберите пресет <strong>ClaudeHub</strong>: работает без VPN.<br />
          Если есть свой прокси — укажите в разделе <strong>Конфигурация → Telegram → Прокси</strong>.</div>
      </div>
    </div>
  );
}
