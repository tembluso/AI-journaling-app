// frontend/src/components/ReflectPanel.jsx
import { useState, useRef } from "react";
import { api, streamReflect, reflectNote } from "../api/client";

/* ---------- Render con tu estilo ---------- */
function RenderResult({ data }) {
  if (!data) return null;

  // Socrático
  if (Array.isArray(data.questions) || data.next_action) {
    return (
      <div className="space-y-3">
        {Array.isArray(data.questions) && data.questions.length > 0 && (
          <>
            <div className="font-semibold">Preguntas</div>
            <ul className="list-disc pl-5">
              {data.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </>
        )}
        {data.next_action && (
          <div className="text-sm opacity-90">
            <div className="font-semibold">Siguiente acción</div>
            <div>
              {data.next_action.text}
              {data.next_action.deadline ? (
                <> — <span className="opacity-70">{data.next_action.deadline}</span></>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Estructurado
  if (data["por_qué_importa"] || Array.isArray(data.supuestos) || Array.isArray(data.riesgos)) {
    return (
      <div className="space-y-3">
        {data["por_qué_importa"] && (
          <div>
            <div className="font-semibold">Por qué importa</div>
            <p className="opacity-90 text-sm">{data["por_qué_importa"]}</p>
          </div>
        )}
        {Array.isArray(data.supuestos) && data.supuestos.length > 0 && (
          <>
            <div className="font-semibold">Supuestos</div>
            <ul className="list-disc pl-5">
              {data.supuestos.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </>
        )}
        {Array.isArray(data.riesgos) && data.riesgos.length > 0 && (
          <>
            <div className="font-semibold">Riesgos</div>
            <ul className="list-disc pl-5">
              {data.riesgos.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </>
        )}
        {(data.primer_paso_30min || data["métrica_de_éxito"]) && (
          <div className="grid gap-2">
            {data.primer_paso_30min && (
              <div><span className="font-semibold">Primer paso (30 min):</span> {data.primer_paso_30min}</div>
            )}
            {data["métrica_de_éxito"] && (
              <div><span className="font-semibold">Métrica de éxito:</span> {data["métrica_de_éxito"]}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Semanal
  if (Array.isArray(data.temas) || data.creencia_a_cuestionar || data.micro_experimento) {
    return (
      <div className="space-y-3">
        {Array.isArray(data.temas) && data.temas.length > 0 && (
          <>
            <div className="font-semibold">Temas</div>
            <ul className="list-disc pl-5">
              {data.temas.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </>
        )}
        {data.creencia_a_cuestionar && (
          <div><span className="font-semibold">Creencia a cuestionar:</span> {data.creencia_a_cuestionar}</div>
        )}
        {data.micro_experimento && (
          <div><span className="font-semibold">Micro-experimento:</span> {data.micro_experimento}</div>
        )}
      </div>
    );
  }

  // Fallback legible (nunca JSON crudo)
  return (
    <div className="space-y-2 text-sm">
      {Object.entries(data).map(([k, v]) => (
        <div key={k}>
          <div className="font-semibold capitalize">{k}</div>
          {Array.isArray(v) ? (
            <ul className="list-disc pl-5">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>
          ) : (
            <div className="opacity-90">{String(v)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Sub-nota ---------- */
function toSubnoteContent(mode, result, parentTitle) {
  if (!result) return "";
  if (Array.isArray(result.questions)) {
    return `Reflexión Socrática sobre "${parentTitle}"\n\nPreguntas:\n- ${result.questions.join("\n- ")}\n\nSiguiente acción: ${result.next_action?.text || ""} ${result.next_action?.deadline ? `(deadline: ${result.next_action.deadline})` : ""}`.trim();
  }
  if (result["por_qué_importa"] || result.supuestos || result.riesgos) {
    return `Estructurado: "${parentTitle}"\n\nPor qué importa: ${result["por_qué_importa"] || ""}\n\nSupuestos:\n- ${(result.supuestos || []).join("\n- ")}\n\nRiesgos:\n- ${(result.riesgos || []).join("\n- ")}\n\nPrimer paso (30m): ${result.primer_paso_30min || ""}\n\nMétrica de éxito: ${result["métrica_de_éxito"] || ""}`.trim();
  }
  if (result.temas || result.creencia_a_cuestionar || result.micro_experimento) {
    return `Revisión semanal: "${parentTitle}"\n\nTemas:\n- ${(result.temas || []).join("\n- ")}\n\nCreencia a cuestionar: ${result.creencia_a_cuestionar || ""}\n\nMicro-experimento: ${result.micro_experimento || ""}`.trim();
  }
  return `Reflexión sobre "${parentTitle}"\n\n${Object.entries(result).map(([k,v]) => `• ${k}: ${String(v)}`).join("\n")}`;
}

/* ---------- Panel con SSE ---------- */
export default function ReflectPanel({ note, onError }) {
  const [mode, setMode] = useState("socratico");
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState(null);
  const [partial, setPartial] = useState({});
  const bufRef = useRef("");

  function projectPartial(text, mode) {
    // 1) si ya es JSON válido (aunque sea parcial bien formado), úsalo
    try {
      const fixed = text.replace(/```json|```/g, "").trim();
      return JSON.parse(fixed);
    } catch {}
    // 2) extracción tolerante para JSON a medias (por modo)
    const pickStr = (k) => {
      const m = text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)`, "s"));
      return m ? m[1] : "";
    };
    const pickArr = (k) => {
      const m = text.match(new RegExp(`"${k}"\\s*:\\s*\\[(.*?)$`, "s"));
      if (!m) return [];
      return Array.from(m[1].matchAll(/"([^"]+)"/g)).map(x => x[1]).slice(0, 12);
    };

    if (mode === "socratico") {
      return {
        questions: pickArr("questions"),
        next_action: (pickStr("next_action.text") || pickStr("next_action"))
          ? { text: pickStr("next_action.text") || pickStr("next_action"), deadline: pickStr("next_action.deadline") || null }
          : undefined,
      };
    }

    if (mode === "estructurado") {
      return {
        "por_qué_importa": pickStr("por_qué_importa"),
        supuestos: pickArr("supuestos"),
        riesgos: pickArr("riesgos"),
        primer_paso_30min: pickStr("primer_paso_30min"),
        "métrica_de_éxito": pickStr("métrica_de_éxito"),
      };
    }

    if (mode === "semanal") {
      return {
        temas: pickArr("temas"),
        creencia_a_cuestionar: pickStr("creencia_a_cuestionar"),
        micro_experimento: pickStr("micro_experimento"),
      };
    }

    // Fallback general
    return {
      summary: pickStr("summary"),
      insights: pickArr("insights"),
      actions: pickArr("actions"),
    };
  }

  function reflect() {
    if (!note) return;
    setStreaming(true);
    setResult(null);
    setPartial({});
    bufRef.current = "";

    streamReflect({
      noteId: note.id,
      mode,
      handlers: {
        onChunk: (delta) => {
          bufRef.current += delta;
          setPartial(projectPartial(bufRef.current, mode));
        },
        onDone: ({ fullText, parsed }) => {
          setStreaming(false);
          if (parsed) {
            setResult(parsed);
            return;
          }
          try {
            const fixed = (fullText || "").replace(/```json|```/g, "").trim();
            setResult(JSON.parse(fixed));
          } catch {
            // si no parsea, nos quedamos con el último 'partial' bien formateado
            setResult(null);
          }
        },
        onError: async () => {
          setStreaming(false);
          // Fallback a no-stream (tu endpoint clásico) SIN duplicar llamadas
          try {
            const data = await reflectNote(note.id, { mode, prompt_payload: { source: "ui" } });
            setResult(data.result_json || data);
          } catch (e) {
            onError?.(e.message);
          }
        },
      },
    });
  }

  async function createSubnote() {
    if (!note || !(result || partial)) return;
    const data = result || partial;
    const content = toSubnoteContent(mode, data, note.title || "Nota");
    const title = (content.split(/\r?\n/)[0] || "").slice(0, 120);
    try {
      await api(`/notes/${note.id}/children`, {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
    } catch (e) {
      onError?.(e.message);
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 p-2 rounded"
        >
          <option value="socratico">Socrático</option>
          <option value="estructurado">Estructurado</option>
          <option value="semanal">Semanal</option>
        </select>

        <button
          onClick={reflect}
          disabled={!note || streaming}
          className="px-3 py-2 rounded bg-fuchsia-700 disabled:bg-zinc-700"
        >
          {streaming ? "Generando…" : "AI Reflect"}
        </button>

        <button
          onClick={createSubnote}
          disabled={!(result || partial)}
          className="px-3 py-2 rounded bg-emerald-600 disabled:bg-zinc-700"
        >
          Crear sub-nota
        </button>
      </div>

      {/* Tarjeta con altura controlada y scroll interno */}
      <div className="flex-1 min-h-0 bg-zinc-900 border border-zinc-800 rounded p-4 overflow-auto">
        {streaming ? (
          <div className="space-y-3">
            <div className="text-xs opacity-70">Generando reflexión…</div>
            <RenderResult data={partial} />
          </div>
        ) : result ? (
          <RenderResult data={result} />
        ) : (
          <div className="text-sm text-zinc-400">Sin resultados todavía.</div>
        )}
      </div>
    </div>
  );
}
