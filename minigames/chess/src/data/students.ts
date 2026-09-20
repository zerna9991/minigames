export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  faculty: string;
  group: string;
  photo?: string | null;
}

/** Builds a Student from whatever the caller has — an id or a display name. */
export function resolveStudent(displayName: string): Student {
  const parts = displayName.trim().split(/\s+/);
  return {
    id: '—',
    firstName: parts[0] ?? displayName,
    lastName: parts.slice(1).join(' '),
    faculty: '—',
    group: '—',
  };
}

export function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '?';
}

/** Deterministic hue for the initials avatar background. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
