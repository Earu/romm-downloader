import { LoginForm } from "@/components/LoginForm";
import { getConfig, getPinnedRommUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [cfg, pinned] = await Promise.all([getConfig(), getPinnedRommUrl()]);
  return (
    <LoginForm
      defaultUrl={pinned ?? cfg.rommUrl ?? "http://localhost:8080"}
      pinned={Boolean(pinned)}
    />
  );
}
