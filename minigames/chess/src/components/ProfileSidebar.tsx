import { avatarHue, initials } from '../data/students';

export interface SideProfile {
  key: string;
  /** Small label above the card: 'Opponent' / 'You' / color. */
  tag: string;
  firstName: string;
  lastName: string;
  faculty: string;
  group: string;
  photo: string | null;
  colorLabel: string;
  ready?: boolean;
  isTurn?: boolean;
}

function ProfileCard({ p }: { p: SideProfile }) {
  const fullName = `${p.firstName} ${p.lastName}`.trim();

  return (
    <section className={`profile-card${p.isTurn ? ' turn' : ''}`} aria-label={`${p.tag}: ${fullName}`}>
      <span className="profile-tag">{p.tag}</span>
      <div className="profile-avatar">
        {p.photo ? (
          <img src={p.photo} alt={fullName} />
        ) : (
          <span
            className="profile-initials"
            style={{ background: `hsl(${avatarHue(fullName)} 40% 32%)` }}
          >
            {initials(p.firstName, p.lastName)}
          </span>
        )}
      </div>
      <h3 className="profile-name">
        {p.firstName}
        {p.lastName && (
          <>
            <br />
            {p.lastName}
          </>
        )}
      </h3>
      <p className="profile-meta">
        Faculty:
        <br />
        {p.faculty}
        <br />
        Group: {p.group}
      </p>
      <div className="profile-foot">
        <span className="player-tag">{p.colorLabel}</span>
        {p.ready !== undefined &&
          (p.ready ? (
            <span className="ready-yes">Ready ✓</span>
          ) : (
            <span className="ready-no">Not ready</span>
          ))}
      </div>
    </section>
  );
}

export default function ProfileSidebar({
  top,
  bottom,
}: {
  /** Opponent — upper side. */
  top: SideProfile;
  /** Current user — lower side. */
  bottom: SideProfile;
}) {
  return (
    <aside className="profiles" aria-label="Players">
      <ProfileCard key={top.key} p={top} />
      <div className="versus" aria-hidden="true">
        <span>VS</span>
      </div>
      <ProfileCard key={bottom.key} p={bottom} />
    </aside>
  );
}
