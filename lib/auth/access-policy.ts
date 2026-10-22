const EMAIL_SEPARATOR = /[,;\s]+/;

export function configuredAccessEmails(value = process.env.ACCESS_ALLOWED_EMAILS): string[] {
  if (!value) return [];

  return [...new Set(
    value
      .split(EMAIL_SEPARATOR)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
}

export function isAccessRestricted(value = process.env.ACCESS_ALLOWED_EMAILS): boolean {
  return configuredAccessEmails(value).length > 0;
}

export function isAccessEmailAllowed(
  email: string | null | undefined,
  value = process.env.ACCESS_ALLOWED_EMAILS,
): boolean {
  const allowedEmails = configuredAccessEmails(value);
  if (allowedEmails.length === 0) return true;
  if (!email) return false;
  return allowedEmails.includes(email.trim().toLowerCase());
}
