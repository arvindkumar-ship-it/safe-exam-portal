import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import { attemptApi } from "../api/attemptApi";
import { examApi } from "../api/examApi";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import ExamInstructions from "../features/attempt/ExamInstructions";
import ExamShell from "../features/attempt/ExamShell";
import { requestFullscreen } from "../features/monitoring/monitors/fullscreenMonitor";
import { resolvePolicy } from "../features/monitoring/policy";

// Submit receipt (A) ya server-side terminal status (B: heartbeat/offline recovery) dono ko dikhata hai.
function Finished({ result }) {
  const counted = result && result.answeredCount !== undefined;
  return (
    <main>
      <div className="finished">
        <span className="finished__icon"><Icon name="check" size={22} /></span>
        <h1>Exam {counted ? "submitted" : "finished"}</h1>
        {counted
          ? <p>You answered {result.answeredCount} of {result.totalQuestions} questions.</p>
          : <p>Your attempt has been closed by the server{result?.status ? ` (${result.status})` : ""}.</p>}
        {result?.discardedLocalAnswers && <p>Answers saved on this device after the server closed the attempt were discarded.</p>}
        <Link to="/student" className="btn btn-secondary">Back to dashboard</Link>
      </div>
    </main>
  );
}

export default function ExamPage() {
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    examApi.getExam(examId).then(setExam).catch(setError);
  }, [examId]);

  async function start(consentGiven) {
    setError(null);
    setStarting(true);
    try {
      // start dobara bulane par server wahi attempt (resume) deta hai
      const a = await attemptApi.startAttempt(examId);
      // Start click ka user-gesture abhi alive hai => fullscreen maango. Fail ho toh in-exam banner fallback hai.
      if (resolvePolicy(a.monitoringPolicy).fullscreen) requestFullscreen();
      setConsent(consentGiven);
      setAttempt(a);
    } catch (e) {
      setError(e);
    } finally {
      setStarting(false);
    }
  }

  if (receipt) return <Finished result={receipt} />;
  if (attempt) return <div className="exam-page"><ExamShell attempt={attempt} consentGiven={consent} onSubmitted={setReceipt} /></div>;
  return (
    <main>
      <ErrorMessage error={error} />
      {!exam && !error && <Loading />}
      {exam && <ExamInstructions exam={exam} onStart={start} busy={starting} />}
    </main>
  );
}
