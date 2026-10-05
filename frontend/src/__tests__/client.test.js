import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, setTokenProvider } from "../api/client";
import { errorResponse, jsonResponse, mockFetch } from "../testUtils";
import { toUserMessage } from "../utils/errors";

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider({ getAccessToken: () => null, refresh: null });
});

describe("apiRequest", () => {
  it("unwraps the envelope data", async () => {
    mockFetch(() => jsonResponse({ status: "ok" }));
    expect(await apiRequest("/health")).toEqual({ status: "ok" });
  });

  it("throws ApiError with code, status and requestId", async () => {
    mockFetch(() => errorResponse("NOT_FOUND", "nope", 404));
    const err = await apiRequest("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "NOT_FOUND", status: 404, requestId: "req_test" });
  });

  it("sends the bearer token", async () => {
    setTokenProvider({ getAccessToken: () => "tok" });
    const f = mockFetch(() => jsonResponse({}));
    await apiRequest("/x");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("on 401 TOKEN_EXPIRED refreshes once and retries", async () => {
    let token = "old";
    const refresh = vi.fn(async () => { token = "new"; });
    setTokenProvider({ getAccessToken: () => token, refresh });
    const f = mockFetch((url, opts) =>
      opts.headers.Authorization === "Bearer old"
        ? errorResponse("TOKEN_EXPIRED", "expired", 401)
        : jsonResponse({ ok: 1 }));
    expect(await apiRequest("/x")).toEqual({ ok: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not loop if the retry also fails", async () => {
    const refresh = vi.fn(async () => {});
    setTokenProvider({ getAccessToken: () => "t", refresh });
    const f = mockFetch(() => errorResponse("TOKEN_EXPIRED", "expired", 401));
    await expect(apiRequest("/x")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("maps a network failure to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    await expect(apiRequest("/x")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("toUserMessage", () => {
  it("is user friendly", () => {
    expect(toUserMessage(new ApiError("INVALID_CREDENTIALS", "x", 401))).toBe("Incorrect email or password.");
    expect(toUserMessage(new ApiError("WEIRD", "Custom text", 400))).toBe("Custom text");
  });
});
