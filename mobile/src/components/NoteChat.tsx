import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as api from "../api/client";
import type { ChatMessage } from "../api/client";
import { colors, font, radius, spacing } from "../theme";

type Props = {
  noteId: number | undefined;
  // Flushes any pending autosave (so the AI sees the latest text) and returns
  // the note's id, or undefined if there's nothing saved yet.
  ensureSaved: () => Promise<number | undefined>;
  // Highlighted passage of the note to attach to the next message, if any.
  quote: string | null;
  onClearQuote: () => void;
  bottomInset: number;
};

export default function NoteChat({ noteId, ensureSaved, quote, onClearQuote, bottomInset }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(!!noteId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!noteId) return;
    api
      .listChat(noteId)
      .then(setMessages)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
    // Only on mount: a note created while the panel is open has no thread yet.
  }, []);

  const awaitingReply = !busy && messages.length > 0 && messages[messages.length - 1].role === "user";

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const id = await ensureSaved();
    if (!id) {
      Alert.alert("Save first", "Write something before chatting about this note.");
      return;
    }
    setBusy(true);
    setError("");
    setDraft("");
    try {
      const msg = await api.sendChatMessage(id, text, quote);
      setMessages((prev) => [...prev, msg]);
      onClearQuote();
    } catch (e: any) {
      setDraft(text);
      setError(e.message);
      setBusy(false);
      return;
    }
    await fetchReply(id);
  }

  async function fetchReply(id: number) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setStreamText("");
    let gotAnyData = false;

    await api.streamChatReply(
      id,
      {
        onChunk: (delta) => {
          gotAnyData = true;
          setStreamText((prev) => prev + delta);
        },
        onDone: ({ message, error: replyError }) => {
          if (message) setMessages((prev) => [...prev, message]);
          else setError(`AI reply failed: ${replyError}`);
          setStreamText("");
          setBusy(false);
        },
        onError: async (e) => {
          // Same resilience as reflections: if the stream never delivered
          // anything (network killed the connection), retry non-streaming.
          if (gotAnyData) {
            setStreamText("");
            setBusy(false);
            setError(e.message);
            return;
          }
          try {
            const reply = await api.chatReply(id);
            setMessages((prev) => [...prev, reply]);
          } catch (fallbackErr: any) {
            if (fallbackErr instanceof api.ApiError && fallbackErr.status === 409) {
              // The streamed reply was saved server-side after all.
              setMessages(await api.listChat(id).catch(() => messages));
            } else {
              setError(fallbackErr.message);
            }
          } finally {
            setStreamText("");
            setBusy(false);
          }
        },
      },
      controller.signal
    );
  }

  function confirmClear() {
    if (!noteId || messages.length === 0) return;
    Alert.alert("Clear chat?", "This deletes the whole conversation for this note.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          abort.current?.abort();
          try {
            await api.clearChat(noteId);
            setMessages([]);
            setStreamText("");
            setBusy(false);
            setError("");
          } catch (e: any) {
            setError(e.message);
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.panel, { paddingBottom: bottomInset + spacing.sm }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : messages.length === 0 && !busy ? (
          <Text style={styles.empty}>
            Ask anything about this note. Highlight part of it first to ask about just that passage.
          </Text>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        {busy && (
          <View style={[styles.bubble, styles.assistantBubble]}>
            {streamText ? (
              <Text style={styles.bubbleText}>{streamText}</Text>
            ) : (
              <ActivityIndicator size="small" color={colors.accent} />
            )}
          </View>
        )}
        {awaitingReply && (
          <Pressable style={styles.retryButton} onPress={() => noteId && fetchReply(noteId)}>
            <Ionicons name="refresh" size={14} color={colors.accent} />
            <Text style={styles.retryText}>Get reply</Text>
          </Pressable>
        )}
      </ScrollView>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {!!quote && (
        <View style={styles.quoteChip}>
          <Ionicons name="text-outline" size={13} color={colors.accent} />
          <Text style={styles.quoteChipText} numberOfLines={1}>
            {quote}
          </Text>
          <Pressable onPress={onClearQuote} hitSlop={8}>
            <Ionicons name="close" size={14} color={colors.textFaint} />
          </Pressable>
        </View>
      )}

      <View style={styles.composer}>
        {messages.length > 0 && (
          <Pressable style={styles.composerIcon} onPress={confirmClear} hitSlop={6}>
            <Ionicons name="trash-outline" size={17} color={colors.textFaint} />
          </Pressable>
        )}
        <TextInput
          style={styles.input}
          placeholder={quote ? "Ask about this passage…" : "Ask about this note…"}
          placeholderTextColor={colors.placeholder}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={4000}
        />
        <Pressable
          style={[styles.sendButton, (!draft.trim() || busy) && styles.sendButtonDisabled]}
          onPress={send}
          disabled={!draft.trim() || busy}
        >
          <Ionicons name="arrow-up" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      {!!message.quote && (
        <Text style={styles.bubbleQuote} numberOfLines={3}>
          “{message.quote}”
        </Text>
      )}
      <Text style={styles.bubbleText}>{message.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  thread: { maxHeight: 280 },
  threadContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  empty: { color: colors.textMuted, fontSize: font.sm, lineHeight: 19, paddingVertical: spacing.sm },
  bubble: { maxWidth: "88%", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.accentSoft },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: colors.surfaceRaised },
  bubbleText: { color: colors.text, fontSize: font.base, lineHeight: 21 },
  bubbleQuote: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontStyle: "italic",
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.sm,
    marginBottom: spacing.xs,
  },
  retryButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", padding: spacing.xs },
  retryText: { color: colors.accent, fontSize: font.sm, fontWeight: "500" },
  error: { color: colors.danger, fontSize: font.sm, paddingBottom: spacing.xs },
  quoteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.xs,
  },
  quoteChipText: { color: colors.textMuted, fontSize: font.sm, fontStyle: "italic", flex: 1 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  composerIcon: { paddingBottom: 9 },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.base,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    maxHeight: 110,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { opacity: 0.35 },
});
