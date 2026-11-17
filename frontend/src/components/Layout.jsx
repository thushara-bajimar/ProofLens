import { NavLink, Link, Outlet } from 'react-router-dom';
import { Logo } from './Logo.jsx';

export function Layout() {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand"><Logo /> ProofLens</Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/verify">Verify</NavLink>
            <NavLink to="/register">Register</NavLink>
            <NavLink to="/demo">Demo &amp; tests</NavLink>
            <NavLink to="/how-it-works">How it works</NavLink>
          </nav>
        </div>
      </header>
      <main><Outlet /></main>
      <footer className="site-footer">
        <div className="container row">
          <span>ProofLens: a college engineering MVP for media provenance. Development keys and certificates only: not a production trust service.</span>
        </div>
      </footer>
    </>
  );
}
