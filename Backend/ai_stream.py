# Backend/ai_stream.py
import os, json
from typing import AsyncGenerator, Dict, List, NamedTuple, Optional
from dotenv import load_dotenv, find_dotenv
from openai import AsyncOpenAI

load_dotenv(find_dotenv())

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Puedes cambiar por env si quieres otro: OPENAI_MODEL=gpt-5.6-luna (tu caso)
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-luna")
# Opcional: modelo de fallback para chat.completions si Responses falla
OPENAI_CHAT_FALLBACK = os.getenv("OPENAI_CHAT_FALLBACK", "gpt-3.5-turbo")

_client_instance: Optional[AsyncOpenAI] = None

def _client() -> AsyncOpenAI:
    # Async client: a sync one blocks the server's single event loop while it
    # waits on the model, which stalls every other request (and other streams)
    # and stops the server from noticing when a client disconnects.
    global _client_instance
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is missing")
    if _client_instance is None:
        _client_instance = AsyncOpenAI(api_key=OPENAI_API_KEY)
    return _client_instance

# How much of the note on either side of a highlighted passage to include
# as context in a selection-scoped reflection.
SELECTION_CONTEXT_CHARS = 600

# How many messages of a note's chat thread are sent back to the model.
CHAT_HISTORY_LIMIT = 20


class Selection(NamedTuple):
    before: str
    text: str
    after: str


def extract_selection(content: str, start: int, end: int) -> Optional[Selection]:
    """
    Slices a highlighted passage (character offsets into `content`) plus some
    surrounding context. Returns None if the range is empty, out of bounds,
    or covers only whitespace.
    """
    if start < 0 or end > len(content) or start >= end or not content[start:end].strip():
        return None
    return Selection(
        before=content[max(0, start - SELECTION_CONTEXT_CHARS):start],
        text=content[start:end],
        after=content[end:end + SELECTION_CONTEXT_CHARS],
    )


def _note_block(note_text: str, selection: Optional[Selection]) -> str:
    if selection is None:
        return f'The user\'s note:\n"""{note_text}"""'
    return (
        "The user highlighted one passage of their note and wants you to focus on it. Center "
        "everything on the highlighted passage; use the surrounding text only as context, and "
        "don't reflect on the rest of the note.\n\n"
        f'Text before the passage (context only):\n"""{selection.before}"""\n\n'
        f'HIGHLIGHTED PASSAGE:\n"""{selection.text}"""\n\n'
        f'Text after the passage (context only):\n"""{selection.after}"""'
    )


def build_prompt(note_text: str, mode: str, selection: Optional[Selection] = None) -> str:
    """
    Returns a mode-specific prompt in English. The goal is expansion, not
    evaluation: take the user's own reflection further by connecting it to
    other ideas, angles, and questions, rather than grading or auditing it
    like a business plan. Always demands strict JSON output (no markdown).
    If `selection` is given, the prompt is scoped to that highlighted passage.
    """
    note_text = (note_text or "").strip()
    note_block = _note_block(note_text, selection)
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

{note_block}

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

{note_block}

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

{note_block}

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

{note_block}

