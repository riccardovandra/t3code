import type { Env } from "./env.ts";

/** Sends the sign-in code through Resend, or logs it when no key is configured (local dev). */
export async function sendLoginCode(env: Env, email: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[docs-cloud] sign-in code for ${email}: ${code}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: `Your Docs sign-in code: ${code}`,
      text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for it, ignore this email.`,
    }),
  });
  if (!response.ok) {
    console.error(`[docs-cloud] Resend rejected the sign-in email: ${response.status}`);
  }
}
