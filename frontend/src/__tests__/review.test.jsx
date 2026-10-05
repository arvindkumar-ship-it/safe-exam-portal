import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationBell from "../components/NotificationBell";
import AppealForm from "../features/attempt/AppealForm";
import AttemptTimeline from "../features/review/AttemptTimeline";
import ReviewQueue from "../features/review/ReviewQueue";
import { errorResponse, jsonResponse, mockFetch } from "../testUtils";

afterEach(() => vi.unstubAllGlobals());

const item = (o = {}) => ({ attemptId: "a1", examTitle: "Math", studentName: "Stu", status: "UNDER_REVIEW", riskScore: 65, riskLevel: "HIGH_RISK", needsReview: true, lastEventAt: null, ...o });
const timeline = {
  attempt: { id: "a1", examTitle: "Math", studentName: "Stu", status: "UNDER_REVIEW", startedAt: null, submittedAt: null },
  riskScore: 65, riskLevel: "HIGH_RISK", reasons: ["3 × FULLSCREEN_EXIT (+30)"],
  events: [
    { occurredAt: "2026-10-04T18:40:00Z", eventType: "PAGE_HIDDEN", source: "WEB_CLIENT", severity: "LOW", weight: 5, metadata: {} },
    { occurredAt: "2026-10-04T18:41:00Z", eventType: "FULLSCREEN_EXIT", source: "WEB_CLIENT", severity: "MEDIUM", weight: 10, metadata: {} },
  ],
  decisions: [],
};
const route = (map) => (url) => {
  for (const [frag, res] of Object.entries(map)) if (url.includes(frag)) return typeof res === "function" ? res() : res;
  return jsonResponse({});
};

describe("ReviewQueue", () => {
  it("filters by risk level via the API", async () => {
    const f = mockFetch(() => jsonResponse({ items: [item()], page: 1, pageSize: 10, total: 1 }));
    render(<ReviewQueue onSelect={() => {}} />);
    await screen.findByText("Stu");
    await userEvent.selectOptions(screen.getByLabelText(/risk level/i), "HIGH_RISK");
    await waitFor(() => expect(f.mock.calls.at(-1)[0]).toContain("riskLevel=HIGH_RISK"));
  });

  it("shows empty and error states", async () => {
    mockFetch(() => jsonResponse({ items: [], page: 1, pageSize: 10, total: 0 }));
    const { unmount } = render(<ReviewQueue onSelect={() => {}} />);
    expect(await screen.findByText(/nothing to review/i)).toBeInTheDocument();
    unmount();
    mockFetch(() => errorResponse("INTERNAL_ERROR", "x", 500));
    render(<ReviewQueue onSelect={() => {}} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("AttemptTimeline", () => {
  const base = {
    "/timeline": () => jsonResponse(timeline),
    "/verify-chain": () => jsonResponse({ valid: true, brokenAt: null }),
  };

  it("renders events in server order with reasons and chain badge", async () => {
    mockFetch(route(base));
    render(<AttemptTimeline attemptId="a1" onBack={() => {}} />);
    const list = await screen.findByRole("list", { name: /event timeline/i });
    const rows = list.querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("PAGE_HIDDEN");
    expect(rows[1]).toHaveTextContent("FULLSCREEN_EXIT");
    expect(screen.getByText("3 × FULLSCREEN_EXIT (+30)")).toBeInTheDocument();
    expect(screen.getByTestId("chain-badge")).toHaveTextContent(/verified/i);
  });

  it("submits a decision with a reason and reloads", async () => {
    const f = mockFetch(route({ ...base, "/decision": () => jsonResponse({ id: "d1" }, 201) }));
    render(<AttemptTimeline attemptId="a1" onBack={() => {}} />);
    await screen.findByRole("form", { name: /decision form/i });
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/reason/i), "Looked at the logs");
    await u.click(screen.getByRole("button", { name: /record decision/i }));
    await waitFor(() => expect(f.mock.calls.some(([url, o]) => url.endsWith("/decision") && o.method === "POST")).toBe(true));
    const call = f.mock.calls.find(([url]) => url.endsWith("/decision"));
    expect(JSON.parse(call[1].body)).toEqual({ decision: "NO_ISSUE", reason: "Looked at the logs" });
  });

  it("rejects a too-short reason locally", async () => {
    const f = mockFetch(route(base));
    render(<AttemptTimeline attemptId="a1" onBack={() => {}} />);
    await screen.findByRole("form", { name: /decision form/i });
    await userEvent.type(screen.getByLabelText(/reason/i), "no");
    await userEvent.click(screen.getByRole("button", { name: /record decision/i }));
    expect(await screen.findByText(/at least 5/i)).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => u.endsWith("/decision"))).toBe(false);
  });

  it("shows the assign form only when canAssign", async () => {
    mockFetch(route(base));
    const { unmount } = render(<AttemptTimeline attemptId="a1" onBack={() => {}} />);
    await screen.findByRole("form", { name: /decision form/i });
    expect(screen.queryByRole("form", { name: /assign reviewer/i })).not.toBeInTheDocument();
    unmount();
    render(<AttemptTimeline attemptId="a1" canAssign onBack={() => {}} />);
    expect(await screen.findByRole("form", { name: /assign reviewer/i })).toBeInTheDocument();
  });

  it("shows an error state when the timeline cannot load", async () => {
    mockFetch(() => errorResponse("NOT_FOUND", "x", 404));
    render(<AttemptTimeline attemptId="zzz" onBack={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not find/i);
  });
});

describe("AppealForm and NotificationBell", () => {
  it("sends an appeal", async () => {
    mockFetch(() => jsonResponse({ id: "d", isAppeal: true }, 201));
    render(<AppealForm attemptId="a1" />);
    await userEvent.type(screen.getByLabelText(/appeal reason/i), "My wifi dropped");
    await userEvent.click(screen.getByRole("button", { name: /send appeal/i }));
    expect(await screen.findByText(/appeal was sent/i)).toBeInTheDocument();
  });

  it("shows unread count and marks one read", async () => {
    const n = { id: "n1", kind: "REVIEW_ASSIGNED", title: "New case", body: "b", isRead: false, createdAt: "x" };
    mockFetch((url) => (url.endsWith("/read") ? jsonResponse({ ...n, isRead: true }) : jsonResponse([n])));
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: /1 unread/i });
    await userEvent.click(bell);
    await userEvent.click(screen.getByRole("button", { name: "New case" }));
    expect(await screen.findByRole("button", { name: /0 unread/i })).toBeInTheDocument();
  });
});
