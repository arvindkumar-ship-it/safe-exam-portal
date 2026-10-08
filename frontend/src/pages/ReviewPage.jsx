import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import AttemptTimeline from "../features/review/AttemptTimeline";
import ReviewQueue from "../features/review/ReviewQueue";

export default function ReviewPage() {
  const { user } = useAuth();
  const [attemptId, setAttemptId] = useState(null);
  const canAssign = user.role === "INSTRUCTOR" || user.role === "ADMIN"; // reviewer assign nahi kar sakta
  return (
    <main>
      <div className="page-head">
        <h1>Review</h1>
      </div>
      {attemptId
        ? <AttemptTimeline attemptId={attemptId} canAssign={canAssign} onBack={() => setAttemptId(null)} />
        : <ReviewQueue onSelect={setAttemptId} />}
    </main>
  );
}
