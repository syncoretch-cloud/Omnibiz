import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon.tsx';
import { MediaPicker } from '../../components/Composer.tsx';
import { Empty, ErrorBox, Field, Input, Modal, Placeholder, Select, Spinner, Textarea } from '../../components/ui.tsx';
import { del, get, patch, post } from '../../lib/api.ts';
import type { Json } from '../../lib/api.ts';
import { useAction, useSession } from '../../lib/session.tsx';
import { label, money } from '../../lib/format.ts';

const EMPTY = {
  name: '', description: '', category: '', sale_type: '', price: '', currency: 'TZS', min_order_qty: '', quantity: '', availability: 'in_stock',
  packaging: '', media: [] as string[], city: '', delivery_info: '', delivery_options: ['pickup'], contact_method: '', announce: true,
};

function ProductForm({ product, onClose, onSaved }: { product?: Json; onClose: () => void; onSaved: () => void }) {
  const { me, meta } = useSession();
  const wholesaler = me!.user.account_type === 'wholesaler';
  const [f, setF] = useState<Json>(() =>
    product
      ? { ...EMPTY, ...product, price: product.price, min_order_qty: product.min_order_qty, quantity: product.quantity ?? '', announce: false }
      : { ...EMPTY, sale_type: wholesaler ? 'wholesale' : 'retail', city: me!.user.city ?? '' },
  );
  const [specs, setSpecs] = useState<[string, string][]>(() => Object.entries(product?.specs ?? {}).concat([['', '']]) as [string, string][]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x: Json) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body: Json = {
      ...f,
      price: Number(f.price),
      min_order_qty: f.min_order_qty === '' ? undefined : Number(f.min_order_qty),
      quantity: f.quantity === '' ? null : Number(f.quantity),
      specs: Object.fromEntries(specs.filter(([k, v]) => k.trim() && v.trim())),
    };
    for (const k of ['id', 'seller', 'saved', 'rating', 'location', 'view_count', 'created_at', 'updated_at', 'status', 'distance_km', 'lat', 'lng']) delete body[k];
    if (product) delete body.announce;
    try {
      if (product) await patch(`/products/${product.id}`, body);
      else await post('/products', body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal large title={product ? 'Edit listing' : 'New listing'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{product ? 'Save changes' : 'Publish listing'}</button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Name *" className="span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={150} /></Field>
          <Field label="Category *"><Select value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Choose" options={(meta?.product_categories ?? []).map((c) => ({ value: c.slug, label: c.name }))} /></Field>
          <Field label="Listing type">
            <Select value={f.sale_type} onChange={(e) => set('sale_type', e.target.value)} options={[{ value: 'retail', label: 'Retail product' }, { value: 'wholesale', label: 'Wholesale (bulk)' }, { value: 'service', label: 'Service' }]} />
          </Field>
          <Field label={f.sale_type === 'wholesale' ? 'Wholesale price per unit *' : 'Price *'}><Input type="number" min={0} value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)} options={meta?.currencies ?? ['TZS']} /></Field>
          {f.sale_type === 'wholesale' && <Field label="Minimum order quantity *"><Input type="number" min={1} value={f.min_order_qty} onChange={(e) => set('min_order_qty', e.target.value)} /></Field>}
          {f.sale_type !== 'service' && <Field label="Available quantity" hint="Leave empty if unlimited / on request"><Input type="number" min={0} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>}
          <Field label="Availability"><Select value={f.availability} onChange={(e) => set('availability', e.target.value)} options={['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'on_request'].map((a) => ({ value: a, label: label(a) }))} /></Field>
          {f.sale_type === 'wholesale' && <Field label="Packaging"><Input value={f.packaging ?? ''} onChange={(e) => set('packaging', e.target.value)} placeholder="e.g. Carton of 10" /></Field>}
          <Field label="Description" className="span-2"><Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={5000} /></Field>
          <Field label="Images & videos" className="span-2"><MediaPicker value={f.media} onChange={(v) => set('media', v)} max={12} /></Field>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Specifications</div>
          <div className="stack-sm">
            {specs.map(([k, v], i) => (
              <div key={i} className="row">
                <Input placeholder="e.g. Power" value={k} onChange={(e) => { const s = [...specs]; s[i] = [e.target.value, v]; if (i === specs.length - 1 && e.target.value) s.push(['', '']); setSpecs(s); }} />
                <Input placeholder="e.g. 300 W" value={v} onChange={(e) => { const s = [...specs]; s[i] = [k, e.target.value]; setSpecs(s); }} />
              </div>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Location (city)"><Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} list="product-cities" /><datalist id="product-cities">{meta?.cities.map((c) => <option key={c.name} value={c.name} />)}</datalist></Field>
          <Field label="Contact method"><Input value={f.contact_method ?? ''} onChange={(e) => set('contact_method', e.target.value)} placeholder="e.g. Message or call +255…" /></Field>
          <Field label="Delivery options" className="span-2">
            <div className="row-wrap">
              {['pickup', 'delivery'].map((o) => (
                <label key={o} className="checkbox"><input type="checkbox" checked={f.delivery_options.includes(o)} onChange={(e) => set('delivery_options', e.target.checked ? [...f.delivery_options, o] : f.delivery_options.filter((x: string) => x !== o))} />{label(o)}</label>
              ))}
            </div>
          </Field>
          <Field label="Delivery information" className="span-2"><Textarea value={f.delivery_info ?? ''} onChange={(e) => set('delivery_info', e.target.value)} style={{ minHeight: 60 }} /></Field>
          {!product && <label className="checkbox span-2"><input type="checkbox" checked={f.announce} onChange={(e) => set('announce', e.target.checked)} />Announce this listing to my followers' feeds</label>}
        </div>
      </div>
    </Modal>
  );
}

export function ProductsManager() {
  const act = useAction();
  const { productCategoryName } = useSession();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Json[] | null>(null);
  const load = () => get('/products/mine/all').then((r) => setItems(r.items));
  useEffect(() => { load(); }, []);
  const editId = params.get('edit');
  const creating = params.get('new') === '1';
  const editing = editId ? items?.find((p) => p.id === Number(editId)) : undefined;
  const close = () => setParams({});

  const archive = async (p: Json) => {
    if (confirm(`Archive “${p.name}”? It will be hidden from the marketplace.`) && (await act(() => del(`/products/${p.id}`), 'Listing archived'))) load();
  };
  const restore = async (p: Json) => {
    if (await act(() => patch(`/products/${p.id}`, { status: 'active' }), 'Listing restored')) load();
  };

  return (
    <div className="stack">
      <div className="row-between">
        <h2>Products & services</h2>
        <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Icon name="plus" />New listing</button>
      </div>
      {!items ? <Spinner block /> : !items.length ? (
        <div className="card"><Empty icon="tag" title="No listings yet">Add your first product or service to appear in the marketplace.</Empty></div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Listing</th><th>Price</th><th className="num">Stock</th><th className="num">Views</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="row">
                      <div style={{ width: 44, height: 44, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>{p.media[0] ? <img src={p.media[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder seed={p.category + p.name} />}</div>
                      <div><Link to={`/marketplace/${p.id}`} className="bold small">{p.name}</Link><div className="xsmall muted">{productCategoryName(p.category)} · {label(p.sale_type)}{p.sale_type === 'wholesale' ? ` · MOQ ${p.min_order_qty}` : ''}</div></div>
                    </div>
                  </td>
                  <td className="small">{money(p.price, p.currency)}</td>
                  <td className="num small">{p.quantity ?? '—'}</td>
                  <td className="num small">{p.view_count}</td>
                  <td><span className={`chip ${p.status === 'active' ? 'chip-success' : p.status === 'flagged' ? 'chip-danger' : ''}`}>{label(p.status)}</span></td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <button className="icon-btn" onClick={() => setParams({ edit: String(p.id) })} aria-label="Edit"><Icon name="edit" /></button>
                      {p.status === 'archived' ? <button className="btn btn-ghost btn-sm" onClick={() => restore(p)}>Restore</button> : <button className="icon-btn" onClick={() => archive(p)} aria-label="Archive"><Icon name="trash" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(creating || editing) && <ProductForm product={editing} onClose={close} onSaved={() => { close(); load(); }} />}
    </div>
  );
}
