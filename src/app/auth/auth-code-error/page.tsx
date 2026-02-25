import Link from 'next/link';

export default function AuthCodeErrorPage() {
  return (
    <main className="lp-main">
      <div className="page-shell admin-shell">
        <article className="card bg-base-100 shadow-sm">
          <div className="card-body p-6">
            <h1 className="text-2xl font-black text-error">Authentication failed</h1>
            <p className="text-sm text-base-content/70">
              Magic link verification did not complete. Request a new link and try again.
            </p>
            <div>
              <Link href="/admin/login" className="btn btn-primary">Back to admin login</Link>
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}
