import { useEffect, useState } from 'react';
import { isValidStudentId } from '../net/identity';
import { fetchStudent } from '../net/portal';
import { resolveStudent, type Student } from './students';

/**
 * Portal profile for a student id, for the player cards.
 *
 * Renders immediately with the id-only placeholder from `resolveStudent`,
 * then swaps in the portal record once it arrives. A response that no longer
 * matches the requested id is ignored, and an unknown or unreachable portal
 * simply leaves the placeholder in place.
 */
export function useStudent(id: string): Student {
	const [found, setFound] = useState<Student | null>(null);
	const wanted = id.trim().toUpperCase();

	useEffect(() => {
		if (!isValidStudentId(wanted)) return;
		let active = true;
		void fetchStudent(wanted).then((student) => {
			if (active) setFound(student);
		});
		return () => {
			active = false;
		};
	}, [wanted]);

	// Guarded rather than reset in the effect: until the fetch for *this* id
	// lands, the previous player's profile must not show under the new id.
	return found?.id === wanted ? found : resolveStudent(id);
}