Output JSON schema:
{{
  "summary": string,
  "insights": [string, ...],
  "actions": [string, ...]
}}
""".strip()


async def _stream_text(
    messages: List[Dict[str, str]],
    instructions: Optional[str] = None,
    temperature: float = 0.2,
) -> AsyncGenerator[Dict, None]:
    """
    Streams a plain-text model response. Emits:
      - {'type':'chunk','delta':'...'}
      - {'type':'done','full_text':'...','error':str|None}
    Primero intenta Responses API streaming; si falla, hace fallback a chat.completions streaming.
    `temperature` only applies to the fallback: OPENAI_MODEL (a reasoning model)
    rejects it with a 400, which used to send every request to the fallback.
    """
    client = _client()
    full = []

    # --------- 1) Responses API streaming (preferido) ---------
    try:
        # Nuevo SDK: streaming con context manager
        extra = {"instructions": instructions} if instructions else {}
        async with client.responses.stream(
            model=OPENAI_MODEL,
            input=messages,
            **extra,
        ) as stream:
            async for event in stream:
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
                        "error": str(err_msg) if err_msg else "openai_response_error",
                    }
                    return

            # Final: recogemos respuesta final (por si se necesita)
            _ = await stream.get_final_response()

        yield {"type": "done", "full_text": "".join(full).strip(), "error": None}
        return

    except Exception as e_responses:
        fallback_reason = f"responses_stream_failed: {type(e_responses).__name__}: {e_responses}"
        if full:
            # Part of the answer already went out; a fallback would append a
            # second, different answer after it.
            yield {"type": "done", "full_text": "".join(full), "error": fallback_reason}
            return
        # Seguimos al fallback

    # --------- 2) Fallback: Chat Completions streaming ---------
    try:
        system = [{"role": "system", "content": instructions}] if instructions else []
        resp = await client.chat.completions.create(
            model=OPENAI_CHAT_FALLBACK,
            messages=system + messages,
            temperature=temperature,
            stream=True,
            timeout=60,
        )
        async for ev in resp:
            if not ev.choices:
                continue
            delta = getattr(ev.choices[0].delta, "content", None)
            if delta:
                full.append(delta)
                yield {"type": "chunk", "delta": delta}

        yield {"type": "done", "full_text": "".join(full).strip(), "error": None}
    except Exception as e_chat:
        # Ambos métodos fallaron
        yield {
            "type": "done",
            "full_text": "",
            "error": f"{fallback_reason}; chat_fallback_failed: {type(e_chat).__name__}: {e_chat}",
        }


async def stream_reflection(
    note_text: str, mode: str, selection: Optional[Selection] = None
) -> AsyncGenerator[Dict, None]:
    """
    Emite eventos para SSE:
      - {'type':'chunk','delta':'...'}
      - {'type':'done','full_text':'...','parsed':{...}|None,'error':str|None}
    """
    prompt = build_prompt(note_text, mode, selection)
    async for ev in _stream_text([{"role": "user", "content": prompt}]):
        if ev["type"] != "done":
            yield ev
            continue
        parsed, error = None, ev["error"]
        if not error:
            try:
                parsed = json.loads(ev["full_text"])
            except Exception:
                error = "invalid_json"
        yield {**ev, "parsed": parsed, "error": error}


def build_chat_instructions(note_title: str, note_text: str) -> str:
    title_line = f'Title: "{note_title.strip()}"\n' if (note_title or "").strip() else ""
    return f"""
You are a thoughtful journaling companion inside a note-taking app. The user is chatting with
you about one specific note of theirs, shown below. Keep the conversation anchored to that
note: help them think it through, ask a good question back when it's useful, and offer
connections or perspectives they may not have considered. Don't lecture, diagnose, or give
generic self-help advice. Be concise (usually 2-5 sentences), warm but direct. Plain text only,
no markdown headings, bold, or tables. Don't invent personal facts about the user. When the user
quotes a passage of the note, focus your answer on that passage. Respond in English.

The note (it may have been edited since earlier messages in this chat):
{title_line}\"\"\"{(note_text or "").strip()}\"\"\"
""".strip()


def format_chat_message(content: str, quote: Optional[str]) -> str:
    """How a stored user message, plus the passage it quotes if any, is shown to the model."""
    if not quote:
        return content
    return f'About this passage of my note:\n"""{quote}"""\n\n{content}'


async def stream_chat_reply(
    note_title: str, note_text: str, history: List[Dict[str, str]]
) -> AsyncGenerator[Dict, None]:
    """
    `history` is the thread so far, oldest first, as [{'role': 'user'|'assistant', 'content': ...}],
    ending with the user message to answer. Emits the same events as `_stream_text`.
    """
    async for ev in _stream_text(
        history[-CHAT_HISTORY_LIMIT:],
        instructions=build_chat_instructions(note_title, note_text),
        temperature=0.6,
    ):
        yield ev
