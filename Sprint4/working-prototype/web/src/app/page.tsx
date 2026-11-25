import { redirect } from "next/navigation";

export default function RootPage() {
  // Middleware handles auth; signed-in users land on the dashboard,
  // signed-out users get bounced to /login.
  redirect("/dashboard");
}
