import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExamInstructions from "../features/attempt/ExamInstructions";
import ExamShell from "../features/attempt/ExamShell";
import ConsentNotice from "../features/monitoring/ConsentNotice";
import MonitoringBanner from "../features/monitoring/MonitoringBanner";
import { MonitoringContext, MonitoringProvider } from "../features/monitoring/MonitoringProvider";
import WarningToast from "../features/monitoring/WarningToast";
import { MESSAGES } from "../features/monitoring/policy";
import { jsonResponse, mockFetch, renderAt } from "../testUtils";

afterEach(() => vi.unstubAllGlobals());

const attemptView = (extra = {}) => ({
  id: "a1", exam: { id: "e1", title: "Math", durationSeconds: 3600 }, status: "ACTIVE",
  startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  serverTime: new Date().toISOString(), monitoringPolicy: {},
  questions: [
    { id: "q1", type: "MCQ_SINGLE", prompt: "2+2?", options: [{ id: "o1", text: "3" }, { id: "o2", text: "4" }], marks: 1, position: 1, answer: null },
    { id: "q2", type: "SHORT_TEXT", prompt: "Capital of India?", options: null, marks: 2, position: 2, answer: null },
  ],
  ...extra,
});

describe("ExamInstructions", () => {
  it("disables start until consent is ticked", async () => {
    const onStart = vi.fn();
    render(<ExamInstructions exam={{ title: "Math", durationSeconds: 3600 }} onStart={onStart} />);
    const btn = screen.getByRole("button", { name: /start exam/i });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledWith(true);
  });
});

describe("ExamShell", () => {
  it("renders questions, saves a selected option and keeps it when navigating", async () => {
    const f = mockFetch(() => jsonResponse({ questionId: "q1", version: 1, savedAt: "x" }));
    renderAt(<ExamShell attempt={attemptView()} consentGiven />);
    expect(screen.getByText(/2\+2\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("4"));
    await waitFor(() => expect(f).toHaveBeenCalled());
    const [url, opts] = f.mock.calls[0];
    expect(url).toContain("/attempts/a1/answers/q1");
    expect(JSON.parse(opts.body)).toEqual({ answerValue: "o2", version: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Capital of India/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByLabelText("4")).toBeChecked();
  });

  it("restores saved answers from the server view", () => {
    const view = attemptView();
    view.questions[0].answer = { answerValue: "o1", version: 3 };
    renderAt(<ExamShell attempt={view} consentGiven />);
    expect(screen.getByLabelText("3")).toBeChecked();
    expect(screen.getByRole("button", { name: "Question 1, answered" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 2" })).toBeInTheDocument();
  });

  it("asks for confirmation and submits with an Idempotency-Key", async () => {
    const onSubmitted = vi.fn();
    const f = mockFetch(() => jsonResponse({ submissionId: "s1", answeredCount: 0, totalQuestions: 2 }));
    renderAt(<ExamShell attempt={attemptView()} consentGiven onSubmitted={onSubmitted} />);
    await userEvent.click(screen.getByRole("button", { name: /submit exam/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/submit your exam/i);
    expect(f).not.toHaveBeenCalled(); // confirm se pehle kuch nahi
    await userEvent.click(screen.getByRole("button", { name: /confirm submit/i }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(f.mock.calls[0][1].headers["Idempotency-Key"]).toBeTruthy();
  });

  it("shows the monitoring banner and a visible timer", () => {
    renderAt(<ExamShell attempt={attemptView()} consentGiven />);
    expect(screen.getByText(MESSAGES.banner)).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Time remaining" })).toBeInTheDocument();
  });
});

describe("monitoring UI shell", () => {
  it("shows the exact banner and consent text", () => {
    render(<MonitoringProvider attemptId="a1" policy={{}} consentGiven><MonitoringBanner /><ConsentNotice /></MonitoringProvider>);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Exam monitoring is active. Focus changes and fullscreen exits may be recorded for review.");
    expect(screen.getByText(/Exam monitoring notice/)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/recorded for review/);
  });

  it("warning is a single accessible alert, non-accusatory", () => {
    const value = { lastWarning: MESSAGES.blur, lastWarningType: "WINDOW_BLUR", warningSeq: 1, eventCount: 1,
      enterFullscreen: vi.fn(), status: { fullscreen: true, online: true, queued: 0, lastUploadAt: null, blocked: false } };
    render(<MonitoringContext.Provider value={value}><WarningToast /></MonitoringContext.Provider>);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Your exam window lost focus. This event has been recorded for review.");
    expect(alerts[0].textContent).not.toMatch(/risk|fraud|cheat/i);
  });
});
