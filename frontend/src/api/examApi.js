import { apiDownload, apiRequest } from "./client";

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const examApi = {
  listExams: ({ page = 1, pageSize = 20, status } = {}) => apiRequest(`/exams${qs({ page, pageSize, status })}`),
  getExam: (id) => apiRequest(`/exams/${id}`),
  createExam: (body) => apiRequest("/exams", { method: "POST", body }),
  updateExam: (id, body) => apiRequest(`/exams/${id}`, { method: "PATCH", body }),
  deleteExam: (id) => apiRequest(`/exams/${id}`, { method: "DELETE" }),
  publishExam: (id) => apiRequest(`/exams/${id}/publish`, { method: "POST", body: {} }),
  setStatus: (id, to) => apiRequest(`/exams/${id}/status`, { method: "POST", body: { to } }),
  listExamQuestions: (id) => apiRequest(`/exams/${id}/questions`),
  attachQuestion: (id, body) => apiRequest(`/exams/${id}/questions`, { method: "POST", body }),
  detachQuestion: (id, qid) => apiRequest(`/exams/${id}/questions/${qid}`, { method: "DELETE" }),
  reorderQuestions: (id, questionIds) =>
    apiRequest(`/exams/${id}/questions/order`, { method: "PUT", body: { questionIds } }),
  listResults: (id, { page = 1, pageSize = 50 } = {}) => apiRequest(`/exams/${id}/results${qs({ page, pageSize })}`),
  publishResults: (id) => apiRequest(`/exams/${id}/results/publish`, { method: "POST", body: {} }),
  downloadResultsCsv: (id) => apiDownload(`/exams/${id}/export/results.csv`),
};
