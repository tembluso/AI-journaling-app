// The backend is deployed on Railway and reachable from anywhere — no need
// to be on the same Wi-Fi as a laptop running it locally anymore. Override
// with EXPO_PUBLIC_API_BASE (e.g. to point at a local `uvicorn` instance
// while developing the backend itself).
const DEPLOYED_API_BASE = "https://journaling-app-backend-production.up.railway.app";

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || DEPLOYED_API_BASE;
