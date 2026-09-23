// Parses JSON that may be cut off mid-stream (e.g. a reflection still being
// generated) into as much of the value as has arrived so far:
//   '{"questions": ["What if'  ->  { questions: ["What if"] }
// Unfinished strings are kept as-is so text grows in place; an object key only
// appears once the key itself is complete. Returns undefined if no value has
// started yet. Anything malformed (not just truncated) also yields whatever
// parsed before it.
export function parsePartialJson(text: string): unknown {
  let i = 0;

  function skipWhitespace() {
    while (i < text.length && /\s/.test(text[i])) i++;
  }

  // Returns the string's contents and whether its closing quote arrived.
  function parseString(): { value: string; complete: boolean } {
    i++; // opening quote
    let value = "";
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return { value, complete: true };
      }
      if (ch === "\\") {
        const next = text[i + 1];
        if (next === undefined) break; // escape cut off
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4) break; // \u escape cut off
          value += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
        value += escapes[next] ?? next;
        i += 2;
        continue;
      }
      value += ch;
      i++;
    }
    i = text.length;
    return { value, complete: false };
  }

  function parseLiteral(): unknown {
    const match = /^[-+0-9.eE]+|^[a-z]+/.exec(text.slice(i));
    if (!match) {
      i = text.length; // malformed: stop here
      return undefined;
    }
    i += match[0].length;
    const token = match[0];
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    const n = Number(token);
    return Number.isNaN(n) ? undefined : n; // e.g. "tr" or "1e" cut off
  }

  function parseValue(): unknown {
    skipWhitespace();
    if (i >= text.length) return undefined;
    const ch = text[i];
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"') return parseString().value;
    return parseLiteral();
  }

  function parseObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    i++; // {
    while (true) {
      skipWhitespace();
      if (i >= text.length) return obj;
      if (text[i] === "}") {
        i++;
        return obj;
      }
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] !== '"') {
        i = text.length; // malformed: stop here
        return obj;
      }
      const key = parseString();
      if (!key.complete) return obj;
      skipWhitespace();
      if (text[i] !== ":") return obj;
      i++;
      const value = parseValue();
      if (value !== undefined) obj[key.value] = value;
    }
  }

  function parseArray(): unknown[] {
    const arr: unknown[] = [];
    i++; // [
    while (true) {
      skipWhitespace();
      if (i >= text.length) return arr;
      if (text[i] === "]") {
        i++;
        return arr;
      }
      if (text[i] === ",") {
        i++;
        continue;
      }
      const value = parseValue();
      if (value !== undefined) arr.push(value);
    }
  }

  // Skip anything before the JSON itself (e.g. a stray ```json fence).
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
  i = start;
  return parseValue();
}
