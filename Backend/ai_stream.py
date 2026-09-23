# Backend/ai_stream.py
import os, json, asyncio
from typing import AsyncGenerator, Dict, Optional
from dotenv import load_dotenv, find_dotenv
from openai import OpenAI

load_dotenv(find_dotenv())

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Puedes cambiar por env si quieres otro: OPENAI_MODEL=gpt-5.6-luna (tu caso)
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-luna")
# Opcional: modelo de fallback para chat.completions si Responses falla
OPENAI_CHAT_FALLBACK = os.getenv("OPENAI_CHAT_FALLBACK", "gpt-3.5-turbo")

def _client() -> OpenAI:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is missing")
    return OpenAI(api_key=OPENAI_API_KEY)

def build_prompt(note_text: str, mode: str) -> str:
    """
    Returns a mode-specific prompt in English. The goal is expansion, not
    evaluation: take the user's own reflection further by connecting it to
    other ideas, angles, and questions, rather than grading or auditing it
    like a business plan. Always demands strict JSON output (no markdown).
    """
    note_text = (note_text or "").strip()
    base_guard = (
        "Return ONLY valid JSON (no markdown, no comments) using exactly the keys in the schema "
        "given for this mode. Be concrete and specific, not generic — ground everything in what "
        "the note actually says. Don't invent personal facts about the user. Respond in English."
    )

    if mode == "socratico":
        # Socratic — probing questions that open the idea up, plus one small next step
        return f"""
{base_guard}
Mode: SOCRATIC.
Goal: help the user pull on threads in their own thinking — surface hidden assumptions,
overlooked consequences, and angles they haven't considered yet.
Instructions:
- Ask 3 to 6 Socratic questions that dig into assumptions, implications, alternatives, and counterarguments in the note.
- Avoid generic or shallow questions; go for real depth and a genuine change of perspective.
- Suggest ONE small, concrete next step the user could take to explore one of these questions further.
- If the note is vague, aim your questions at helping the user get more concrete.

The user's note:
\"\"\"{note_text}\"\"\"

Output JSON schema:
{{
  "questions": [string, ...],
  "next_step": string
}}
""".strip()

    if mode == "estructurado":
        # Expand — connect the note to other ideas, angles, and open threads
        return f"""
{base_guard}
Mode: EXPAND.
Goal: take the user's reflection further. Don't evaluate or grade it — expand it. Help the
user see more than they wrote by connecting their idea to other ideas, fields, or ways of
looking at it, and by surfacing viewpoints they may not have considered.
Instructions:
- Write a short expansion (2-4 sentences) that deepens the note's core idea — add nuance,
  context, or a "here's what this connects to" angle. Build on what they wrote, don't just restate it.
- List 3 to 5 connected ideas: related concepts, analogies, or ideas from other domains
  (psychology, other people's experiences, books, history, etc.) that genuinely link to this note.
- List 2 to 4 alternative perspectives: other ways to frame or see this situation, including at
  least one that gently challenges the note's own framing.
- Name ONE specific thread from all of this that seems most worth exploring next, and why.

The user's note:
\"\"\"{note_text}\"\"\"

Output JSON schema:
{{
  "expanded_reflection": string,
  "connected_ideas": [string, ...],
  "alternative_perspectives": [string, ...],
  "worth_exploring_next": string
}}
""".strip()

    if mode == "semanal":
        # Weekly — review and widen the lens for the week ahead
        return f"""
{base_guard}
Mode: WEEKLY.
Goal: review the week and widen the perspective going into the next one.
Instructions:
- Pull out 3 to 6 themes that emerge from the text (habits, emotions, recurring patterns).
- Name one belief or rigid assumption worth questioning, and offer an alternative angle on it.
- Suggest one small experiment for next week that explores a different nuance of this.

The user's note:
\"\"\"{note_text}\"\"\"

Output JSON schema:
{{
  "themes": [string, ...],
  "belief_to_question": string,
  "micro_experiment": string
}}
""".strip()

    # Fallback for an unknown mode
    return f"""
{base_guard}
Mode: GENERAL.
Goal: summarize and expand the idea with nuance, alternatives, and connections.
Instructions:
- Write a 1-2 sentence summary capturing the main nuance.
- Offer 3 to 6 varied insights (include at least 1 counterpoint or connection to another idea).
- Suggest 2 to 4 specific, realistic next steps.

The user's note:
\"\"\"{note_text}\"\"\"

Output JSON schema:
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
