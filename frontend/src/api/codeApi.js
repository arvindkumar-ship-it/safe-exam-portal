import { apiRequest } from "./client";

export const codeApi = {
  submit: (attemptId, { questionId, language, source, mode }) =>
    apiRequest(`/attempts/${attemptId}/code-submissions`, { method: "POST", body: { questionId, language, source, mode } }),
  get: (attemptId, id) => apiRequest(`/attempts/${attemptId}/code-submissions/${id}`),
  list: (attemptId, questionId, limit = 20) =>
    apiRequest(`/attempts/${attemptId}/code-submissions?questionId=${encodeURIComponent(questionId)}&limit=${limit}`),
  // instructor
  listTests: (qid) => apiRequest(`/questions/${qid}/tests`),
  addTests: (qid, tests) => apiRequest(`/questions/${qid}/tests`, { method: "POST", body: { tests } }),
  deleteTest: (qid, tid) => apiRequest(`/questions/${qid}/tests/${tid}`, { method: "DELETE" }),
};
