import { Navigate, useNavigate } from "react-router-dom";
import LoginForm from "../features/auth/LoginForm";
import { useAuth } from "../auth/useAuth";
import { homePathFor } from "../router/routes";

export default function LoginPage() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  if (isAuthenticated) return <Navigate to={homePathFor(user.role)} replace />;
  return (
    <main className="center">
      <LoginForm onSuccess={(u) => navigate(homePathFor(u.role), { replace: true })} />
    </main>
  );
}
