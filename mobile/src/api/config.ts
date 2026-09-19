import Constants from "expo-constants";

// In dev, Expo knows the LAN IP/port it's being served from (hostUri, e.g.
// "192.168.1.23:8081"). We reuse that host but point at the backend's port,
// so a phone on Expo Go can reach your machine without hardcoding an IP.
function inferDevApiBase(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ?? (Constants as any).manifest2?.extra?.expoClient?.hostUri;
  if (!hostUri) return null;
  const host = hostUri.split(":")[0];
  return `http://${host}:8000`;
}

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE || inferDevApiBase() || "http://127.0.0.1:8000";
