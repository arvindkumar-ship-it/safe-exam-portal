import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../auth/ProtectedRoute";
import { useAuth } from "../auth/useAuth";
import Loading from "../components/Loading";
import ExamPage from "../pages/ExamPage";
import LoginPage from "../pages/LoginPage";
import NotFoundPage from "../pages/NotFoundPage";
import ReviewPage from "../pages/ReviewPage";
import StudentDashboard from "../pages/StudentDashboard";
import SystemCheckPage from "../pages/SystemCheckPage";

export function homePathFor(role) {
  if (role === "STUDENT") return "/student";
  if (role === "REVIEWER") return "/reviews";
  return "/instructor"; // INSTRUCTOR, ADMIN
}

// Instructor UI alag chunk: student bundle me answer-key field names nahi aate (B-24).
const InstructorDashboard = lazy(() => import("../pages/InstructorDashboard"));

function HomeRedirect() {
  const { isAuthenticated, loading, user } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={isAuthenticated ? homePathFor(user.role) : "/login"} replace />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute roles={["STUDENT"]} />}>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/exam/:examId" element={<ExamPage />} />
      </Route>
      <Route element={<ProtectedRoute roles={["INSTRUCTOR", "ADMIN"]} />}>
        <Route path="/instructor" element={<Suspense fallback={<Loading />}><InstructorDashboard /></Suspense>} />
      </Route>
      <Route element={<ProtectedRoute roles={["REVIEWER", "INSTRUCTOR", "ADMIN"]} />}>
        <Route path="/reviews" element={<ReviewPage />} />
      </Route>
      <Route path="/system-check" element={<SystemCheckPage />} />
      <Route path="/system-check/practice" element={<SystemCheckPage practice />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export { ProtectedRoute };
