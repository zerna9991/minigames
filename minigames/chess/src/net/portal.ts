/**
 * Read-only client for the student portal — the single source of truth for
 * player identity (name, faculty, group, photo). The chess API only ever
 * returns `student_id`s, so the profile cards resolve them here.
 *
 * `GET {PORTAL_BASE}/students/{student_id}` →
 *   `{id, first_name, last_name, department, group, photo_url}`
 *   `400` malformed id · `404` unknown id.
 *
 * Profiles never change mid-match, so each id is fetched once per page load
 * and shared between the cards that ask for it.
 */
import type { Student } from '../data/students';

export const PORTAL_BASE =
	(import.meta.env.VITE_PORTAL_API as string | undefined)?.replace(/\/+$/, '') ||
	'https://act.gormadatyan.xyz/mock-portal/api/v1';

interface StudentProfile {
	id: string;
	first_name: string;
	last_name: string;
	department: string;
	group: string;
	photo_url: string;
}

/** `computer_science` → `Computer Science`. Unknown codes pass through. */
function facultyLabel(department: string): string {
	return department
		.split('_')
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function isStudentProfile(raw: unknown): raw is StudentProfile {
	if (!raw || typeof raw !== 'object') return false;
	const p = raw as Record<string, unknown>;
	return (
		typeof p.id === 'string' && typeof p.first_name === 'string' && typeof p.last_name === 'string'
	);
}

function toStudent(p: StudentProfile): Student {
	return {
		id: p.id,
		firstName: p.first_name,
		lastName: p.last_name,
		faculty: facultyLabel(p.department ?? ''),
		group: p.group || '—',
		photo: p.photo_url || null
	};
}

// One in-flight request (and one resolved value) per student id.
const cache = new Map<string, Promise<Student | null>>();

/** Portal profile for a student id, or `null` when unknown/unreachable. */
export function fetchStudent(id: string): Promise<Student | null> {
	const key = id.trim().toUpperCase();
	const hit = cache.get(key);
	if (hit) return hit;
	const pending = (async () => {
		try {
			const res = await fetch(`${PORTAL_BASE}/students/${encodeURIComponent(key)}`, {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) return null;
			const payload: unknown = await res.json();
			return isStudentProfile(payload) ? toStudent(payload) : null;
		} catch {
			return null;
		}
	})();
	// A failed lookup shouldn't be cached forever — the portal may come back.
	void pending.then((student) => {
		if (!student) cache.delete(key);
	});
	cache.set(key, pending);
	return pending;
}
