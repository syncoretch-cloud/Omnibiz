import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Artwork, postArt, productArt } from '../components/Artwork.tsx';
import { CvManager } from './CvEditor.tsx';
import { useAvatarUpload } from '../components/AvatarUpload.tsx';
import { RichText } from '../components/PostCard.tsx';
import { Avatar, Dropdown, Empty, LoadMore, Modal, Ring, Spinner, Swap, Tabs, Verified, Visibility } from '../components/ui.tsx';
import { JobCard, PersonRow } from '../components/Cards.tsx';
import { ApplicationsOverview } from '../components/Applications.tsx';
import { MapView } from '../components/MapView.tsx';
import { ReportDialog } from '../components/Report.tsx';
import { StoryViewer } from '../components/Stories.tsx';
import { del, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi, usePaged } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { ACCOUNT_LABEL, ANNOUNCEMENT_LABEL, DOC_LABEL, compact, dateLabel, fileSize, label, money, timeAgo } from '../lib/format.ts';

/** "linkedin.com" → "LinkedIn" and so on; anything else shows its domain. */
const SITE_NAMES: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'], [/(^|\.)github\.com$/, 'GitHub'], [/(^|\.)(twitter|x)\.com$/, 'X'], [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)facebook\.com$/, 'Facebook'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)behance\.net$/, 'Behance'],
  [/(^|\.)dribbble\.com$/, 'Dribbble'], [/(^|\.)medium\.com$/, 'Medium'], [/(^|\.)drive\.google\.com$/, 'Google Drive'], [/(^|\.)notion\.(so|site)$/, 'Notion'],
];
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const siteName = (url: string) => { const h = hostOf(url); return SITE_NAMES.find(([re]) => re.test(h))?.[1] ?? h; };

