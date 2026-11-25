import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next?.startsWith("/") ? next : "/dashboard";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-[28px] bg-sidebar shadow-[var(--shadow-green)]">
            <span className="text-xl font-semibold tracking-[-0.03em] text-white">
              II <span className="text-white/65">∞</span>
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">
            Painel da clínica
          </h1>
          <p className="mt-2 text-sm text-muted">
            Acesso reservado à equipa
          </p>
        </div>

        <div className="rounded-[22px] border border-line bg-surface p-6 shadow-sm">
          <LoginForm next={target} />
        </div>

        <p className="mt-6 text-center text-xs text-faint">
          Sistema de agendamento inteligente · Equipa 4
        </p>
      </div>
    </main>
  );
}
