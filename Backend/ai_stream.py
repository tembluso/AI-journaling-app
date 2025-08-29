# Backend/ai_stream.py
import os, json, asyncio
from typing import AsyncGenerator, Dict, Optional
from dotenv import load_dotenv, find_dotenv
from openai import OpenAI

load_dotenv(find_dotenv())

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Puedes cambiar por env si quieres otro: OPENAI_MODEL=gpt-4o-mini (tu caso)
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
# Opcional: modelo de fallback para chat.completions si Responses falla
OPENAI_CHAT_FALLBACK = os.getenv("OPENAI_CHAT_FALLBACK", "gpt-3.5-turbo")

def _client() -> OpenAI:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is missing")
    return OpenAI(api_key=OPENAI_API_KEY)

def build_prompt(note_text: str, mode: str) -> str:
    """
    Devuelve un prompt específico por modo, en español, con énfasis en expandir matices,
    contra‑ejemplos y acciones. Siempre exige salida JSON estricta (sin markdown).
    """
    note_text = (note_text or "").strip()
    base_guard = (
        "Devuelve SOLO JSON válido (sin markdown, sin comentarios) y exactamente las claves del esquema indicado "
        "para cada modo. Sé concreto, evita vaguedades, aporta matices, contra‑ejemplos y ejemplos prácticos. "
        "No inventes datos personales. Responde en español neutro."
    )

    if mode == "socratico":
        # Socrático → preguntas + siguiente acción
        return f"""
{base_guard}
Modo: SOCRÁTICO.
Objetivo: ayudar al usuario a examinar y expandir su idea desde varios ángulos.
Instrucciones:
- Formula de 3 a 6 preguntas socráticas que exploren supuestos, consecuencias, alternativas y contra‑argumentos.
- Evita preguntas triviales; busca profundidad y diferentes perspectivas.
- Propón UNA siguiente acción breve y realista (con un deadline sugerido ISO YYYY-MM-DD si aplica).
- Si la nota es vaga, enfoca preguntas para concretar.

Texto de la nota (contexto del usuario):
\"\"\"{note_text}\"\"\"

Esquema JSON de salida:
{{
  "questions": [string, ...], 
  "next_action": {{"text": string, "deadline": string | null}}
}}
""".strip()

    if mode == "estructurado":
        # Estructurado → análisis con varios apartados
        return f"""
{base_guard}
Modo: ESTRUCTURADO.
Objetivo: analizar y ampliar la idea con pensamiento crítico y plan accionable.
Instrucciones:
- Explica por qué importa esta idea (impacto y valor).
- Enumera de 3 a 6 supuestos implícitos que podrían no cumplirse.
- Enumera de 2 a 5 riesgos/obstáculos con un breve matiz o contra‑ejemplo.
- Propón un primer paso alcanzable que pueda hacerse en ~30 minutos.
- Define una métrica de éxito observable.
- Aporta matices: alternativas, puntos ciegos y ejemplos concisos.

Texto de la nota:
\"\"\"{note_text}\"\"\"

Esquema JSON de salida:
{{
  "por_qué_importa": string,
  "supuestos": [string, ...],
  "riesgos": [string, ...],
  "primer_paso_30min": string,
  "métrica_de_éxito": string
}}
""".strip()

    if mode == "semanal":
        # Semanal → revisión y ampliación
        return f"""
{base_guard}
Modo: SEMANAL.
Objetivo: revisar la semana y ampliar perspectivas para la siguiente.
Instrucciones:
- Extrae de 3 a 6 temas relevantes que emerjan del texto (hábitos, emociones, patrones).
- Señala una creencia a cuestionar (bias/afirmación rígida) con un ángulo alternativo.
- Propón un micro‑experimento sencillo para la próxima semana que explore un matiz distinto.

Texto de la nota:
\"\"\"{note_text}\"\"\"

Esquema JSON de salida:
{{
  "temas": [string, ...],
  "creencia_a_cuestionar": string,
  "micro_experimento": string
}}
""".strip()

    # Fallback: resumen + ideas + acciones (por si llega un 'mode' desconocido)
    return f"""
{base_guard}
Modo: GENERAL.
Objetivo: resumir y ampliar la idea con matices, alternativas y acciones.
Instrucciones:
- Escribe un resumen de 1–2 frases con el matiz principal.
- Ofrece entre 3 y 6 insights variados (incluye al menos 1 contra‑punto).
- Propón entre 2 y 4 acciones específicas y realistas.

Texto de la nota:
\"\"\"{note_text}\"\"\"

Esquema JSON de salida:
{{
  "summary": string,
  "insights": [string, ...],
  "actions": [string, ...]
}}
""".strip()


async def stream_reflection(note_text: str, mode: str) -> AsyncGenerator[Dict, None]:
    """
    Emite eventos para SSE:
      - {'type':'chunk','delta':'...'}
      - {'type':'done','full_text':'...','parsed':{...}|None,'error':str|None}
    Primero intenta Responses API streaming; si falla, hace fallback a chat.completions streaming.
    """
    client = _client()
    prompt = build_prompt(note_text, mode)

    # --------- 1) Responses API streaming (preferido) ---------
    try:
        full = []

        # Nuevo SDK: streaming con context manager
        with client.responses.stream(
            model=OPENAI_MODEL,
            input=prompt,
            temperature=0.2,
        ) as stream:
            for event in stream:
                # Texto incremental
                if event.type == "response.output_text.delta":
                    delta = event.delta or ""
                    if delta:
                        full.append(delta)
                        yield {"type": "chunk", "delta": delta}
                # Errores del servidor
                elif event.type == "response.error":
                    # Enviamos done con error y abortamos
                    err_msg = getattr(event, "error", None)
                    yield {
                        "type": "done",
                        "full_text": "".join(full),
                        "parsed": None,
                        "error": str(err_msg) if err_msg else "openai_response_error",
                    }
                    return

            # Final: recogemos respuesta final (por si se necesita)
            _ = stream.get_final_response()

        full_text = "".join(full).strip()
        try:
            parsed = json.loads(full_text)
            yield {"type": "done", "full_text": full_text, "parsed": parsed, "error": None}
        except Exception:
            yield {"type": "done", "full_text": full_text, "parsed": None, "error": "invalid_json"}
        return

    except Exception as e_responses:
        # Seguimos al fallback
        fallback_reason = f"responses_stream_failed: {type(e_responses).__name__}: {e_responses}"

    # --------- 2) Fallback: Chat Completions streaming ---------
    try:
        full = []
        resp = client.chat.completions.create(
            model=OPENAI_CHAT_FALLBACK,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            stream=True,
            timeout=60,
        )
        for ev in resp:
            delta = getattr(getattr(ev.choices[0], "delta", None), "content", None)
            if delta:
                full.append(delta)
                yield {"type": "chunk", "delta": delta}
            await asyncio.sleep(0)

        full_text = "".join(full).strip()
        try:
            parsed = json.loads(full_text)
            yield {"type": "done", "full_text": full_text, "parsed": parsed, "error": None}
        except Exception:
            yield {"type": "done", "full_text": full_text, "parsed": None, "error": "invalid_json"}
    except Exception as e_chat:
        # Ambos métodos fallaron
        yield {
            "type": "done",
            "full_text": "",
            "parsed": None,
            "error": f"{fallback_reason}; chat_fallback_failed: {type(e_chat).__name__}: {e_chat}",
        }
