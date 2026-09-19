import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState } from "react";
import * as api from "../api/client";
import { setAuthToken } from "../api/client";

const TOKEN_KEY = "journaling_app_token";

type User = { id: number; email: string };

type AuthContextValue = {
  isLoading: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await SecureStore.getItemAsync(TOKEN_KEY);
      if (stored) {
        setAuthToken(stored);
        try {
          setUser(await api.me());
        } catch {
          // token expired/invalid
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          setAuthToken(null);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  async function applyToken(token: string) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setAuthToken(token);
    setUser(await api.me());
  }

  async function signIn(email: string, password: string) {
    const { access_token } = await api.login(email, password);
    await applyToken(access_token);
  }

  async function signUp(email: string, password: string) {
    const { access_token } = await api.register(email, password);
    await applyToken(access_token);
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ isLoading, user, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
