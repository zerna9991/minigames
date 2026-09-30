import type { PlayerIdentity } from './api';

const KEY = 'act-chess-identity';

const STUDENT_RE = /^(CS|EM|DA)\d{7}$/;

/** Dev identity: portal session tokens are currently unverified (any non-blank
 *  token works for any well-formed student ID), so a tiny session-scoped form
 *  is enough until the real portal login lands. */
export function loadIdentity(): PlayerIdentity {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return { studentId: '', sessionToken: '' };
		const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
		return {
			studentId: typeof parsed.studentId === 'string' ? parsed.studentId : '',
			sessionToken: typeof parsed.sessionToken === 'string' ? parsed.sessionToken : ''
		};
	} catch {
		return { studentId: '', sessionToken: '' };
	}
}

export function saveIdentity(id: PlayerIdentity): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(id));
	} catch {
		// storage unavailable — identity still works for this page load
	}
}

/** A random dev session token. The server doesn't verify portal sessions yet
 *  (any non-blank token works), so the player never has to type one. */
export function generateSessionToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return `dev-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function isValidStudentId(id: string): boolean {
	return STUDENT_RE.test(id.trim());
}

export function isValidIdentity(id: PlayerIdentity): boolean {
	return isValidStudentId(id.studentId) && id.sessionToken.trim().length > 0;
}

export function identityError(id: PlayerIdentity): string | null {
	if (!isValidStudentId(id.studentId))
		return 'Student ID looks like CS0103125 (CS/EM/DA + 7 digits).';
	if (id.sessionToken.trim().length === 0)
		return "Session token can't be blank (dev: any non-blank token works).";
	return null;
}
