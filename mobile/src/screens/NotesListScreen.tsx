import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as api from "../api/client";
import type { Note } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "NotesList">;

export default function NotesListScreen({ navigation }: Props) {
  const { signOut, user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setNotes(await api.listNotes());
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Your Notes</Text>
          <Text style={styles.subtitle}>{user?.email}</Text>
        </View>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Log out</Text>
        </Pressable>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={notes}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No notes yet — write your first one.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate("NoteEditor", { noteId: item.id })}
          >
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title || "Untitled"}
            </Text>
            <Text style={styles.cardPreview} numberOfLines={2}>
              {item.content}
            </Text>
          </Pressable>
        )}
      />

      <Pressable
        style={styles.fab}
        onPress={() => navigation.navigate("NoteEditor", { noteId: undefined })}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  title: { color: "#fafafa", fontSize: 26, fontWeight: "700" },
  subtitle: { color: "#71717a", fontSize: 13, marginTop: 2 },
  signOut: { color: "#a1a1aa", fontSize: 14 },
  error: { color: "#f87171", paddingHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  empty: { color: "#71717a", textAlign: "center", marginTop: 60, fontSize: 15 },
  card: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardTitle: { color: "#fafafa", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  cardPreview: { color: "#a1a1aa", fontSize: 14 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 36,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: "#fff", fontSize: 28, lineHeight: 30 },
});
