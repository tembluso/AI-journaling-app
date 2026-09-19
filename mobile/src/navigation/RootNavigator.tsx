import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import AuthScreen from "../screens/AuthScreen";
import NoteEditorScreen from "../screens/NoteEditorScreen";
import NotesListScreen from "../screens/NotesListScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: "#09090b" },
};

export default function RootNavigator() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#09090b", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={theme}>
      {user ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="NotesList" component={NotesListScreen} />
          <Stack.Screen name="NoteEditor" component={NoteEditorScreen} />
        </Stack.Navigator>
      ) : (
        <AuthScreen />
      )}
    </NavigationContainer>
  );
}
