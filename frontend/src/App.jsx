import { Link } from "react-router-dom";
import Button from "./components/Button";
import NotificationBell from "./components/NotificationBell";
import { useAuth } from "./auth/useAuth";
import AppRoutes from "./router/routes";
import UnsupportedBrowserPage from "./pages/UnsupportedBrowserPage";
import { getBrowserSupport } from "./utils/browserSupport";

function Header() {
  const { isAuthenticated, user, logout } = useAuth();
  return (
    <header className="app-header">
      <Link to="/" className="brand">SafeExam</Link>
      {isAuthenticated && (
        <div className="header-right">
          <NotificationBell />
          <span>{user.fullName} ({user.role.toLowerCase()})</span>
          <Button variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      )}
    </header>
  );
}

export default function App() {
  const support = getBrowserSupport();
  if (!support.supported) return <UnsupportedBrowserPage support={support} />;
  return (
    <>
      <Header />
      <AppRoutes />
    </>
  );
}
