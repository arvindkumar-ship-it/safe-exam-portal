import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authApi } from "../api/authApi";
import { ApiError, setTokenProvider } from "../api/client";
import { AuthContext } from "./useAuth";
import { emitAccessToken } from "./tokenBus";

export { onAccessTokenChange } from "./tokenBus";

const REFRESH_KEY = "safeexam.refreshToken"; // documented risk: HttpOnly cookie later

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(() => !!sessionStorage.getItem(REFRESH_KEY));
  const tokenRef = useRef(null); // access token sirf memory me
  const inflight = useRef(null);

  const apply = useCallback((session) => {
    tokenRef.current = session.accessToken;
    sessionStorage.setItem(REFRESH_KEY, session.refreshToken);
    setAccessToken(session.accessToken);
    setUser(session.user);
    emitAccessToken(session.accessToken);
    return session;
  }, []);

  const clear = useCallback(() => {
    tokenRef.current = null;
    sessionStorage.removeItem(REFRESH_KEY);
    setAccessToken(null);
    setUser(null);
    emitAccessToken(null);
  }, []);

  // ek hi refresh ek time par (single-flight)
  const refreshSession = useCallback(() => {
    if (inflight.current) return inflight.current;
    const rt = sessionStorage.getItem(REFRESH_KEY);
    if (!rt) {
      clear();
      return Promise.reject(new ApiError("UNAUTHENTICATED", "Not signed in", 401));
    }
    inflight.current = authApi
      .refresh(rt)
      .then(apply)
      .catch((e) => {
        clear();
        throw e;
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [apply, clear]);

  // children ke effects se pehle provider register ho jaye
  const registered = useRef(false);
  if (!registered.current) {
    setTokenProvider({ getAccessToken: () => tokenRef.current, refresh: refreshSession });
    registered.current = true;
  }

  useEffect(() => {
    if (!sessionStorage.getItem(REFRESH_KEY)) return;
    refreshSession()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshSession]);

  const login = useCallback(async (email, password) => (await apply(await authApi.login(email, password))).user, [apply]);

  const logout = useCallback(async () => {
    try {
      if (tokenRef.current) await authApi.logout();
    } catch {
      /* local state phir bhi clear hogi */
    }
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ user, accessToken, loading, isAuthenticated: !!user && !!accessToken, login, logout, refreshSession }),
    [user, accessToken, loading, login, logout, refreshSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
