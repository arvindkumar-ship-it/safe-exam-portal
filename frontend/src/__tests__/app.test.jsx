import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../App";
import Loading from "../components/Loading";
import { renderAt } from "../testUtils";

describe("app shell", () => {
  it("renders the brand", () => {
    renderAt(<App />, { route: "/login" });
    expect(screen.getByText("SafeExam")).toBeInTheDocument();
  });

  it("shows 404 for unknown routes", () => {
    renderAt(<App />, { route: "/does-not-exist" });
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
  });

  it("renders Loading", () => {
    renderAt(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });
});
