import { apiRequest } from "./client";

export const notificationApi = {
  list: () => apiRequest("/notifications"),
  markRead: (id) => apiRequest(`/notifications/${id}/read`, { method: "POST", body: {} }),
};
