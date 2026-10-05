import { apiRequest } from "./client";

export const authApi = {
  login: (email, password) => apiRequest("/auth/login", { method: "POST", body: { email, password } }),
  register: (email, password, fullName) =>
    apiRequest("/auth/register", { method: "POST", body: { email, password, fullName } }),
  refresh: (refreshToken) => apiRequest("/auth/refresh", { method: "POST", body: { refreshToken } }),
  logout: () => apiRequest("/auth/logout", { method: "POST", body: {} }),
  me: () => apiRequest("/users/me"),
};
