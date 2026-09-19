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
import * as api from "../api/client";
import type { ReflectMode } from "../api/client";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "NoteEditor">;

const MODES: { key: ReflectMode; label: string }[] = [
  { key: "estructurado", label: "Structured" },
  { key: "socratico", label: "Socratic" },
  { key: "semanal", label: "Weekly" },
];

const AUTOSAVE_DELAY_MS = 800;

export default function NoteEditorScreen({ route, navigation }: Props) {
  const { noteId } = route.params;
  const [id, setId] = useState<number | undefined>(noteId);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(!!noteId);
  const [saving, setSaving] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflectMode, setReflectMode] = useState<ReflectMode>("estructurado");
  const [reflectBusy, setReflectBusy] = useState(false);
  const [reflection, setReflection] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!noteId) return;
    (async () => {
      try {
        const note = await api.getNote(noteId);
        setTitle(note.title);
        setContent(note.content);
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
        if (id) {
          await api.updateNote(id, { title: nextTitle, content: nextContent });
        } else {
          const created = await api.createNote({ title: nextTitle, content: nextContent });
          setId(created.id);
        }
        setError("");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    },
    [id]
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
    setReflectMode(mode);
    setReflectBusy(true);
    setReflection(null);
    try {
      const result = await api.reflectNote(id, mode);
      setReflection(result.result_json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReflectBusy(false);
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
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.topBarAction}>Back</Text>
        </Pressable>
        <Text style={styles.savingLabel}>{saving ? "Saving…" : " "}</Text>
        <Pressable onPress={confirmDelete}>
          <Text style={[styles.topBarAction, styles.deleteAction]}>Delete</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          placeholder="Title"
          placeholderTextColor="#52525b"
          value={title}
          onChangeText={onTitleChange}
        />
        <TextInput
          style={styles.contentInput}
          placeholder="Write freely…"
          placeholderTextColor="#52525b"
          value={content}
          onChangeText={onContentChange}
          multiline
          textAlignVertical="top"
        />
      </ScrollView>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.reflectBar}>
        {MODES.map((m) => (
          <Pressable
            key={m.key}
            style={[styles.modeChip, reflectMode === m.key && reflectOpen && styles.modeChipActive]}
            onPress={() => {
              setReflectOpen(true);
              runReflection(m.key);
            }}
          >
            <Text style={styles.modeChipText}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {reflectOpen && (
        <View style={styles.reflectPanel}>
          {reflectBusy ? (
            <ActivityIndicator color="#6366f1" />
          ) : reflection ? (
            <ScrollView style={{ maxHeight: 220 }}>
              {Object.entries(reflection).map(([key, value]) => (
                <View key={key} style={styles.reflectSection}>
                  <Text style={styles.reflectKey}>{key.replace(/_/g, " ")}</Text>
                  <Text style={styles.reflectValue}>
                    {Array.isArray(value)
                      ? value.map((v) => `• ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")
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
  container: { flex: 1, backgroundColor: "#09090b" },
  center: { flex: 1, backgroundColor: "#09090b", alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 8,
  },
  topBarAction: { color: "#a1a1aa", fontSize: 15 },
  deleteAction: { color: "#f87171" },
  savingLabel: { color: "#52525b", fontSize: 12 },
  editorScroll: { flex: 1, paddingHorizontal: 20 },
  titleInput: { color: "#fafafa", fontSize: 22, fontWeight: "700", paddingVertical: 8 },
  contentInput: { color: "#e4e4e7", fontSize: 16, lineHeight: 24, minHeight: 200, paddingTop: 8 },
  error: { color: "#f87171", paddingHorizontal: 20, paddingBottom: 4 },
  reflectBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#18181b",
  },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#18181b",
  },
  modeChipActive: { backgroundColor: "#312e81" },
  modeChipText: { color: "#e4e4e7", fontSize: 13, fontWeight: "500" },
  reflectPanel: {
    backgroundColor: "#111113",
    borderTopWidth: 1,
    borderTopColor: "#18181b",
    padding: 16,
    maxHeight: 260,
  },
  reflectSection: { marginBottom: 12 },
  reflectKey: { color: "#818cf8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
  reflectValue: { color: "#e4e4e7", fontSize: 14, lineHeight: 20 },
});
