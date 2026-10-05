import { apiRequest } from "./client";

export const reviewApi = {
  queue: ({ riskLevel, status, examId, page = 1, pageSize = 20 } = {}) => {
    const p = new URLSearchParams({ page, pageSize });
    if (riskLevel) p.set("riskLevel", riskLevel);
    if (status) p.set("status", status);
    if (examId) p.set("examId", examId);
    return apiRequest(`/reviews/queue?${p}`);
  },
  timeline: (attemptId) => apiRequest(`/reviews/attempts/${attemptId}/timeline`),
  assign: (attemptId, reviewerId) =>
    apiRequest(`/reviews/attempts/${attemptId}/assign`, { method: "POST", body: { reviewerId } }),
  decide: (attemptId, { decision, reason }) =>
    apiRequest(`/reviews/attempts/${attemptId}/decision`, { method: "POST", body: { decision, reason } }),
  appeal: (attemptId, reason) => apiRequest(`/reviews/attempts/${attemptId}/appeal`, { method: "POST", body: { reason } }),
  verifyChain: (attemptId) => apiRequest(`/reviews/attempts/${attemptId}/verify-chain`),
  exportAudit: (attemptId) => apiRequest(`/reviews/attempts/${attemptId}/export`),
};
