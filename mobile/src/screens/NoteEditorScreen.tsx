import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as api from "../api/client";
import type { ReflectMode, SelectionRange } from "../api/client";
import NoteChat from "../components/NoteChat";
import type { RootStackParamList } from "../navigation/types";
import { colors, font, radius, spacing } from "../theme";
import { parsePartialJson } from "../utils/partialJson";

type Props = NativeStackScreenProps<RootStackParamList, "NoteEditor">;

const MODES: { key: ReflectMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "estructurado", label: "Structured", icon: "grid-outline" },
  { key: "socratico", label: "Socratic", icon: "help-circle-outline" },
  { key: "semanal", label: "Weekly", icon: "calendar-outline" },
];

const AUTOSAVE_DELAY_MS = 800;

type Panel = "reflect" | "chat";

export default function NoteEditorScreen({ route, navigation }: Props) {
  const { noteId, defaultFolderId = null } = route.params;
  const insets = useSafeAreaInsets();
  const [id, setId] = useState<number | undefined>(noteId);
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(!!noteId);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [reflectMode, setReflectMode] = useState<ReflectMode>("estructurado");
  // The highlighted passage the reflection currently shown was scoped to, if any
  const [reflectFocus, setReflectFocus] = useState<string | null>(null);
  // Non-empty text selection in the note body (UTF-16 offsets into `content`)
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [reflectBusy, setReflectBusy] = useState(false);
  const [reflectStreamText, setReflectStreamText] = useState("");
  const [reflection, setReflection] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const [folders, setFolders] = useState<api.Folder[]>([]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reflectAbort = useRef<AbortController | null>(null);
  const creatingNote = useRef<Promise<number> | null>(null);
  // Refs mirroring state, so flushSave() can see the latest values without
  // waiting for a re-render.
  const idRef = useRef<number | undefined>(noteId);
  const latest = useRef({ title: "", content: "" });
  const pendingSave = useRef<Promise<void> | null>(null);

  useEffect(() => () => reflectAbort.current?.abort(), []);

  useEffect(() => {
    api.listFolders().then(setFolders).catch(() => {});
  }, []);

  useEffect(() => {
    if (!noteId) return;
    (async () => {
      try {
        const note = await api.getNote(noteId);
        setTitle(note.title);
        setContent(note.content);
        latest.current = { title: note.title, content: note.content };
        setFolderId(note.folder_id);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [noteId]);

  const persist = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (!nextContent.trim() && !nextTitle.trim()) return;
      setSaving(true);
      try {
        let noteId = id;
        if (!noteId) {
          // If a create is already in flight (e.g. the user kept typing
          // through a slow request and another debounced save fired before
          // `id` state updated), reuse that same request instead of firing
          // a second createNote — otherwise this note gets created twice.
          if (!creatingNote.current) {
            creatingNote.current = api
              .createNote({ title: nextTitle, content: nextContent, folder_id: folderId })
              .then((created) => {
                idRef.current = created.id;
                setId(created.id);
                return created.id;
              });
          }
          noteId = await creatingNote.current;
          creatingNote.current = null;
          // Make sure this call's (possibly newer) text actually gets saved,
          // in case it wasn't the call that won the create race above.
          await api.updateNote(noteId, { title: nextTitle, content: nextContent });
        } else {
          await api.updateNote(noteId, { title: nextTitle, content: nextContent });
        }
        setError("");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    },
    [id, folderId]
  );

  function scheduleSave(nextTitle: string, nextContent: string) {
    latest.current = { title: nextTitle, content: nextContent };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      pendingSave.current = persist(nextTitle, nextContent);
    }, AUTOSAVE_DELAY_MS);
  }

  // Saves any not-yet-saved edits right now and waits for in-flight saves, so
  // AI calls (which read the note server-side) see exactly what's on screen —
  // selection offsets in particular must match the saved text. Returns the
  // note id, or undefined if the note is still empty/unsaved.
  async function flushSave(): Promise<number | undefined> {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingSave.current = persist(latest.current.title, latest.current.content);
    }
    await pendingSave.current;
    if (creatingNote.current) await creatingNote.current.catch(() => {});
    return idRef.current;
  }

  function onTitleChange(v: string) {
    setTitle(v);
    scheduleSave(v, content);
  }

  function onContentChange(v: string) {
    setContent(v);
    scheduleSave(title, v);
  }

  const selectedText = selection ? content.slice(selection.start, selection.end) : null;

  async function runReflection(mode: ReflectMode) {
    // Capture the selection before awaiting — it's relative to the text as
    // it is right now, which is also what flushSave() persists.
    const focusText = selectedText?.trim() ? selectedText : null;
    const focusRange = focusText && selection ? api.toCodePointRange(content, selection.start, selection.end) : null;
    const id = await flushSave();
    if (!id) {
      Alert.alert("Save first", "Write something before asking for a reflection.");
      return;
    }
    reflectAbort.current?.abort();
    const controller = new AbortController();
    reflectAbort.current = controller;

    setReflectMode(mode);
    setReflectFocus(focusText);
    setPanel("reflect");
    setReflectBusy(true);
    setReflection(null);
    setReflectStreamText("");
    setError("");

    let gotAnyData = false;

    await api.streamReflect(
      id,
      mode,
      {
        onChunk: (delta) => {
          gotAnyData = true;
          setReflectStreamText((prev) => prev + delta);
        },
        onDone: ({ parsed, error: streamError }) => {
          setReflectBusy(false);
          if (parsed) setReflection(parsed);
          else if (streamError) setError(`AI reflection failed: ${streamError}`);
        },
        onError: async (e) => {
          // Streaming can fail on networks that buffer/kill long-lived
          // connections (proxies, campus wifi) even though the backend is
          // fine. If we never got any data, silently retry with the plain
          // request/response endpoint instead of leaving the user stuck.
          if (gotAnyData) {
            setReflectBusy(false);
            setError(e.message);
            return;
          }
          try {
            const result = await api.reflectNote(id, mode, focusRange);
            setReflection(result.result_json);
          } catch (fallbackErr: any) {
            setError(fallbackErr.message);
          } finally {
            setReflectBusy(false);
          }
        },
      },
      { signal: controller.signal, selection: focusRange }
    );
  }

  function toggleChat() {
    setPanel((prev) => (prev === "chat" ? null : "chat"));
  }

  async function chooseFolder() {
    const options = [
      { text: "None", onPress: () => applyFolder(null) },
      ...folders.map((f) => ({ text: f.name, onPress: () => applyFolder(f.id) })),
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert("Move to folder", undefined, options);
  }

  async function applyFolder(nextFolderId: number | null) {
    setFolderId(nextFolderId);
    if (id) {
      try {
        await api.moveNote(id, nextFolderId);
      } catch (e: any) {
        setError(e.message);
      }
    }
  }

  function confirmDelete() {
    if (!id) {
      navigation.goBack();
      return;
    }
    Alert.alert("Delete note?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.deleteNote(id);
          navigation.goBack();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentStrong} />
      </View>
    );
  }

  const activeFolderName = folderId != null ? folders.find((f) => f.id === folderId)?.name : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.iconButton} onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>

        <Pressable style={styles.folderButton} onPress={chooseFolder}>
          <Ionicons
            name={activeFolderName ? "folder" : "folder-outline"}
            size={14}
            color={activeFolderName ? colors.accent : colors.textFaint}
          />
          <Text style={styles.folderButtonText} numberOfLines={1}>
            {activeFolderName || "No folder"}
          </Text>
        </Pressable>

        <View style={styles.topBarRight}>
          {saving && <ActivityIndicator size="small" color={colors.textFaint} style={{ marginRight: spacing.sm }} />}
          <Pressable style={styles.iconButton} onPress={confirmDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={19} color={colors.danger} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          placeholder="Title"
          placeholderTextColor={colors.placeholder}
          value={title}
          onChangeText={onTitleChange}
        />
        <TextInput
          style={styles.contentInput}
          placeholder="Write freely…"
          placeholderTextColor={colors.placeholder}
          value={content}
          onChangeText={onContentChange}
          onSelectionChange={(e) => {
            const { start, end } = e.nativeEvent.selection;
            setSelection(end > start ? { start, end } : null);
          }}
          multiline
          textAlignVertical="top"
        />
      </ScrollView>

      {!!error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      {!!selectedText?.trim() && (
        <View style={styles.focusBar}>
          <Ionicons name="text-outline" size={14} color={colors.accent} />
          <Text style={styles.focusText} numberOfLines={1}>
            “{selectedText.trim()}”
          </Text>
          <Pressable style={styles.focusAsk} onPress={() => setPanel("chat")} hitSlop={6}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.accent} />
            <Text style={styles.focusAskText}>Ask AI</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.reflectBar}>
        {MODES.map((m) => {
          const active = panel === "reflect" && reflectMode === m.key;
          return (
            <Pressable
              key={m.key}
              style={[styles.modeChip, active && styles.modeChipActive]}
              onPress={() => runReflection(m.key)}
            >
              <Ionicons name={m.icon} size={14} color={active ? colors.accent : colors.textMuted} />
              <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.modeChip, panel === "chat" && styles.modeChipActive]}
          onPress={toggleChat}
        >
          <Ionicons
            name="chatbubbles-outline"
            size={14}
            color={panel === "chat" ? colors.accent : colors.textMuted}
          />
        </Pressable>
        {panel && (
          <Pressable style={styles.closeReflectButton} onPress={() => setPanel(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {panel === "chat" && (
        <NoteChat
          noteId={id}
          ensureSaved={flushSave}
          quote={selectedText?.trim() || null}
          onClearQuote={() => setSelection(null)}
          bottomInset={insets.bottom}
        />
      )}

      {panel === "reflect" && (
        <View style={[styles.reflectPanel, { paddingBottom: insets.bottom + spacing.md }]}>
          {!!reflectFocus && (
            <Text style={styles.reflectFocus} numberOfLines={2}>
              On “{reflectFocus.trim()}”
            </Text>
          )}
          {reflectBusy ? (
            <ScrollView style={styles.reflectScroll}>
              {/* The model streams JSON; render what's parsed so far with the
                  same layout as the finished reflection, so it grows in place. */}
              <ReflectionSections value={parsePartialJson(reflectStreamText)} />
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.thinkingLabel}>Reflecting…</Text>
              </View>
            </ScrollView>
          ) : reflection ? (
            <ScrollView style={styles.reflectScroll}>
              <ReflectionSections value={reflection} />
            </ScrollView>
          ) : (
            <Text style={styles.reflectValue}>No reflection yet.</Text>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function ReflectionSections({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (
    <>
      {Object.entries(value).map(([key, v]) => (
        <View key={key} style={styles.reflectSection}>
          <Text style={styles.reflectKey}>{key.replace(/_/g, " ")}</Text>
          <Text style={styles.reflectValue}>
            {Array.isArray(v)
              ? v.map((item) => `•  ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n")
              : typeof v === "object"
              ? JSON.stringify(v, null, 2)
              : String(v)}
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: 4 },
  topBarRight: { flexDirection: "row", alignItems: "center" },
  folderButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    maxWidth: 170,
  },
  folderButtonText: { color: colors.textMuted, fontSize: font.xs, fontWeight: "500" },
  editorScroll: { flex: 1, paddingHorizontal: spacing.xl },
  titleInput: { color: colors.text, fontSize: font.lg, fontWeight: "700", paddingVertical: spacing.sm },
  contentInput: { color: "#e4e4e7", fontSize: font.md, lineHeight: 24, minHeight: 200, paddingTop: spacing.xs },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.xl, paddingBottom: spacing.xs },
  error: { color: colors.danger, fontSize: font.sm, flexShrink: 1 },
  reflectBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  modeChipActive: { backgroundColor: colors.accentSoft },
  modeChipText: { color: colors.textMuted, fontSize: font.sm, fontWeight: "500" },
  modeChipTextActive: { color: colors.accent },
  closeReflectButton: { marginLeft: "auto", padding: 4 },
  focusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  focusText: { color: colors.textMuted, fontSize: font.sm, fontStyle: "italic", flex: 1 },
  focusAsk: { flexDirection: "row", alignItems: "center", gap: 4 },
  focusAskText: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },
  reflectFocus: { color: colors.textMuted, fontSize: font.sm, fontStyle: "italic", marginBottom: spacing.sm },
  reflectPanel: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    maxHeight: 320,
  },
  reflectScroll: { maxHeight: 260 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  thinkingLabel: { color: colors.accent, fontSize: font.sm, fontWeight: "500" },
  reflectSection: { marginBottom: spacing.md },
  reflectKey: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  reflectValue: { color: "#e4e4e7", fontSize: font.base, lineHeight: 21 },
});
