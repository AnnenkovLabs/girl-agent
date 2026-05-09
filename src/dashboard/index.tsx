import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Gradient from "ink-gradient";
import type { Runtime, RuntimeEvent } from "../engine/runtime.js";
import type { RelationshipScore } from "../types.js";
import { findStage } from "../presets/stages.js";
import { readRelationship, readMd, readSessionLog, sessionDate } from "../storage/md.js";

const SCORE_KEYS: (keyof RelationshipScore)[] = ["interest", "trust", "attraction", "annoyance", "cringe"];

function bar(value: number): string {
  const v = Math.max(-100, Math.min(100, value));
  const norm = Math.round((v + 100) / 10); // 0..20
  return "▕" + "█".repeat(norm) + "·".repeat(20 - norm) + "▏";
}

interface LogLine { t: string; kind: RuntimeEvent["type"]; text: string; }

export function Dashboard({ runtime }: { runtime: Runtime }) {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [score, setScore] = useState<RelationshipScore>({ interest: 0, trust: 0, attraction: 0, annoyance: 0, cringe: 0 });
  const [cmd, setCmd] = useState("");
  const [paused, setPaused] = useState(false);
  const stage = findStage(runtime.cfg.stage);

  useEffect(() => {
    const onEv = (e: RuntimeEvent) => {
      if (e.type === "score" && e.score) setScore(e.score as RelationshipScore);
      const t = new Date().toTimeString().slice(0, 8);
      const text = e.type === "incoming" ? `← ${e.text}`
        : e.type === "outgoing" ? `→ ${e.text}`
        : e.type === "ignored" ? `· игнор (${e.reason ?? ""}): ${e.text ?? ""}`
        : e.type === "error" ? `! ${e.text}`
        : `i ${e.text ?? ""}`;
      setLogs(l => [...l.slice(-200), { t, kind: e.type, text }]);
    };
    runtime.on("event", onEv);
    readRelationship(runtime.cfg.slug).then(r => setScore(r.score));
    return () => { runtime.off("event", onEv); };
  }, [runtime]);

  useInput((_, key) => {
    if (key.ctrl && key.escape) exit();
  });

  async function execute(line: string) {
    const append = (s: string) => setLogs(l => [...l, { t: new Date().toTimeString().slice(0, 8), kind: "info", text: s }]);
    if (!line.startsWith(":")) { append("команды начинаются с :"); return; }
    const [head, ...rest] = line.slice(1).split(" ");
    try {
      switch (head) {
        case "status": append(await runtime.cmdStatus()); break;
        case "model": append(await runtime.cmdModel(rest)); break;
        case "reset": append(await runtime.cmdReset()); setScore({ interest: 0, trust: 0, attraction: 0, annoyance: 0, cringe: 0 }); break;
        case "stage": append(await runtime.cmdSetStage(rest.join(" "))); break;
        case "wake": append(await runtime.cmdWake(rest[0])); break;
        case "debug": append(await runtime.cmdDebug(rest[0])); break;
        case "why": append(await runtime.cmdWhy(rest[0])); break;
        case "amnesia": append(await runtime.cmdAmnesia(rest[0], rest[1])); break;
        case "sticker": append(await runtime.cmdSticker(rest[0])); break;
        case "pause": runtime.pause(); setPaused(true); append("⏸ pause"); break;
        case "resume": runtime.resume(); setPaused(false); append("▶ resume"); break;
        case "cringe": {
          const r = await readRelationship(runtime.cfg.slug);
          append(`cringe=${r.score.cringe}; последние причины смотри в memory/long-term.md и log/`);
          break;
        }
        case "relationship": {
          const r = await readRelationship(runtime.cfg.slug);
          append(`stage=${r.stage} score=${JSON.stringify(r.score)}`);
          break;
        }
        case "persona": {
          const p = await readMd(runtime.cfg.slug, "persona.md");
          append(p.slice(0, 2000));
          break;
        }
        case "log": {
          const day = /^\d{4}-\d{2}-\d{2}$/.test(rest[0] ?? "") ? rest[0]! : sessionDate(runtime.cfg.tz);
          const limit = Number(rest.find(x => /^\d+$/.test(x)) ?? 3000);
          const p = await readSessionLog(runtime.cfg.slug, day);
          append(p.trim() ? p.slice(-Math.max(500, Math.min(limit, 20000))) : `(log/${day}.md пуст или ещё не создан)`);
          break;
        }
        case "help": append(":status :model [provider] [model=...] [api-key=...] :why :amnesia <мин> [chatId] :reset :stage <id|num> :wake [chatId] :debug [chatId] :pause :resume :cringe :relationship :persona :log [YYYY-MM-DD] [chars] :sticker [chatId] :quit"); break;
        case "quit": case "exit": await runtime.stop(); exit(); break;
        default: append(`неизвестная команда: ${head}`);
      }
    } catch (e) {
      append("err: " + (e as Error).message);
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Gradient name="pastel"><Text>{runtime.cfg.name} · {runtime.cfg.age}</Text></Gradient>
        <Text dimColor>{runtime.cfg.mode} · {paused ? "⏸" : "▶"}</Text>
      </Box>
      <Text color="gray">stage: {stage.label}</Text>
      <Box flexDirection="column" marginTop={1}>
        {SCORE_KEYS.map(k => (
          <Text key={k}>
            <Text color="magentaBright">{k.padEnd(10)}</Text>
            <Text color={k === "annoyance" || k === "cringe" ? "red" : "green"}>{bar(score[k])}</Text>
            <Text> {String(score[k]).padStart(4)}</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" marginTop={1} paddingX={1} height={14}>
        {logs.slice(-10).map((l, i) => (
          <Text key={i} color={l.kind === "outgoing" ? "cyan" : l.kind === "incoming" ? "white" : l.kind === "error" ? "red" : "gray"}>
            <Text dimColor>{l.t} </Text>{l.text}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="magenta">{">  "}</Text>
        <TextInput value={cmd} onChange={setCmd} onSubmit={async () => {
          const line = cmd.trim();
          setCmd("");
          if (line) await execute(line);
        }} />
      </Box>
      <Text dimColor>команды: :status :why :amnesia &lt;мин&gt; :reset :stage &lt;id|num&gt; :pause :resume :cringe :persona :log [day] :sticker :quit</Text>
    </Box>
  );
}
