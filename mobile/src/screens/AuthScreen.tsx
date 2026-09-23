import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { colors, font, radius, spacing } from "../theme";

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.content, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.logo}>
          <Ionicons name="sparkles" size={26} color={colors.accent} />
        </View>
        <Text style={styles.title}>Journal</Text>
        <Text style={styles.subtitle}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </Text>

        <View style={styles.field}>
          <Ionicons name="mail-outline" size={18} color={colors.textFaint} style={styles.fieldIcon} />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View style={styles.field}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} style={styles.fieldIcon} />
          <TextInput
            style={[styles.input, styles.inputWithTrailingIcon]}
            placeholder="Password"
            placeholderTextColor={colors.placeholder}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={10}>
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={colors.textFaint}
            />
          </Pressable>
        </View>

        {!!error && (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        )}

        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{mode === "login" ? "Log in" : "Sign up"}</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.switchButton}
          onPress={() => setMode(mode === "login" ? "register" : "login")}
          hitSlop={8}
        >
          <Text style={styles.switchText}>
            {mode === "login" ? "No account? Sign up" : "Have an account? Log in"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { color: colors.text, fontSize: font.xl, fontWeight: "700", marginBottom: 4 },
  subtitle: { color: colors.textMuted, fontSize: font.md, marginBottom: spacing.xl },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  fieldIcon: { marginRight: spacing.sm },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: colors.text,
    fontSize: font.base,
  },
  inputWithTrailingIcon: { marginRight: spacing.sm },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md },
  error: { color: colors.danger, fontSize: font.sm, flexShrink: 1 },
  button: {
    backgroundColor: colors.accentStrong,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: font.base },
  switchButton: { marginTop: spacing.xl, alignItems: "center" },
  switchText: { color: colors.textMuted, fontSize: font.sm },
});
