import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import ProtectedRoute from "../auth/ProtectedRoute";
import { useAuth } from "../auth/useAuth";
import { apiRequest } from "../api/client";
import { STUDENT, errorResponse, jsonResponse, mockFetch, renderAt, session } from "../testUtils";

afterEach(() => vi.unstubAllGlobals());

async function fillAndSubmit(email = "s@x.com", password = "Passw0rd!") {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText(/email/i), email);
  await u.type(screen.getByLabelText(/password/i), password);
  await u.click(screen.getByRole("button", { name: /^sign in$/i }));
}

describe("auth UI", () => {
  it("login success shows the user and stores no access token in storage", async () => {
    mockFetch((url) => (url.endsWith("/auth/login") ? jsonResponse(session(STUDENT)) : jsonResponse({})));
    renderAt(<App />, { route: "/login" });
    await fillAndSubmit();
    expect(await screen.findByText(/Stu Dent/)).toBeInTheDocument();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("acc-1");
  });

  it("shows a visible error on wrong login", async () => {
    mockFetch(() => errorResponse("INVALID_CREDENTIALS", "bad", 401));
    renderAt(<App />, { route: "/login" });
    await fillAndSubmit("s@x.com", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(screen.getByLabelText(/email/i)).toHaveValue("s@x.com"); // form erase nahi hua
  });

  it("redirects protected routes to /login", () => {
    renderAt(
      <Routes>
        <Route path="/secret" element={<ProtectedRoute><p>secret</p></ProtectedRoute>} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>,
      { route: "/secret" },
    );
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("student cannot open an instructor page", async () => {
    mockFetch(() => jsonResponse(session(STUDENT)));
    renderAt(
      <Routes>
        <Route path="/instructor" element={<ProtectedRoute roles={["INSTRUCTOR", "ADMIN"]}><p>instructor only</p></ProtectedRoute>} />
        <Route path="/" element={<p>home</p>} />
      </Routes>,
      { route: "/instructor", user: STUDENT },
    );
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(screen.queryByText("instructor only")).not.toBeInTheDocument();
  });

  it("logout clears state and the stored refresh token", async () => {
    mockFetch((url) => (url.endsWith("/auth/refresh") ? jsonResponse(session(STUDENT)) : jsonResponse({ loggedOut: true })));
    renderAt(<App />, { route: "/login", user: STUDENT });
    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.queryByText(/Stu Dent/)).not.toBeInTheDocument());
    expect(sessionStorage.getItem("safeexam.refreshToken")).toBeNull();
  });

  it("refreshes the session on 401 TOKEN_EXPIRED and retries", async () => {
    let calls = 0;
    mockFetch((url, opts) => {
      if (url.endsWith("/auth/refresh")) return jsonResponse({ ...session(STUDENT), accessToken: "acc-2" });
      calls += 1;
      return opts.headers.Authorization === "Bearer acc-2" ? jsonResponse({ ok: true }) : errorResponse("TOKEN_EXPIRED", "x", 401);
    });
    let result;
    function Probe() {
      const { isAuthenticated } = useAuth();
      if (isAuthenticated && !result) result = apiRequest("/ping");
      return null;
    }
    renderAt(<Probe />, { user: STUDENT });
    await waitFor(() => expect(result).toBeDefined());
    expect(await result).toEqual({ ok: true });
    expect(calls).toBe(1); // pehla call tab hi hota hai jab 'acc-2' mil chuka ho
  });
});
