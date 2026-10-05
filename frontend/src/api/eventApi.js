import { apiRequest } from './client.js';

// POST /attempts/{id}/events  -> {source, acknowledgedUpTo, accepted, duplicates, rejected}
export function sendEvents(attemptId, events) {
  return apiRequest(`/attempts/${attemptId}/events`, { method: 'POST', body: { events } });
}
