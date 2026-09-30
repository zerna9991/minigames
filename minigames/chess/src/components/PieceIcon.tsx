import type { PieceColor, PieceType } from '../chess/engine';
import { PIECE_NAME } from './pieceNames';

/**
 * Chess pieces drawn as inline SVG.
 *
 * These used to be Unicode glyphs (♚♛♜…), which meant every platform picked a
 * different system symbol font — macOS, Windows, Linux and mobile each drew a
 * noticeably different set, and on some phones the pawn was substituted by the
 * emoji font. Vector shapes ship with the app, so the board looks identical
 * everywhere.
 *
 * All shapes are drawn on one 45×45 grid and stand on the same plinth, and
 * take their colours from the `--piece-fill` / `--piece-stroke` custom
 * properties set by `.pw` / `.pb` in App.css.
 *
 * The `viewBox` then crops that grid to the ink: `VIEW_BOX` is the union of
 * all six shapes' bounding boxes plus half a stroke on each side. Drawing on
 * the full 45×45 grid would waste ~40% of each square on empty margin, which
 * is what made the pieces look small on a phone. Cropping to a *shared* box
 * keeps them all on one scale and one baseline — crop per piece and a pawn
 * would come out as tall as a king.
 */

/** Union of the six shapes' ink, plus half the 1.6 stroke on every side. */
const VIEW_BOX = '7.5 3.6 30 38.4';

/** Plinth every piece stands on, so they line up across the board. */
const BASE = 'M 10.8 41.2 L 12.6 34.4 H 32.4 L 34.2 41.2 Z';

const SHAPES: Record<PieceType, React.ReactNode> = {
	p: (
		<>
			<circle cx="22.5" cy="12.6" r="4.4" />
			<path d="M 18.3 16.9 C 18.3 19.4 16.1 20.6 16.1 23.8 C 16.1 27 18.1 28.4 18.1 30.9 H 26.9 C 26.9 28.4 28.9 27 28.9 23.8 C 28.9 20.6 26.7 19.4 26.7 16.9 Z" />
			<path d="M 15.6 30.9 H 29.4 L 30.8 34.4 H 14.2 Z" />
			<path d={BASE} />
		</>
	),
	r: (
		<>
			<path d="M 12.4 13.4 V 7 H 16.9 V 9.9 H 20.4 V 7 H 24.6 V 9.9 H 28.1 V 7 H 32.6 V 13.4 Z" />
			<path d="M 14.4 13.4 H 30.6 V 16.6 H 14.4 Z" />
			<path d="M 16 16.6 L 14.8 30.2 H 30.2 L 29 16.6 Z" />
			<path d="M 13.2 30.2 H 31.8 V 34.4 H 13.2 Z" />
			<path d={BASE} />
		</>
	),
	n: (
		<>
			<path d="M 23.6 9.6 C 27.6 9.6 31.1 12.6 32.6 17 C 33.9 21 33.6 27.7 32.6 34.4 H 16.4 C 16.4 30.2 18 27.1 21 24.6 C 23 22.9 24.3 21.4 25 19.9 L 18.8 21.9 L 16 26.1 C 14.3 26.7 13 25.1 13.6 22.9 C 14.6 19 17 15.7 20.3 13.5 L 21.2 8.8 Z" />
			<ellipse className="piece-detail" cx="20.4" cy="18.2" rx="1.25" ry="1.6" />
			<path d={BASE} />
		</>
	),
	b: (
		<>
			<circle cx="22.5" cy="7.6" r="2.1" />
			<path d="M 22.5 9.7 C 27 12.3 29.6 16.4 29.6 20.7 C 29.6 24.2 26.5 26.6 22.5 26.6 C 18.5 26.6 15.4 24.2 15.4 20.7 C 15.4 16.4 18 12.3 22.5 9.7 Z" />
			<path
				className="piece-detail"
				d="M 19.4 14.9 L 25.2 21.2"
				fill="none"
				strokeLinecap="round"
			/>
			<path d="M 15.4 26.9 C 18 25.4 27 25.4 29.6 26.9 V 30.2 C 27 31.7 18 31.7 15.4 30.2 Z" />
			<path d="M 18.4 30.9 H 26.6 L 27.4 34.4 H 17.6 Z" />
			<path d={BASE} />
		</>
	),
	q: (
		<>
			<circle cx="10.4" cy="11.2" r="2.1" />
			<circle cx="16.4" cy="8.6" r="2.1" />
			<circle cx="22.5" cy="7.6" r="2.3" />
			<circle cx="28.6" cy="8.6" r="2.1" />
			<circle cx="34.6" cy="11.2" r="2.1" />
			<path d="M 10.6 12.8 L 13.6 25.4 H 31.4 L 34.4 12.8 L 29.4 19.4 L 28.4 10.8 L 25 19.8 L 22.5 9.8 L 20 19.8 L 16.6 10.8 L 15.6 19.4 Z" />
			<path d="M 13.2 25.4 H 31.8 C 32.4 28 32.4 30.4 31.8 32.6 H 13.2 C 12.6 30.4 12.6 28 13.2 25.4 Z" />
			<path d="M 13.6 32.6 H 31.4 V 34.4 H 13.6 Z" />
			<path d={BASE} />
		</>
	),
	k: (
		<>
			<path d="M 20.9 4.4 H 24.1 V 7.4 H 27 V 10.6 H 24.1 V 14 H 20.9 V 10.6 H 18 V 7.4 H 20.9 Z" />
			<path d="M 22.5 14.4 C 24 12 27 10.8 29.6 12.2 C 33 14 33.4 19.2 31 23.2 C 29.4 25.8 28.6 27.2 28.4 28.8 H 16.6 C 16.4 27.2 15.6 25.8 14 23.2 C 11.6 19.2 12 14 15.4 12.2 C 18 10.8 21 12 22.5 14.4 Z" />
			<path d="M 13.2 28.8 H 31.8 C 32.4 30.8 32.4 32.6 31.8 34.4 H 13.2 C 12.6 32.6 12.6 30.8 13.2 28.8 Z" />
			<path d={BASE} />
		</>
	)
};

interface Props {
	color: PieceColor;
	type: PieceType;
	/** Extra classes for the wrapping <svg> (animation hooks, layout, …). */
	className?: string;
	/** Label it for assistive tech; omit on boards that label the square instead. */
	titled?: boolean;
}

export default function PieceIcon({ color, type, className = '', titled = false }: Props) {
	const name = `${color === 'w' ? 'White' : 'Black'} ${PIECE_NAME[type]}`;
	return (
		<svg
			viewBox={VIEW_BOX}
			className={`piece-svg ${color === 'w' ? 'pw' : 'pb'} ${className}`.trim()}
			role={titled ? 'img' : 'presentation'}
			aria-label={titled ? name : undefined}
			aria-hidden={titled ? undefined : true}
			focusable="false"
		>
			{titled && <title>{name}</title>}
			<g strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
				{SHAPES[type]}
			</g>
		</svg>
	);
}
