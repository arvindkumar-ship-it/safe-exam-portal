import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateExamForm from "../features/instructor/CreateExamForm";
import ExamList from "../features/instructor/ExamList";
import { errorResponse, jsonResponse, mockFetch } from "../testUtils";

afterEach(() => vi.unstubAllGlobals());

const exam = (o = {}) => ({
  id: "e1", title: "Math", description: null, durationSeconds: 3600, status: "DRAFT",
  startsAt: null, endsAt: null, showResult: false, maxAttempts: 1, shuffleQuestions: true,
  shuffleOptions: true, passMarks: null, lockOnHighRisk: false, monitoringPolicy: {}, ...o,
});
const page = (items, extra = {}) => ({ items, page: 1, pageSize: 10, total: items.length, ...extra });

describe("CreateExamForm", () => {
  it("creates a draft exam", async () => {
    const f = mockFetch(() => jsonResponse(exam({ title: "Physics" }), 201));
    const onSaved = vi.fn();
    render(<CreateExamForm onSaved={onSaved} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^title/i), "Physics");
    await u.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ title: "Physics", durationSeconds: 3600, lockOnHighRisk: false });
  });

  it("shows validation errors and does not call the API", async () => {
    const f = mockFetch(() => jsonResponse({}));
    render(<CreateExamForm />);
    const u = userEvent.setup();
    await u.clear(screen.getByLabelText(/duration/i));
    await u.type(screen.getByLabelText(/duration/i), "-5");
    await u.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Duration must be more than 0.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("keeps typed values when the API fails", async () => {
    mockFetch(() => errorResponse("INTERNAL_ERROR", "boom", 500));
    render(<CreateExamForm />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^title/i), "Keep me");
    await u.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toHaveValue("Keep me");
  });

  it("makes restricted fields read-only for a published exam", () => {
    render(<CreateExamForm exam={exam({ status: "PUBLISHED" })} />);
    expect(screen.getByLabelText(/duration/i)).toBeDisabled();
    expect(screen.getByLabelText(/monitoring policy/i)).toBeDisabled();
    expect(screen.getByLabelText(/^title/i)).toBeEnabled();
  });
});

describe("ExamList", () => {
  it("shows the empty state", async () => {
    mockFetch(() => jsonResponse(page([])));
    render(<ExamList />);
    expect(await screen.findByText(/no exams yet/i)).toBeInTheDocument();
  });

  it("shows publish problems", async () => {
    mockFetch((url, opts) =>
      opts.method === "POST"
        ? errorResponse("EXAM_NOT_PUBLISHABLE", "bad", 422, { problems: ["At least one question is required"] })
        : jsonResponse(page([exam()])));
    render(<ExamList />);
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByText("At least one question is required")).toBeInTheDocument();
  });

  it("paginates", async () => {
    const f = mockFetch((url) =>
      jsonResponse(page([exam()], { total: 25, page: url.includes("page=2") ? 2 : 1 })));
    render(<ExamList />);
    await screen.findByText("Page 1 of 3");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText("Page 2 of 3");
    expect(f.mock.calls.some(([u]) => u.includes("page=2"))).toBe(true);
  });
});
