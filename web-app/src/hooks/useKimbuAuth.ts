import { useState, useCallback, useRef } from "react";

const KIMBU_URL   = import.meta.env.VITE_KIMBU_URL ?? "https://api.kimbu.cslade.space/v1/auth";
const KIMBU_APP   = import.meta.env.VITE_KIMBU_APP_ID ?? "versa";
const TOKEN_KEY   = "kimbu.access_token";
const REFRESH_KEY = "kimbu.refresh_token";

export interface KimbuSession {
  token:    string | null;
  loading:  boolean;
  error:    string | null;
  login:    (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  refresh:  () => Promise<string | null>;
  logout:   () => void;
}

interface AuthTokens { accessToken: string; refreshToken?: string; }
interface KimbuResponse { tokens: AuthTokens; }

function extractTokens(body: KimbuResponse): AuthTokens {
  return body.tokens ?? (body as unknown as AuthTokens);
}

async function apiLogin(email: string, password: string) {
  const res = await fetch(`${KIMBU_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Id": KIMBU_APP },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return extractTokens(await res.json());
}

async function apiRegister(email: string, password: string) {
  const res = await fetch(`${KIMBU_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Id": KIMBU_APP },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.status);
    throw new Error(String(msg));
  }
  return extractTokens(await res.json());
}

async function apiRefresh(refreshToken: string) {
  const res = await fetch(`${KIMBU_URL}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return extractTokens(await res.json());
}

export function useKimbuAuth(): KimbuSession {
  const [token,   setToken]   = useState<string | null>(() => {
    // On mount, try to silently refresh if a refresh token exists.
    return localStorage.getItem(TOKEN_KEY);
  });
  const [loading, setLoading] = useState(() => {
    // If we have a refresh token but no access token, we'll refresh on mount.
    return !localStorage.getItem(TOKEN_KEY) && !!localStorage.getItem(REFRESH_KEY);
  });
  const [error,   setError]   = useState<string | null>(null);
  const inflightRef = useRef<Promise<string | null> | null>(null);

  // Silently refresh on mount if we have a stored refresh token but no access token.
  useState(() => {
    const rt = localStorage.getItem(REFRESH_KEY);
    const at = localStorage.getItem(TOKEN_KEY);
    if (rt && !at) {
      refresh();
    }
  });

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiLogin(email, password);
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
      setToken(data.accessToken);
      return true;
    } catch (e) {
      setError(e instanceof Error ? `Sign in failed (${e.message})` : "Sign in failed");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<string | null> => {
    if (inflightRef.current) return inflightRef.current;

    const rt = localStorage.getItem(REFRESH_KEY);
    if (!rt) return null;

    const p = (async () => {
      try {
        setLoading(true);
        const data = await apiRefresh(rt);
        localStorage.setItem(TOKEN_KEY, data.accessToken);
        if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
        setToken(data.accessToken);
        return data.accessToken;
      } catch {
        // Refresh token is dead — force re-login.
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        setToken(null);
        return null;
      } finally {
        setLoading(false);
        inflightRef.current = null;
      }
    })();

    inflightRef.current = p;
    return p;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
  }, []);

  const register = useCallback(async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRegister(email, password);
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
      setToken(data.accessToken);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { token, loading, error, login, register, refresh, logout };
}
