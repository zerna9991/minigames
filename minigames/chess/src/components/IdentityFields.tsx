import type { PlayerIdentity } from '../net/api';

const inputStyle: React.CSSProperties = {
	width: '100%',
	boxSizing: 'border-box',
	padding: '10px 12px',
	borderRadius: 8,
	border: '1px solid rgba(217,217,217,0.25)',
	background: 'rgba(255,255,255,0.06)',
	color: 'inherit',
	font: '500 14px Montserrat, sans-serif'
};

const labelStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: 6,
	fontSize: 12,
	fontWeight: 700,
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	opacity: 0.85
};

/** Portal identity form (dev): student ID + session token. Persisted to
 *  sessionStorage by the caller via `onChange`. */
export default function IdentityFields({
	value,
	onChange,
	disabled,
	hideToken = false
}: {
	value: PlayerIdentity;
	onChange: (next: PlayerIdentity) => void;
	disabled?: boolean;
	/** Token is generated for the player — don't show or allow editing it. */
	hideToken?: boolean;
}) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<label style={labelStyle}>
				Student ID
				<input
					style={inputStyle}
					placeholder="CS0103125"
					autoComplete="username"
					value={value.studentId}
					disabled={disabled}
					onChange={(e) => onChange({ ...value, studentId: e.target.value.toUpperCase() })}
				/>
			</label>
			{!hideToken && (
				<label style={labelStyle}>
					Portal session token
					<input
						style={inputStyle}
						type="password"
						placeholder="dev: any non-blank token works"
						autoComplete="current-password"
						value={value.sessionToken}
						disabled={disabled}
						onChange={(e) => onChange({ ...value, sessionToken: e.target.value })}
					/>
				</label>
			)}
		</div>
	);
}
