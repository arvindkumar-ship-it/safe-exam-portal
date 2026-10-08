import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main>
      <div className="finished">
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist.</p>
        <Link to="/" className="btn btn-secondary">Go home</Link>
      </div>
    </main>
  );
}
