import { Link } from "react-router-dom";
import Button from "./components/Button";
import Icon from "./components/Icon";
import NotificationBell from "./components/NotificationBell";
import { useAuth } from "./auth/useAuth";
import AppRoutes from "./router/routes";
import UnsupportedBrowserPage from "./pages/UnsupportedBrowserPage";
import { getBrowserSupport } from "./utils/browserSupport";

const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

function Header() {
  const { isAuthenticated, user, logout } = useAuth();
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        <span className="brand__mark"><Icon name="shield" size={17} /></span>
        SafeExam
      </Link>
      {isAuthenticated && (
        <div className="header-right">
          <NotificationBell />
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
            <span className="user-chip__text">
              <span className="user-chip__name">{user.fullName}</span>
              <span className="user-chip__role">{user.role.toLowerCase()}</span>
            </span>
          </div>
          <Button variant="ghost" onClick={logout}>Sign out</Button>
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
