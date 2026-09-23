import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as api from "../api/client";
import type { Folder, Note } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { RootStackParamList } from "../navigation/types";
import { colors, font, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NotesList">;

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export default function NotesListScreen({ navigation }: Props) {
  const { signOut, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState("");
  const submittingFolder = useRef(false);

  const load = useCallback(async () => {
    try {
      const [notesData, foldersData] = await Promise.all([api.listNotes(), api.listFolders()]);
      setNotes(notesData);
      setFolders(foldersData);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const visibleNotes = selectedFolderId == null ? notes : notes.filter((n) => n.folder_id === selectedFolderId);

  async function submitNewFolder() {
    if (submittingFolder.current) return;
    const name = newFolderName.trim();
    if (!name) {
      setAddingFolder(false);
      return;
    }
    submittingFolder.current = true;
    try {
      const folder = await api.createFolder(name);
      setFolders((prev) => [...prev, folder]);
      setSelectedFolderId(folder.id);
      setNewFolderName("");
      setAddingFolder(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      submittingFolder.current = false;
    }
  }

  function confirmDeleteFolder(folder: Folder) {
    Alert.alert(`Delete "${folder.name}"?`, "Notes inside will become unfiled, not deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.deleteFolder(folder.id);
          if (selectedFolderId === folder.id) setSelectedFolderId(null);
          load();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View>
          <Text style={styles.title}>Journal</Text>
          <Text style={styles.subtitle}>{user?.email}</Text>
        </View>
        <Pressable style={styles.iconButton} onPress={signOut} hitSlop={8}>
          <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {!!error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.folderBar}
        contentContainerStyle={styles.folderBarContent}
        data={folders}
        keyExtractor={(f) => String(f.id)}
        ListHeaderComponent={
          <Pressable
            style={[styles.folderChip, selectedFolderId == null && styles.folderChipActive]}
            onPress={() => setSelectedFolderId(null)}
          >
            <Text style={[styles.folderChipText, selectedFolderId == null && styles.folderChipTextActive]}>
              All
            </Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.folderChip, selectedFolderId === item.id && styles.folderChipActive]}
            onPress={() => setSelectedFolderId(item.id)}
            onLongPress={() => confirmDeleteFolder(item)}
          >
            <Ionicons
              name="folder-outline"
              size={13}
              color={selectedFolderId === item.id ? colors.accentStrong : colors.textMuted}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.folderChipText, selectedFolderId === item.id && styles.folderChipTextActive]}>
              {item.name}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={
          addingFolder ? (
            <TextInput
              autoFocus
              style={styles.folderInput}
              placeholder="Folder name"
              placeholderTextColor={colors.placeholder}
              value={newFolderName}
              onChangeText={setNewFolderName}
              onSubmitEditing={submitNewFolder}
              onBlur={submitNewFolder}
            />
          ) : (
            <Pressable style={styles.folderChip} onPress={() => setAddingFolder(true)}>
              <Ionicons name="add" size={14} color={colors.textMuted} style={{ marginRight: 3 }} />
              <Text style={styles.folderChipText}>Folder</Text>
            </Pressable>
          )
        }
      />

      <FlatList
        data={visibleNotes}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={28} color={colors.textFaint} />
            <Text style={styles.emptyText}>No notes yet — write your first one.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("NoteEditor", { noteId: item.id })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title || "Untitled"}
              </Text>
              <Text style={styles.cardTime}>{timeAgo(item.updated_at)}</Text>
            </View>
            <Text style={styles.cardPreview} numberOfLines={2}>
              {item.content}
            </Text>
          </Pressable>
        )}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed, { bottom: insets.bottom + spacing.xl }]}
        onPress={() => navigation.navigate("NoteEditor", { noteId: undefined, defaultFolderId: selectedFolderId })}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: font.xl, fontWeight: "700" },
  subtitle: { color: colors.textFaint, fontSize: font.xs, marginTop: 2 },
  iconButton: { padding: 4 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  error: { color: colors.danger, fontSize: font.sm },
  folderBar: { flexGrow: 0, marginBottom: spacing.sm },
  folderBarContent: { paddingHorizontal: spacing.lg, alignItems: "center" },
  folderChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  folderChipActive: { backgroundColor: colors.accentSoft },
  folderChipText: { color: colors.textMuted, fontSize: font.sm, fontWeight: "500" },
  folderChipTextActive: { color: colors.accentStrong },
  folderInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    color: colors.text,
    fontSize: font.sm,
    minWidth: 120,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  empty: { alignItems: "center", marginTop: 80, gap: spacing.sm },
  emptyText: { color: colors.textFaint, fontSize: font.base },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardPressed: { backgroundColor: colors.surfaceRaised },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  cardTitle: { color: colors.text, fontSize: font.base, fontWeight: "600", flexShrink: 1, marginRight: spacing.sm },
  cardTime: { color: colors.textFaint, fontSize: font.xs },
  cardPreview: { color: colors.textMuted, fontSize: font.sm, lineHeight: 19 },
  fab: {
    position: "absolute",
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.9 },
});
