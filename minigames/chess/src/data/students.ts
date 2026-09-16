export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  faculty: string;
  group: string;
  photo?: string | null;
}

/** Sample directory (mirrors the portal sidebar card). Unknown names fall back gracefully. */
const DIRECTORY: Student[] = [
  { id: 'CS0103125', firstName: 'Գոռ', lastName: 'Մադաթյան', faculty: 'Computer Science', group: 'CS-11A' },
  { id: 'CS0101042', firstName: 'Ani', lastName: 'Hakobyan', faculty: 'Computer Science', group: 'CS-12B' },
  { id: 'CS0102087', firstName: 'Narek', lastName: 'Sargsyan', faculty: 'Business', group: 'BS-21A' },
];

export function resolveStudent(displayName: string): Student {
  const norm = displayName.trim().toLowerCase();
  const byName = DIRECTORY.find(
    (s) => `${s.firstName} ${s.lastName}`.toLowerCase() === norm,
  );
  if (byName) return byName;
  const byId = DIRECTORY.find((s) => s.id.toLowerCase() === norm);
  if (byId) return byId;
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
