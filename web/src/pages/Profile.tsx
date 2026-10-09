import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Artwork, postArt, productArt } from '../components/Artwork.tsx';
import { Avatar, Dropdown, Empty, LoadMore, Modal, Ring, Spinner, Stars, Swap, Tabs, Verified, Visibility } from '../components/ui.tsx';
import { JobCard, PersonRow } from '../components/Cards.tsx';
import { MapView } from '../components/MapView.tsx';
import { ReportDialog } from '../components/Report.tsx';
import { StoryViewer, useSeenStories } from '../components/Stories.tsx';
import { del, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi, usePaged } from '../lib/hooks.ts';
import { useAction, useSession } from '../lib/session.tsx';
import { ACCOUNT_LABEL, ANNOUNCEMENT_LABEL, DOC_LABEL, compact, dateLabel, fileSize, label, money, timeAgo } from '../lib/format.ts';

export function CvView({ cv, documents }: { cv: Json; documents?: Json[] }) {
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
  const any = Object.values(cv).some((x) => (x as Json[]).length) || documents?.length;
  if (!any) return <div className="card"><Empty icon="file" title="No professional details yet" /></div>;
  return (
    <div className="stack">
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
      {documents && documents.length > 0 && (
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
      <div className="ig-grid">
        {list.items.map((p: Json) => {
          const c = p.repost && !p.body ? p.repost : p;
          return (
            <Link key={p.id} to={`/posts/${p.id}`} className="tile">
              {c.media?.[0] && !/\.(mp4|webm)$/i.test(c.media[0]) ? <img src={c.media[0]} alt="" loading="lazy" /> : <Artwork variant="tile" {...postArt(c)} sub={undefined} />}
              {p.repost && <span className="tile-type"><Icon name="repeat" /></span>}
              {!p.repost && c.media?.length > 1 && <span className="tile-type"><Icon name="layers" /></span>}
              <span className="tile-over"><span><Icon name="heart" fill />{compact(p.like_count)}</span><span><Icon name="comment" fill />{compact(p.comment_count)}</span></span>
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
      <div className="ig-grid">
        {list.items.map((p: Json) => (
          <Link key={p.id} to={`/marketplace/${p.id}?src=profile`} className="tile">
            {p.media?.[0] ? <img src={p.media[0]} alt="" loading="lazy" /> : <Artwork variant="tile" {...productArt(p, false)} />}
            <span className="tile-type"><Icon name="bag" /></span>
            <span className="tile-over"><span><Icon name="tag" />{money(p.price, p.currency)}</span></span>
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
        {p?.summary && <div className="card card-pad"><h3 style={{ marginBottom: 8 }}>About</h3><p className="pre">{p.summary}</p></div>}
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
      {b.description && <div className="card card-pad"><h3 style={{ marginBottom: 8 }}>About {b.name}</h3><p className="pre">{b.description}</p></div>}
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

export default function Profile() {
  const { username } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { me, can, industryName } = useSession();
  const act = useAction();
  const { data, loading, error, setData } = useApi(`/users/${username}${params.get('src') ? `?src=${params.get('src')}` : ''}`);
  const storyRes = useApi(data?.user ? `/reels/stories/${data.user.id}` : null);
  const { seen, mark } = useSeenStories(me!.user.id);
  const [viewing, setViewing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [followList, setFollowList] = useState<'followers' | 'following' | null>(null);

  if (loading && !data) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="user" title="Profile not found">{error.message}</Empty></div></main>;

  const u = data.user;
  const b = data.business;
  const p = data.profile;
  const self = data.viewer.is_self;
  const isBiz = !!b;
  const story = storyRes.data?.story;
  const storySeen = story ? (seen[u.id] ?? 0) >= story.latest_id : true;

  const tabDefs: { id: string; label: React.ReactNode }[] = [
    { id: 'posts', label: <><Icon name="grid" /><span className="tab-text">Posts</span></> },
    ...(isBiz ? [{ id: 'shop', label: <><Icon name="bag" /><span className="tab-text">Shop</span></> }] : []),
    ...(u.account_type === 'company' ? [{ id: 'jobs', label: <><Icon name="briefcase" /><span className="tab-text">Jobs</span></> }] : []),
    ...(isBiz ? [{ id: 'updates', label: <><Icon name="megaphone" /><span className="tab-text">Updates</span></> }] : []),
    { id: 'about', label: <><Icon name={isBiz ? 'info' : 'file'} /><span className="tab-text">{isBiz ? 'About' : 'CV'}</span></> },
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
      ? [['CV', 'file', () => setTab('about')], ['Skills', 'zap', () => setTab('about'), true], ...(!self && can('message') ? [['Message', 'send', message] as [string, string, () => void]] : []), ...(self ? [['Edit CV', 'edit', () => nav('/me/cv'), true] as [string, string, () => void, boolean]] : [])]
      : [];

  const avatar = <Avatar user={u} size={150} />;
  return (
    <main className="page page-mid">
      <section className="profile-top">
        <div className="avatar-col">
          {story ? <Ring seen={storySeen} square={isBiz} onClick={() => setViewing(true)} title="View story">{avatar}</Ring> : <div style={{ borderRadius: isBiz ? '32%' : '50%', boxShadow: 'var(--neu)', padding: 6, background: 'var(--surface)' }}>{avatar}</div>}
        </div>
        <div>
          <div className="profile-name">
            <h1>{u.username}</h1>
            <Verified show={b?.verified} />
            {self ? (
              <>
                <Link to={isBiz ? '/settings/business' : '/settings/account'} className="btn btn-sm">Edit profile</Link>
                {isBiz && <Link to="/dashboard" className="btn btn-sm">Dashboard</Link>}
                {can('manage_cv') && <Link to="/me/cv" className="btn btn-sm hide-mobile">Edit CV</Link>}
                <Link to="/menu" className="icon-btn show-mobile" aria-label="Menu"><Icon name="menu" /></Link>
                <Link to="/settings" className="icon-btn hide-mobile" aria-label="Settings"><Icon name="settings" /></Link>
              </>
            ) : (
              <>
                {can('follow') && <button className={`btn btn-sm${data.viewer.following ? '' : ' btn-primary'}`} onClick={toggleFollow}>{data.viewer.following ? <>Following <Icon name="chevronDown" /></> : 'Follow'}</button>}
                {can('message') && <button className="btn btn-sm" onClick={message}>Message</button>}
                {isBiz && b.website && <a href={b.website} target="_blank" rel="noreferrer noopener" className="btn btn-sm btn-icon" aria-label="Website"><Icon name="globe" /></a>}
                <Dropdown trigger={() => <button className="icon-btn" aria-label="More"><Icon name="more" /></button>}>
                  {isBiz && can('save') && <button onClick={saveBiz}><Icon name="bookmark" />{data.viewer.saved ? 'Unsave business' : 'Save business'}</button>}
                  <button onClick={() => navigator.clipboard?.writeText(`${location.origin}/u/${u.username}`)}><Icon name="link" />Copy profile link</button>
                  <button onClick={() => setReporting(true)}><Icon name="flag" />Report</button>
                </Dropdown>
              </>
            )}
          </div>
          <div className="profile-stats">
            <span><b>{compact(data.stats.posts)}</b> {data.stats.posts === 1 ? 'post' : 'posts'}</span>
            <button onClick={() => setFollowList('followers')}><b>{compact(data.stats.followers)}</b> {data.stats.followers === 1 ? 'follower' : 'followers'}</button>
            <button onClick={() => setFollowList('following')}><b>{compact(data.stats.following)}</b> following</button>
          </div>
        </div>
        <div className="profile-bio">
          <b>{u.display_name}</b>
          <span className="cat">
            {isBiz ? `${b.category === 'other' && b.custom_category ? b.custom_category : industryName(b.category)} · ${ACCOUNT_LABEL[u.account_type]}` : p?.headline || ACCOUNT_LABEL[u.account_type]}
          </span>
          {u.bio && <span className="pre">{u.bio}</span>}
          {isBiz && b.website && <a href={b.website} target="_blank" rel="noreferrer noopener" className="bold" style={{ color: 'var(--info)' }}>{b.website.replace(/^https?:\/\//, '')}</a>}
          <span className="row-wrap muted small" style={{ gap: 10 }}>
            {(u.city || u.country) && <span className="row" style={{ gap: 4 }}><Icon name="mapPin" size={14} />{[u.city, u.country].filter(Boolean).join(', ')}</span>}
            {data.rating?.count > 0 && <span><Stars value={data.rating.avg} /> {data.rating.avg} ({data.rating.count})</span>}
            {p?.open_to_work && <span className="chip chip-success"><Icon name="briefcase" />Open to work</span>}
          </span>
        </div>
      </section>

      {highlights.length > 0 && (
        <div className="highlights">
          {highlights.map(([text, icon, onClick, brown]) => (
            <button key={text} className={`highlight${brown ? ' brown' : ''}`} onClick={onClick}>
              <span className="hl-ring"><div><Icon name={icon} /></div></span>
              {text}
            </button>
          ))}
        </div>
      )}

      <Tabs variant="line" tabs={tabDefs} value={tab} onChange={setTab} />
      <div style={{ marginTop: 18 }}>
        <Swap k={tab} order={ids}>
          {tab === 'posts' && <PostsGrid userId={u.id} />}
          {tab === 'shop' && <ShopGrid userId={u.id} />}
          {tab === 'jobs' && <JobsList userId={u.id} />}
          {tab === 'updates' && <Updates userId={u.id} />}
          {tab === 'about' && <About data={data} />}
        </Swap>
      </div>

      {viewing && story && <StoryViewer stories={[story]} start={0} onClose={() => setViewing(false)} onSeen={mark} />}
      {reporting && <ReportDialog targetType="user" targetId={u.id} onClose={() => setReporting(false)} />}
      {followList && <FollowList userId={u.id} kind={followList} onClose={() => setFollowList(null)} />}
    </main>
  );
}
