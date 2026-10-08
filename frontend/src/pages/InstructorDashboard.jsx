import { useState } from "react";
import ExamList from "../features/instructor/ExamList";
import QuestionBank from "../features/instructor/QuestionBank";

export default function InstructorDashboard() {
  const [tab, setTab] = useState("exams");
  return (
    <main>
      <div className="page-head">
        <h1>Instructor dashboard</h1>
      </div>
      <div className="tabs">
        <button type="button" className="tab" aria-current={tab === "exams" ? "page" : undefined} onClick={() => setTab("exams")}>Exams</button>
        <button type="button" className="tab" aria-current={tab === "questions" ? "page" : undefined} onClick={() => setTab("questions")}>Question bank</button>
      </div>
      {tab === "exams" ? <ExamList /> : <QuestionBank />}
    </main>
  );
}
