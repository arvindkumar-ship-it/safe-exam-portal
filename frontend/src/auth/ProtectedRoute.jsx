import { Navigate, Outlet, useLocation } from "react-router-dom";
import Loading from "../components/Loading";
import { useAuth } from "./useAuth";

// roles de to sirf wahi roles andar ja sakte hain
export default function ProtectedRoute({ roles, children }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children ?? <Outlet />;
}
