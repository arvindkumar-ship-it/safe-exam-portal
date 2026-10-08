import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CodingPane from "../features/attempt/CodingPane.jsx";
import { codeApi } from "../api/codeApi";
import { isAnswered } from "../features/attempt/QuestionNavigator.jsx";

vi.mock("../api/codeApi", () => ({ codeApi: { submit: vi.fn(), get: vi.fn(), list: vi.fn() } }));
const q = { id: "q1", type: "CODING", prompt: "Add", marks: 10, coding: { timeLimitMs: 1000, memoryLimitMb: 64, languages: ["cpp17", "python3"], samples: [{ input: "1 2", output: "3" }] } };
const base = { id: "s1", mode: "SUBMIT", language: "python3", passed: 0, total: 2, score: 0, maxScore: 10, tests: [], compileOutput: null };

describe("CodingPane", () => {
  beforeEach(() => { vi.clearAllMocks(); codeApi.list.mockResolvedValue([]); });

  it("submits, polls until DONE and shows verdict; draft goes to onChange", async () => {
    codeApi.submit.mockResolvedValue({ ...base, status: "QUEUED" });
    codeApi.get.mockResolvedValueOnce({ ...base, status: "JUDGING" })
      .mockResolvedValue({ ...base, status: "DONE", verdict: "AC", passed: 2, score: 10, timeMs: 12, tests: [{ position: 1, isSample: true, verdict: "AC", timeMs: 12 }] });
    const onChange = vi.fn();
    render(<CodingPane question={q} attemptId="a1" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Code editor"), "x");
    expect(onChange).toHaveBeenLastCalledWith({ language: "cpp17", source: "x" });
    await userEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(screen.getByText("Accepted")).toBeTruthy(), { timeout: 3000 });
    expect(codeApi.submit).toHaveBeenCalledWith("a1", { questionId: "q1", language: "cpp17", source: "x", mode: "SUBMIT" });
  });

  it("empty code is blocked and API error is shown", async () => {
    render(<CodingPane question={q} attemptId="a1" value="" onChange={() => {}} />);
    await userEvent.click(screen.getByText("Run samples"));
    expect(screen.getByRole("alert").textContent).toMatch(/Write some code/);
    expect(codeApi.submit).not.toHaveBeenCalled();
    codeApi.submit.mockRejectedValue(new Error("You are submitting too fast."));
    await userEvent.type(screen.getByLabelText("Code editor"), "y");
    await userEvent.click(screen.getByText("Run samples"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/too fast/));
  });

  it("isAnswered handles coding drafts", () => {
    expect(isAnswered({ language: "python3", source: "  " })).toBe(false);
    expect(isAnswered({ language: "python3", source: "print(1)" })).toBe(true);
  });
});