export function CvView({ cv: fullCv, documents: allDocs }: { cv: Json; documents?: Json[] }) {
  // CV files and links to a CV kept online are shown together at the top; the rest of the portfolio stays in its own section.
  const cvFiles = (allDocs ?? []).filter((d) => d.kind === 'cv');
  const documents = (allDocs ?? []).filter((d) => d.kind !== 'cv');
  const cvLinks = ((fullCv.portfolio ?? []) as Json[]).filter((i) => i.kind === 'cv');
  const cv = { ...fullCv, portfolio: ((fullCv.portfolio ?? []) as Json[]).filter((i) => i.kind !== 'cv') };
  const sections: [string, string, string, (d: Json) => React.ReactNode][] = [
    ['experience', 'Experience', 'briefcase', (d) => (
      <>
        <div className="bold">{d.position}</div>
        <div className="small">{d.company}</div>
        <div className="xsmall muted">{d.start_date ?? ''}{d.start_date ? ' – ' : ''}{d.current ? 'Present' : d.end_date ?? ''}</div>
        {d.responsibilities && <div className="small pre" style={{ marginTop: 4 }}>{d.responsibilities}</div>}
      </>
    )],
    ['education', 'Education', 'graduation', (d) => (
      <>
        <div className="bold">{d.school}</div>
        <div className="small">{[label(d.level), d.program].filter(Boolean).join(' · ')}</div>
        <div className="xsmall muted">{[d.start_year, d.end_year].filter(Boolean).join(' – ')}</div>
        {d.achievements && <div className="small pre">{d.achievements}</div>}
      </>
    )],
    ['certification', 'Certifications', 'award', (d) => (
      <>
        <div className="bold">{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.name}</a> : d.name}</div>
        <div className="small muted">{[d.issuer, d.issued_on].filter(Boolean).join(' · ')}</div>
      </>
    )],
    ['portfolio', 'Portfolio', 'layers', (d) => (
      <>
        <div className="bold">{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title}</div>
        {d.description && <div className="small">{d.description}</div>}
        {d.media_url && <img src={d.media_url} alt="" style={{ marginTop: 6, borderRadius: 12, maxHeight: 200 }} />}
      </>
    )],
  ];
  const any = Object.values(cv).some((x) => (x as Json[]).length) || documents.length || cvFiles.length || cvLinks.length;
  if (!any) return <div className="card"><Empty icon="file" title="No professional details yet" /></div>;
  return (
    <div className="stack">
      {(cvFiles.length > 0 || cvLinks.length > 0) && (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>Curriculum vitae</h3>
          <div className="row-wrap">
            {cvFiles.map((d) => <a key={`f${d.id}`} href={d.url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm"><Icon name="file" />{d.name}<span className="xsmall" style={{ opacity: 0.8 }}>{fileSize(d.size)}</span></a>)}
            {cvLinks.map((l) => <a key={`l${l.id}`} href={l.url} target="_blank" rel="noreferrer noopener" className="btn btn-outline btn-sm"><Icon name="link" />{l.title} · {siteName(l.url)}</a>)}
          </div>
        </div>
      )}
      {cv.skill.length > 0 && (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>Skills</h3>
          <div className="row-wrap">{cv.skill.map((s: Json) => <span key={s.id} className="chip chip-brand" title={s.level ? label(s.level) : undefined}>{s.name}</span>)}</div>
        </div>
      )}
      {sections.map(([key, title, icon, render]) => cv[key].length > 0 && (
        <div key={key} className="card card-pad cv-section">
          <h3><Icon name={icon} size={18} />{title}</h3>
          {cv[key].map((d: Json) => (
            <div key={d.id} className="cv-entry">
              <div className="cv-icon"><Icon name={icon} /></div>
              <div className="grow">{render(d)}</div>
              {d.visibility !== 'public' && <Visibility value={d.visibility} />}
            </div>
          ))}
        </div>
      ))}
      {cv.language.length > 0 && (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>Languages</h3>
          <div className="row-wrap">{cv.language.map((l: Json) => <span key={l.id} className="chip">{l.name}{l.proficiency ? ` · ${label(l.proficiency)}` : ''}</span>)}</div>
        </div>
      )}
      {documents.length > 0 && (
        <div className="card">
          <div className="card-header"><h3>Documents</h3></div>
          {documents.map((d) => (
            <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="list-item">
              <span className="cv-icon"><Icon name="file" /></span>
              <div className="grow"><div className="small bold">{d.name}</div><div className="xsmall muted">{DOC_LABEL[d.kind]} · {fileSize(d.size)}</div></div>
              <Visibility value={d.visibility} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowList({ userId, kind, onClose }: { userId: number; kind: 'followers' | 'following'; onClose: () => void }) {
  const { data, loading } = useApi(`/users/${userId}/${kind}`);
  return (
    <Modal title={kind === 'followers' ? 'Followers' : 'Following'} onClose={onClose}>
      {loading ? <Spinner /> : data?.users.length ? <div className="stagger">{data.users.map((u: Json) => <PersonRow key={u.id} u={u} />)}</div> : <Empty icon="users" title="Nobody yet" />}
    </Modal>
  );
}

function PostsGrid({ userId }: { userId: number }) {
  const list = usePaged(`/posts?author=${userId}`);
  if (!list.loading && !list.items.length) return <Empty icon="image" title="No posts yet" />;
  return (
    <>
      <div className="tile-grid">
        {list.items.map((p: Json) => {
          const c = p.repost && !p.body ? p.repost : p;
          return (
            <Link key={p.id} to={`/posts/${p.id}`} className="tile">
              {c.media?.[0] && !/\.(mp4|webm)$/i.test(c.media[0]) ? <img src={c.media[0]} alt="" loading="lazy" /> : <Artwork variant="tile" {...postArt(c)} sub={undefined} />}
              {p.repost && <span className="tile-type"><Icon name="repeat" /></span>}
              {!p.repost && c.media?.length > 1 && <span className="tile-type"><Icon name="layers" /></span>}
              <span className="tile-meta"><span><Icon name="heart" fill />{compact(p.like_count)}</span><span><Icon name="comment" fill />{compact(p.comment_count)}</span></span>
            </Link>
          );
        })}
      </div>
      <div className="mt"><LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} /></div>
    </>
  );
}

function ShopGrid({ userId }: { userId: number }) {
  const list = usePaged(`/products?seller=${userId}`);
  if (!list.loading && !list.items.length) return <Empty icon="bag" title="No products listed" />;
  return (
    <>
      <div className="tile-grid">
        {list.items.map((p: Json) => (
          <Link key={p.id} to={`/marketplace/${p.id}?src=profile`} className="tile">
            {p.media?.[0] ? <img src={p.media[0]} alt="" loading="lazy" /> : <Artwork variant="tile" {...productArt(p, false)} price={undefined} />}
            <span className="tile-type"><Icon name="bag" /></span>
            <span className="tile-meta"><span><Icon name="tag" />{money(p.price, p.currency)}</span></span>
          </Link>
        ))}
      </div>
      <div className="mt"><LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} /></div>
    </>
  );
}

function JobsList({ userId }: { userId: number }) {
  const list = usePaged(`/jobs?company=${userId}`);
  if (!list.loading && !list.items.length) return <Empty icon="briefcase" title="No open vacancies" />;
  return <div className="stack stagger">{list.items.map((j: Json) => <JobCard key={j.id} j={j} />)}</div>;
}

function Updates({ userId }: { userId: number }) {
  const { data, loading } = useApi(`/announcements?business=${userId}`);
  if (loading) return <Spinner block />;
  if (!data?.items.length) return <Empty icon="megaphone" title="No announcements" />;
  return (
    <div className="card">
      {data.items.map((a: Json) => (
        <Link key={a.id} to={a.post_id ? `/posts/${a.post_id}` : '#'} className="list-item" style={{ alignItems: 'flex-start' }}>
          <div className="notif-icon"><Icon name="megaphone" /></div>
          <div className="grow">
            <div className="xsmall bold" style={{ color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{ANNOUNCEMENT_LABEL[a.kind]}</div>
            <div className="bold small">{a.title}</div>
            {a.new_price != null && <div className="small">{a.old_price != null ? `${money(a.old_price, a.currency)} → ` : ''}<b>{money(a.new_price, a.currency)}</b>{a.effective_date ? ` from ${dateLabel(a.effective_date)}` : ''}</div>}
            {a.body && <div className="small muted clamp-2">{a.body}</div>}
            <div className="xsmall muted">{timeAgo(a.created_at)}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function About({ data }: { data: Json }) {
  const { industryName } = useSession();
  const b = data.business;
  const p = data.profile;
  const u = data.user;
  if (!b) {
    return (
      <div className="stack">
        {p?.summary && <div className="card card-pad"><h3 style={{ marginBottom: 8 }}>About</h3><p className="pre"><RichText text={p.summary} /></p></div>}
        {p && (p.email || p.phone || p.dob || p.preferred_industries.length > 0) && (
          <div className="grid-2">
            {(p.email || p.phone || p.dob) && (
              <div className="card card-pad stack-sm small">
                <div className="section-title">Contact</div>
                {p.email && <a href={`mailto:${p.email}`} className="row"><Icon name="mail" size={16} />{p.email}</a>}
                {p.phone && <a href={`tel:${p.phone}`} className="row"><Icon name="phone" size={16} />{p.phone}</a>}
                {p.dob && <div className="row"><Icon name="calendar" size={16} />Born {dateLabel(p.dob)}</div>}
              </div>
            )}
            {(p.preferred_industries.length > 0 || p.preferred_locations.length > 0) && (
              <div className="card card-pad stack-sm small">
                <div className="section-title">Looking for</div>
                {p.job_types.length > 0 && <div>{p.job_types.map(label).join(', ')} roles</div>}
                <div className="row-wrap">{p.preferred_industries.map((s: string) => <span key={s} className="chip">{industryName(s)}</span>)}</div>
                {p.preferred_locations.length > 0 && <div className="muted">In {p.preferred_locations.join(', ')}</div>}
              </div>
            )}
          </div>
        )}
        {data.cv && <CvView cv={data.cv} documents={data.documents} />}
      </div>
    );
  }
  return (
    <div className="stack">
      {b.description && <div className="card card-pad"><h3 style={{ marginBottom: 8 }}>About {b.name}</h3><p className="pre"><RichText text={b.description} /></p></div>}
      <div className="grid-2">
        <div className="card card-pad stack-sm small">
          <div className="section-title">Contact</div>
          {b.contact_email && <a href={`mailto:${b.contact_email}`} className="row"><Icon name="mail" size={16} />{b.contact_email}</a>}
          {b.contact_phone && <a href={`tel:${b.contact_phone}`} className="row"><Icon name="phone" size={16} />{b.contact_phone}</a>}
          {b.website && <a href={b.website} target="_blank" rel="noreferrer noopener" className="row"><Icon name="globe" size={16} />{b.website.replace(/^https?:\/\//, '')}</a>}
          {b.address && <div className="row"><Icon name="mapPin" size={16} />{b.address}</div>}
          {b.opening_hours && <div className="row"><Icon name="clock" size={16} />{b.opening_hours}</div>}
          {b.employee_count && <div className="row"><Icon name="users" size={16} />{b.employee_count} employees</div>}
          {b.founded_year && <div className="row"><Icon name="calendar" size={16} />Founded {b.founded_year}</div>}
          {b.verified ? <div className="row" style={{ color: 'var(--verified)' }}><Icon name="shieldCheck" size={16} />Verified business</div> : null}
        </div>
        {data.location && <MapView className="map map-sm" center={[data.location.lat, data.location.lng]} zoom={14} pins={[{ id: u.id, lat: data.location.lat, lng: data.location.lng, title: u.display_name, subtitle: b.address, letter: u.display_name[0], color: '#6d324f' }]} />}
      </div>
      {b.services.length > 0 && <div className="card card-pad"><h3 style={{ marginBottom: 12 }}>Services</h3><div className="row-wrap">{b.services.map((s: string) => <span key={s} className="chip chip-brand">{s}</span>)}</div></div>}
      {(b.product_lines.length > 0 || b.wholesale_categories.length > 0) && (
        <div className="card card-pad"><h3 style={{ marginBottom: 12 }}>{u.account_type === 'wholesaler' ? 'Wholesale categories' : 'Product lines'}</h3><div className="row-wrap">{[...new Set([...b.product_lines, ...b.wholesale_categories])].map((s) => <span key={s as string} className="chip">{s as string}</span>)}</div></div>
      )}
      {b.portfolio_links.length > 0 && <div className="card card-pad stack-sm"><h3>Portfolio</h3>{b.portfolio_links.map((l: string) => <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="row small"><Icon name="link" size={16} />{l.replace(/^https?:\/\//, '')}</a>)}</div>}
    </div>
  );
}

/** Your own CV: edit it right here, or preview it the way recruiters see it. */
function SelfCv({ data, onPreview }: { data: Json; onPreview: () => void }) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const choose = (m: 'edit' | 'preview') => { setMode(m); if (m === 'preview') onPreview(); };
  return (
    <div className="stack">
      <div className="row-wrap">
        <button className={`chip${mode === 'edit' ? ' active' : ''}`} onClick={() => choose('edit')}><Icon name="edit" />Edit</button>
        <button className={`chip${mode === 'preview' ? ' active' : ''}`} onClick={() => choose('preview')}><Icon name="eye" />Preview</button>
      </div>
      {mode === 'edit' ? <CvManager /> : <About data={data} />}
    </div>
  );
}

export default function Profile() {
  const { username } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { me, can, industryName } = useSession();
  const act = useAction();
  const { data, loading, error, setData, reload } = useApi(`/users/${username}${params.get('src') ? `?src=${params.get('src')}` : ''}`);
  const storyRes = useApi(data?.user ? `/stories/user/${data.user.id}` : null);
  const [viewing, setViewing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [followList, setFollowList] = useState<'followers' | 'following' | null>(null);
  const pic = useAvatarUpload();

  if (loading && !data) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="user" title="Profile not found">{error.message}</Empty></div></main>;

  const u = data.user;
  const b = data.business;
  const p = data.profile;
  const self = data.viewer.is_self;
  const isBiz = !!b;
  const story = storyRes.data?.story;
  const storySeen = story ? story.all_seen : true;

  const tabDefs: { id: string; label: string; icon: IconName }[] = [
    { id: 'posts', label: 'Posts', icon: 'grid' },
    ...(isBiz ? [{ id: 'shop', label: 'Shop', icon: 'bag' as const }] : []),
    ...(u.account_type === 'company' ? [{ id: 'jobs', label: 'Jobs', icon: 'briefcase' as const }] : []),
    ...(isBiz ? [{ id: 'updates', label: 'Updates', icon: 'megaphone' as const }] : []),
    { id: 'about', label: isBiz ? 'About' : 'CV', icon: isBiz ? 'info' : 'file' },
    // Only you see your own applications: unfinished forms and ones waiting for a decision.
    ...(self && can('apply_jobs') ? [{ id: 'applications', label: 'Applications', icon: 'send' as const }] : []),
  ];
  const ids = tabDefs.map((t) => t.id);
  const tab = params.get('tab') && ids.includes(params.get('tab')!) ? params.get('tab')! : 'posts';
  const setTab = (t: string) => setParams(t === 'posts' ? {} : { tab: t }, { replace: true });

  const toggleFollow = async () => {
    const following = !data.viewer.following;
    const r = await act(() => (following ? post(`/users/${u.id}/follow`) : del(`/users/${u.id}/follow`)));
    if (r) setData({ ...data, viewer: { ...data.viewer, following }, stats: { ...data.stats, followers: data.stats.followers + (following ? 1 : -1) } });
  };
  const message = async () => {
    const r = await act(() => post('/messages/start', { user_id: u.id }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };
  const saveBiz = async () => {
    const saved = !data.viewer.saved;
    if (await act(() => (saved ? post('/saves', { target_type: 'business', target_id: u.id }) : del('/saves', { target_type: 'business', target_id: u.id })), saved ? 'Business saved' : undefined)) {
      setData({ ...data, viewer: { ...data.viewer, saved } });
    }
  };

  const highlights: [string, string, () => void, boolean?][] = isBiz
    ? [
        ['Shop', 'bag', () => setTab('shop')],
        ...(u.account_type === 'company' ? [['Jobs', 'briefcase', () => setTab('jobs'), true] as [string, string, () => void, boolean]] : []),
        ['Updates', 'megaphone', () => setTab('updates')],
        ['Location', 'mapPin', () => setTab('about'), true],
        ...(!self && can('message') ? [['Contact', 'send', message] as [string, string, () => void]] : []),
      ]
    : u.account_type === 'personal'
      ? [['CV', 'file', () => setTab('about')], ['Skills', 'zap', () => setTab('about'), true], ...(!self && can('message') ? [['Message', 'send', message] as [string, string, () => void]] : [])]
      : [];

  const avatar = <Avatar user={u} size={120} />;
  // Under the bio: contact details and links. A business shows its website and links; a person shows what they chose to make public
  // (email, phone, links), their CV, and the links in their public portfolio.
  type HeadLink = { href: string; label: string; icon: string; external: boolean };
  const links: HeadLink[] = [];
  const addLink = (href: string, label: string, icon: string, external = true) => { if (href && !links.some((l) => l.href === href)) links.push({ href, label, icon, external }); };
  if (isBiz) {
    if (b.website) addLink(b.website, hostOf(b.website), 'globe');
    ((b.portfolio_links ?? []) as string[]).forEach((l) => addLink(l, siteName(l), 'link'));
  } else {
    if (u.public_email) addLink(`mailto:${u.public_email}`, u.public_email, 'mail', false);
    if (u.public_phone) addLink(`tel:${u.public_phone}`, u.public_phone, 'phone', false);
    ((u.links ?? []) as string[]).forEach((l, k) => addLink(l, siteName(l), k === 0 && !/linkedin|github|instagram|facebook|twitter|x\.com|youtube|tiktok/.test(l) ? 'globe' : 'link'));
    ((data.documents ?? []) as Json[]).filter((d) => d.kind === 'cv').forEach((d) => addLink(d.url, 'CV', 'file'));
    ((data.cv?.portfolio ?? []) as Json[]).filter((i) => i.url).forEach((i) => addLink(i.url as string, i.kind === 'cv' ? `CV · ${siteName(i.url)}` : (i.title as string) || siteName(i.url), i.kind === 'cv' ? 'file' : 'link'));
  }
  const category = isBiz ? `${b.category === 'other' && b.custom_category ? b.custom_category : industryName(b.category)} · ${ACCOUNT_LABEL[u.account_type]}` : p?.headline || ACCOUNT_LABEL[u.account_type];
  return (
    <main className="page page-profile">
      <section className="profile-hero">
        <div className="profile-avatar">
          {story ? <Ring seen={storySeen} square={isBiz} onClick={() => setViewing(true)} title="View story">{avatar}</Ring> : avatar}
          {self && (
            <>
              <button type="button" className="avatar-cam" onClick={pic.open} disabled={pic.busy} aria-label={pic.has ? 'Change profile picture' : 'Add a profile picture'} title={pic.has ? 'Change profile picture' : 'Add a profile picture'}><Icon name="camera" /></button>
              {pic.field}
            </>
          )}
        </div>
        <div className="profile-names">
          <h1 className="row" style={{ gap: 8 }}>{u.display_name}<Verified show={b?.verified || u.verified} /></h1>
          <div className="profile-handle">@{u.username}</div>
          <div className="profile-role">{category}</div>
        </div>
      <div className="profile-cta">
          {self ? (
            <>
              <Link to={isBiz ? '/settings/business' : '/settings/account'} className="btn btn-sm btn-primary"><Icon name="edit" />Edit profile</Link>
              {isBiz && <Link to="/dashboard" className="btn btn-sm btn-outline"><Icon name="chart" />Dashboard</Link>}
              {can('manage_cv') && <button className="btn btn-sm btn-outline" onClick={() => setTab('about')}><Icon name="file" />Edit CV</button>}
              <Link to="/settings" className="btn btn-sm btn-ghost btn-icon" aria-label="Settings"><Icon name="settings" /></Link>
            </>
          ) : (
            <>
              {can('follow') && <button className={`btn btn-sm${data.viewer.following ? ' btn-outline' : ' btn-primary'}`} onClick={toggleFollow}>{data.viewer.following ? <><Icon name="check" />Following</> : <><Icon name="plus" />Follow</>}</button>}
              {can('message') && <button className="btn btn-sm btn-outline" onClick={message}><Icon name="message" />Message</button>}
              {isBiz && b.website && <a href={b.website} target="_blank" rel="noreferrer noopener" className="btn btn-sm btn-outline btn-icon" aria-label="Website"><Icon name="globe" /></a>}
              <Dropdown trigger={() => <button className="btn btn-sm btn-ghost btn-icon" aria-label="More"><Icon name="more" /></button>}>
                {isBiz && can('save') && <button onClick={saveBiz}><Icon name="bookmark" />{data.viewer.saved ? 'Unsave business' : 'Save business'}</button>}
                <button onClick={() => navigator.clipboard?.writeText(`${location.origin}/u/${u.username}`)}><Icon name="link" />Copy profile link</button>
                <button onClick={() => setReporting(true)}><Icon name="flag" />Report</button>
              </Dropdown>
            </>
          )}
        </div>
        <div className="profile-body">
          {u.bio && <p className="profile-about pre"><RichText text={u.bio} /></p>}
          {links.length > 0 && (
            <div className="profile-links">
              {links.slice(0, 6).map((l) => (
                <a key={l.href} href={l.href} {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})} className="profile-link" title={l.href.replace(/^(mailto|tel):/, '')}><Icon name={l.icon} />{l.label}</a>
              ))}
              {links.length > 6 && <button className="profile-link more" onClick={() => setTab('about')}>+{links.length - 6} more</button>}
            </div>
          )}
          <div className="profile-facts">
            {(u.city || u.country) && <span className="chip"><Icon name="mapPin" />{[u.city, u.country].filter(Boolean).join(', ')}</span>}
            {isBiz && b.opening_hours && <span className="chip"><Icon name="clock" />{b.opening_hours}</span>}
            {p?.open_to_work && <span className="chip chip-success"><Icon name="briefcase" />Open to work</span>}
          </div>
          <div className="profile-stats">
            <div><b>{compact(data.stats.posts)}</b> {data.stats.posts === 1 ? 'post' : 'posts'}</div>
            <button onClick={() => setFollowList('followers')}><b>{compact(data.stats.followers)}</b> {data.stats.followers === 1 ? 'follower' : 'followers'}</button>
            <button onClick={() => setFollowList('following')}><b>{compact(data.stats.following)}</b> following</button>
            {data.rating?.count > 0 && <div className="profile-rating" title={`${data.rating.avg} out of 5`}><b>{data.rating.avg}<span className="stars"> ★</span></b><span>{data.rating.count} review{data.rating.count === 1 ? '' : 's'}</span></div>}
          </div>
        </div>
      </section>

      {highlights.length > 0 && (
        <div className="quick-links">
          {highlights.map(([text, icon, onClick]) => (
            <button key={text} className="quick-link" onClick={onClick}><Icon name={icon} />{text}</button>
          ))}
        </div>
      )}

      <Tabs tabs={tabDefs} value={tab} onChange={setTab} />
      <div style={{ marginTop: 18 }}>
        <Swap k={tab} order={ids}>
          {tab === 'posts' && <PostsGrid userId={u.id} />}
          {tab === 'shop' && <ShopGrid userId={u.id} />}
          {tab === 'jobs' && <JobsList userId={u.id} />}
          {tab === 'updates' && <Updates userId={u.id} />}
          {tab === 'about' && (self && !isBiz && can('manage_cv') ? <SelfCv data={data} onPreview={reload} /> : <About data={data} />)}
          {tab === 'applications' && <ApplicationsOverview />}
        </Swap>
      </div>

      {viewing && story && <StoryViewer stories={[story]} start={0} onClose={() => { setViewing(false); storyRes.reload(); }} />}
      {reporting && <ReportDialog targetType="user" targetId={u.id} onClose={() => setReporting(false)} />}
      {followList && <FollowList userId={u.id} kind={followList} onClose={() => setFollowList(null)} />}
    </main>
  );
}
