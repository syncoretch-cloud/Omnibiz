import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon.tsx';
import { MediaPicker } from '../../components/Composer.tsx';
import { Empty, ErrorBox, Field, Input, Select, Spinner, Textarea } from '../../components/ui.tsx';
import { get, post } from '../../lib/api.ts';
import type { Json } from '../../lib/api.ts';
import { useSession, useToast } from '../../lib/session.tsx';
import { ANNOUNCEMENT_LABEL, dateLabel, money, timeAgo } from '../../lib/format.ts';

const PRICE_KINDS = ['price_increase', 'price_decrease'];

export function Announcements() {
  const { me, meta } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<Json[] | null>(null);
  const [products, setProducts] = useState<Json[]>([]);
  const [f, setF] = useState<Json>({ kind: 'price_increase', title: '', body: '', product_id: '', new_price: '', old_price: '', effective_date: '', media: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => get(`/announcements?business=${me!.user.id}`).then((r) => setItems(r.items));
  useEffect(() => {
    load();
    get('/products/mine/all').then((r) => setProducts(r.items.filter((p: Json) => p.status === 'active')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (k: string, v: unknown) => setF((x: Json) => ({ ...x, [k]: v }));
  const product = products.find((p) => p.id === Number(f.product_id));
  const isPrice = PRICE_KINDS.includes(f.kind);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/announcements', {
        kind: f.kind, title: f.title, body: f.body || undefined, media: f.media,
        product_id: f.product_id ? Number(f.product_id) : undefined,
        new_price: f.new_price === '' ? undefined : Number(f.new_price),
        old_price: f.old_price === '' ? undefined : Number(f.old_price),
        effective_date: f.effective_date || undefined,
      });
      toast('Announcement published — relevant customers are being notified', 'success');
      setF({ ...f, title: '', body: '', new_price: '', old_price: '', effective_date: '', media: [] });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h2>Business announcements</h2>
      <div className="card card-pad stack">
        <div className="banner banner-info small"><Icon name="megaphone" />Announcements go to your followers, customers who saved or carted the product, and people interested in your category nearby — not to everyone.</div>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Type"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)} options={(meta?.announcement_kinds ?? []).map((k) => ({ value: k, label: ANNOUNCEMENT_LABEL[k] }))} /></Field>
          <Field label={isPrice ? 'Product *' : 'Related product (optional)'}>
            <Select value={f.product_id} onChange={(e) => set('product_id', e.target.value)} placeholder="None" options={products.map((p) => ({ value: String(p.id), label: `${p.name} (${money(p.price, p.currency)})` }))} />
          </Field>
          <Field label="Headline *" className="span-2"><Input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={160} placeholder={isPrice ? 'e.g. Sunflower oil price update' : 'e.g. New branch opening in Moshi'} /></Field>
          {isPrice && (
            <>
              <Field label="Current price" hint={product ? `Listed at ${money(product.price, product.currency)}` : undefined}><Input type="number" min={0} value={f.old_price} onChange={(e) => set('old_price', e.target.value)} placeholder={product ? String(product.price) : ''} /></Field>
              <Field label="New price *"><Input type="number" min={0} value={f.new_price} onChange={(e) => set('new_price', e.target.value)} /></Field>
            </>
          )}
          <Field label="Effective date"><Input type="date" value={f.effective_date} onChange={(e) => set('effective_date', e.target.value)} /></Field>
          <div />
          <Field label="Details" className="span-2"><Textarea value={f.body} onChange={(e) => set('body', e.target.value)} maxLength={3000} /></Field>
          <Field label="Images" className="span-2"><MediaPicker value={f.media} onChange={(v) => set('media', v)} max={4} accept="image/*" /></Field>
        </div>
        <div className="form-actions"><button className="btn btn-primary" disabled={busy || f.title.length < 3 || (isPrice && (!f.product_id || f.new_price === ''))} onClick={publish}><Icon name="send" />Publish announcement</button></div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Published</h3></div>
        {!items ? <Spinner /> : !items.length ? <Empty icon="megaphone" title="No announcements yet" /> : items.map((a) => (
          <Link key={a.id} to={a.post_id ? `/posts/${a.post_id}` : '#'} className="list-item">
            <div className="notif-icon"><Icon name="megaphone" /></div>
            <div className="grow">
              <div className="xsmall bold" style={{ color: 'var(--accent)' }}>{ANNOUNCEMENT_LABEL[a.kind]}</div>
              <div className="small bold">{a.title}</div>
              <div className="xsmall muted">{a.new_price != null ? `${a.old_price != null ? money(a.old_price, a.currency) + ' → ' : ''}${money(a.new_price, a.currency)} · ` : ''}{a.effective_date ? `effective ${dateLabel(a.effective_date)} · ` : ''}{timeAgo(a.created_at)}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
