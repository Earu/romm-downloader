import { LoginForm } from "@/components/LoginForm";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const cfg = await getConfig();
  return <LoginForm defaultUrl={cfg.rommUrl || "http://localhost:8080"} />;
}
