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
import type { ReflectMode } from "../api/client";
import type { RootStackParamList } from "../navigation/types";
import { colors, font, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NoteEditor">;

const MODES: { key: ReflectMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "estructurado", label: "Structured", icon: "grid-outline" },
  { key: "socratico", label: "Socratic", icon: "help-circle-outline" },
  { key: "semanal", label: "Weekly", icon: "calendar-outline" },
];

const AUTOSAVE_DELAY_MS = 800;

export default function NoteEditorScreen({ route, navigation }: Props) {
  const { noteId, defaultFolderId = null } = route.params;
  const insets = useSafeAreaInsets();
  const [id, setId] = useState<number | undefined>(noteId);
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(!!noteId);
  const [saving, setSaving] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflectMode, setReflectMode] = useState<ReflectMode>("estructurado");
  const [reflectBusy, setReflectBusy] = useState(false);
  const [reflectStreamText, setReflectStreamText] = useState("");
  const [reflection, setReflection] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const [folders, setFolders] = useState<api.Folder[]>([]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reflectAbort = useRef<AbortController | null>(null);
  const creatingNote = useRef<Promise<number> | null>(null);

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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(nextTitle, nextContent), AUTOSAVE_DELAY_MS);
  }

  function onTitleChange(v: string) {
    setTitle(v);
    scheduleSave(v, content);
  }

  function onContentChange(v: string) {
    setContent(v);
    scheduleSave(title, v);
  }

  async function runReflection(mode: ReflectMode) {
    if (!id) {
      Alert.alert("Save first", "Write something before asking for a reflection.");
      return;
    }
    reflectAbort.current?.abort();
    const controller = new AbortController();
    reflectAbort.current = controller;

    setReflectMode(mode);
    setReflectOpen(true);
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
            const result = await api.reflectNote(id, mode);
            setReflection(result.result_json);
          } catch (fallbackErr: any) {
            setError(fallbackErr.message);
          } finally {
            setReflectBusy(false);
          }
        },
      },
      controller.signal
    );
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

      <View style={styles.reflectBar}>
        {MODES.map((m) => {
          const active = reflectOpen && reflectMode === m.key;
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
        {reflectOpen && (
          <Pressable style={styles.closeReflectButton} onPress={() => setReflectOpen(false)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {reflectOpen && (
        <View style={[styles.reflectPanel, { paddingBottom: insets.bottom + spacing.md }]}>
          {reflectBusy ? (
            <ScrollView style={styles.reflectScroll}>
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.thinkingLabel}>Reflecting…</Text>
              </View>
              <Text style={styles.reflectValue}>{reflectStreamText}</Text>
            </ScrollView>
          ) : reflection ? (
            <ScrollView style={styles.reflectScroll}>
              {Object.entries(reflection).map(([key, value]) => (
                <View key={key} style={styles.reflectSection}>
                  <Text style={styles.reflectKey}>{key.replace(/_/g, " ")}</Text>
                  <Text style={styles.reflectValue}>
                    {Array.isArray(value)
                      ? value.map((v) => `•  ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")
                      : typeof value === "object"
                      ? JSON.stringify(value, null, 2)
                      : String(value)}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.reflectValue}>No reflection yet.</Text>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
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
