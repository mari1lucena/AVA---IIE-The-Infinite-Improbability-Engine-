import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // RLS scopes these to the caller's own clinic; SECURITY DEFINER helper
  // resolves clinic_id from auth.uid() via the staff row. Counts feed the
  // rail's teal pills.
  const [{ data: staff }, escalations, conversations] = await Promise.all([
    supabase
      .from("staff")
      .select("name, role, clinics(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase
      .from("escalation_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"]),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
  ]);

  // Signed in, but this auth user isn't linked to any staff row yet.
  if (!staff) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-[22px] border border-line bg-surface p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">
            Conta sem clínica associada
          </h1>
          <p className="mt-2 text-sm text-muted">
            A sua conta ({user.email}) ainda não está ligada a um registo de
            equipa. Peça a um administrador para associar o seu email na tabela{" "}
            <code className="rounded bg-surface-sunken px-1 text-ink">staff</code>.
          </p>
          <div className="mt-4">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  const clinicName =
    (staff.clinics as { name: string } | null)?.name ?? "Clínica";

  const counts: Record<string, number> = {
    "/escalations": escalations.count ?? 0,
    "/conversations": conversations.count ?? 0,
  };

  return (
    <div className="flex min-h-dvh bg-canvas">
      <div className="sticky top-0 h-dvh flex-none py-3 pl-3">
        <Sidebar
          clinicName={clinicName}
          staffName={staff.name}
          staffRole={staff.role}
          counts={counts}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
