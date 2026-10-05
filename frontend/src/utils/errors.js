const MESSAGES = {
  VALIDATION_ERROR: "Some fields are invalid. Please check and try again.",
  UNAUTHENTICATED: "Please sign in to continue.",
  TOKEN_EXPIRED: "Your session expired. Please sign in again.",
  TOKEN_REVOKED: "You have been signed out. Please sign in again.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  ACCOUNT_INACTIVE: "This account is inactive.",
  ACCOUNT_LOCKED: "Too many failed attempts. Try again later.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "We could not find that.",
  EMAIL_ALREADY_EXISTS: "An account with this email already exists.",
  RATE_LIMITED: "Too many requests. Please wait a moment.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  NETWORK_ERROR: "Cannot reach the server. Check your connection.",
  INVALID_STATE_TRANSITION: "That change is not allowed in the current state.",
  EXAM_NOT_EDITABLE: "This exam can no longer be edited.",
  EXAM_NOT_PUBLISHABLE: "This exam is not ready to publish.",
  EXAM_NOT_AVAILABLE: "This exam is not available right now.",
  QUESTION_IN_USE: "This question is used by a published exam.",
  INVALID_ANSWER: "That answer is not valid.",
  ATTEMPT_LIMIT_REACHED: "You have used all attempts for this exam.",
  ATTEMPT_NOT_ACTIVE: "This attempt is no longer active.",
  ATTEMPT_ALREADY_SUBMITTED: "This attempt was already submitted.",
  ATTEMPT_EXPIRED: "Time is up for this attempt.",
  ANSWER_VERSION_CONFLICT: "Your answer was changed elsewhere.",
  RESULT_NOT_AVAILABLE: "Results are not available yet.",
  REVIEW_NOT_ALLOWED: "This review action is not allowed.",
};

export function toUserMessage(error) {
  if (!error) return "";
  if (error.code === "VALIDATION_ERROR" && error.message) return error.message;
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code];
  return error.message || MESSAGES.INTERNAL_ERROR;
}
