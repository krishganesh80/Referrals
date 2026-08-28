export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Referrals</h1>
      <p className="text-lg" style={{ color: "var(--muted)" }}>
        Scaffold only — Next.js 15, React 19, TypeScript and Tailwind 4, with nothing
        assumed about what a referral is yet.
      </p>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Start in <code className="rounded px-1" style={{ background: "var(--line)" }}>app/page.tsx</code>.
      </p>
    </div>
  );
}
