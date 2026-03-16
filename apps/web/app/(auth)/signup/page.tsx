import { SignupForm } from "./signup-form";

export default function SignUpPage() {
  const githubEnabled = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );
  return <SignupForm githubEnabled={githubEnabled} />;
}
