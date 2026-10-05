import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import AuthProvider from "./auth/AuthProvider";

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data, error: null, requestId: "req_test" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(code, message, status, details) {
  const error = { code, message, ...(details ? { details } : {}) };
  return new Response(JSON.stringify({ data: null, error, requestId: "req_test" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function mockFetch(handler) {
  const fn = vi.fn(async (url, opts = {}) => handler(String(url), opts));
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const STUDENT = { id: "u1", email: "s@x.com", fullName: "Stu Dent", role: "STUDENT", isActive: true };
export const INSTRUCTOR = { id: "u2", email: "i@x.com", fullName: "Ina Structor", role: "INSTRUCTOR", isActive: true };
export const REVIEWER = { id: "u3", email: "r@x.com", fullName: "Rev Iewer", role: "REVIEWER", isActive: true };

export function session(user) {
  return {
    accessToken: "acc-1", refreshToken: "ref-1", tokenType: "bearer",
    expiresAt: "2099-01-01T00:00:00Z", user,
  };
}

// logged-in state: sessionStorage me refresh token rakho + fetch refresh par session de
export function renderAt(ui, { route = "/", user = null } = {}) {
  if (user) sessionStorage.setItem("safeexam.refreshToken", "ref-1");
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}
