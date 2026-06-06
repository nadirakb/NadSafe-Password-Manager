/** Simple client-side password strength scorer (no dependencies). */
export interface StrengthResult {
  score: number;        // 0-5
  label: string;
  color: string;
}

export function passwordStrength(pw: string): StrengthResult {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 20) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#16a34a", "#15803d"];
  return { score, label: labels[score] ?? "Strong", color: colors[score] ?? "#15803d" };
}
