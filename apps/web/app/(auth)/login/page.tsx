import { LoginForm } from "./login-form";

export default function LoginPage() {
  const githubEnabled = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );
  return <LoginForm githubEnabled={githubEnabled} />;
}
