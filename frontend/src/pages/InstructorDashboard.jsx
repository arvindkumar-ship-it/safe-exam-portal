import { useState } from "react";
import Button from "../components/Button";
import ExamList from "../features/instructor/ExamList";
import QuestionBank from "../features/instructor/QuestionBank";

export default function InstructorDashboard() {
  const [tab, setTab] = useState("exams");
  return (
    <main>
      <h1>Instructor dashboard</h1>
      <div className="tabs">
        <Button variant={tab === "exams" ? "primary" : "secondary"} onClick={() => setTab("exams")}>Exams</Button>
        <Button variant={tab === "questions" ? "primary" : "secondary"} onClick={() => setTab("questions")}>Question bank</Button>
      </div>
      {tab === "exams" ? <ExamList /> : <QuestionBank />}
    </main>
  );
}
