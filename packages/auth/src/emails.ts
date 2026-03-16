import { Resend } from "resend";

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM_EMAIL = "Redgest <redgest@mail.edel.sh>";

export async function sendVerificationEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Auth] RESEND_API_KEY not set — skipping verification email");
    return;
  }
  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verify your email — Redgest",
    html: `<h2>Verify your email address</h2><p>Click the link below to verify your email and activate your Redgest account:</p><p><a href="${url}">Verify email</a></p><p>If you didn't create this account, you can ignore this email.</p>`,
  });
  if (result.error) {
    console.error("[Auth] Verification email failed:", result.error.message);
  }
}

export async function sendResetPasswordEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Auth] RESEND_API_KEY not set — skipping password reset email");
    return;
  }
  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Reset your password — Redgest",
    html: `<h2>Reset your password</h2><p>Click the link below to reset your password:</p><p><a href="${url}">Reset password</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
  });
  if (result.error) {
    console.error("[Auth] Password reset email failed:", result.error.message);
  }
}

export async function sendInvitationEmail({
  email,
  organizationName,
  inviterName,
  invitationId,
}: {
  email: string;
  organizationName: string;
  inviterName: string;
  invitationId: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Auth] RESEND_API_KEY not set — skipping invitation email");
    return;
  }
  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const acceptUrl = `${baseUrl}/invite/${invitationId}`;
  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `Join ${organizationName} on Redgest`,
    html: `<h2>You've been invited!</h2><p>${inviterName} invited you to join <strong>${organizationName}</strong> on Redgest.</p><p><a href="${acceptUrl}">Accept invitation</a></p>`,
  });
  if (result.error) {
    console.error("[Auth] Invitation email failed:", result.error.message);
  }
}
