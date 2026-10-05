import { apiRequest } from "./client";

export const questionApi = {
  listQuestions: ({ page = 1, pageSize = 20, includeInactive = false } = {}) =>
    apiRequest(`/questions?page=${page}&pageSize=${pageSize}${includeInactive ? "&includeInactive=true" : ""}`),
  getQuestion: (id) => apiRequest(`/questions/${id}`),
  createQuestion: (body) => apiRequest("/questions", { method: "POST", body }),
  updateQuestion: (id, body) => apiRequest(`/questions/${id}`, { method: "PATCH", body }),
  deactivateQuestion: (id) => apiRequest(`/questions/${id}`, { method: "DELETE" }),
};
