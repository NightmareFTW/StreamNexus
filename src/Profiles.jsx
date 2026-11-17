import { useEffect, useRef, useState } from 'react';
import { BrandFlow, Icon } from './ui.jsx';
import { DEFAULT_PROFILE_ID, PROFILE_COLORS, deleteProfileData, newProfileId, saveProfiles } from './profiles.js';

const initialOf = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
export const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦄', '🐧', '🐨', '🐵', '🦉', '🐢', '🚀', '🎮', '🎬', '🎧', '📚', '⚽', '🎨', '🌙', '🔥', '🍿', '🤖', '👾'];

// Avatar do perfil: imagem carregada, emoji escolhido ou a inicial do nome
export function ProfileAvatar({ profile, size = 40 }) {
  const avatar = profile.avatar;
  if (avatar?.type === 'image' && avatar.data) return <span className="profile-avatar profile-avatar-image" role="img" aria-label={profile.name} style={{ width: size, height: size, backgroundImage: `url(${avatar.data})` }}></span>;
  if (avatar?.type === 'emoji' && avatar.value) return <span className="profile-avatar" role="img" aria-label={profile.name} style={{ '--avatar': profile.color, width: size, height: size, fontSize: Math.round(size * 0.56) }}>{avatar.value}</span>;
  return <span className="profile-avatar" style={{ '--avatar': profile.color, width: size, height: size, fontSize: Math.round(size * 0.44) }}>{initialOf(profile.name)}</span>;
}

const FRAME = 300; // lado do quadro de recorte (px)

// Editor de recorte: arrastar para mover, zoom com o controlo ou a roda do rato; o resultado é um quadrado de 256 px
function AvatarCropper({ src, onCancel, onApply }) {
  const frameRef = useRef(null);
  const drag = useRef(null);
  const [dims, setDims] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    const image = new Image();
    image.onload = () => setDims({ w: image.naturalWidth, h: image.naturalHeight });
    image.onerror = () => setError('Não foi possível abrir esta imagem.');
    image.src = src;
  }, [src]);

  const base = dims ? Math.max(FRAME / dims.w, FRAME / dims.h) : 1;
  const scale = base * zoom;
  const clamp = (value, nextScale = scale) => {
    const maxX = Math.max(0, (dims.w * nextScale - FRAME) / 2);
    const maxY = Math.max(0, (dims.h * nextScale - FRAME) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, value.x)), y: Math.max(-maxY, Math.min(maxY, value.y)) };
  };
  const changeZoom = (value) => {
    if (!dims) return;
    const next = Math.max(1, Math.min(4, value));
    setZoom(next);
    setOffset((current) => clamp(current, base * next));
  };

  // a roda do rato precisa de um ouvinte não passivo para não deslocar a página
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const onWheel = (event) => { event.preventDefault(); changeZoom(zoomRef.current - event.deltaY * 0.0015); };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  });

  const down = (event) => { if (!dims) return; event.currentTarget.setPointerCapture?.(event.pointerId); drag.current = { sx: event.clientX, sy: event.clientY, ox: offset.x, oy: offset.y }; };
  const move = (event) => { if (!drag.current || !dims) return; setOffset(clamp({ x: drag.current.ox + event.clientX - drag.current.sx, y: drag.current.oy + event.clientY - drag.current.sy })); };
  const up = () => { drag.current = null; };

  const apply = async () => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const k = 256 / FRAME;
    const dw = dims.w * scale * k; const dh = dims.h * scale * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(image, 128 + offset.x * k - dw / 2, 128 + offset.y * k - dh / 2, dw, dh);
    onApply(canvas.toDataURL('image/jpeg', 0.88));
  };

  // pré-visualização em CSS com a mesma transformação, a dois tamanhos
  const preview = (size) => { const k = size / FRAME; const dw = dims.w * scale * k; const dh = dims.h * scale * k; return { width: size, height: size, borderRadius: Math.round(size * 0.1), backgroundImage: `url(${src})`, backgroundRepeat: 'no-repeat', backgroundSize: `${dw}px ${dh}px`, backgroundPosition: `${size / 2 + offset.x * k - dw / 2}px ${size / 2 + offset.y * k - dh / 2}px` }; };

  return <div className="avatar-cropper">
    {error && <p className="is-error-text">{error}</p>}
    <div className="avatar-cropper-body">
      <div ref={frameRef} className="avatar-frame" style={{ width: FRAME, height: FRAME }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Arrasta para mover a imagem">
        {dims && <img src={src} alt="" draggable={false} style={{ width: dims.w, height: dims.h, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}/>}
        <span className="avatar-frame-grid" aria-hidden="true"></span>
      </div>
      {dims && <div className="avatar-previews"><span>Como vai ficar</span><i style={preview(96)}></i><i style={preview(40)}></i></div>}
    </div>
    <label className="avatar-zoom"><Icon name="search" size={14}/><input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} aria-label="Zoom"/><span>{Math.round(zoom * 100)}%</span></label>
    <small className="profile-hint">Arrasta a imagem para a centrar e usa o zoom (ou a roda do rato) para enquadrar.</small>
    <div className="profile-edit-actions">
      <button type="button" className="button button-primary" disabled={!dims} onClick={apply}>Usar esta imagem</button>
      <button type="button" className="button button-glass" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Repor</button>
      <button type="button" className="button button-quiet" onClick={onCancel}>Cancelar</button>
    </div>
  </div>;
}

// Ecrã "Quem está a ver?" (e gestão de perfis). Cada perfil tem a sua lista, o seu histórico e as suas preferências.
export function ProfileGate({ profiles, onProfiles, onChoose, startManaging = false, canCancel = false, onCancel }) {
  const [managing, setManaging] = useState(startManaging);
  const [editing, setEditing] = useState(null); // { id, name, color, kids, avatar, isNew }
  const [confirmDelete, setConfirmDelete] = useState('');
  const [picker, setPicker] = useState(false);
  const [cropSrc, setCropSrc] = useState('');
  const [fileError, setFileError] = useState('');

  const commit = (list) => { saveProfiles(list); onProfiles(list); };
  const startNew = () => { setPicker(false); setFileError(''); setEditing({ id: newProfileId(), name: '', color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length], isNew: true }); };
  const save = (event) => {
    event.preventDefault();
    const name = editing.name.trim().slice(0, 24);
    if (!name) return;
    const entry = { id: editing.id, name, color: editing.color, ...(editing.kids ? { kids: true } : {}), ...(editing.avatar ? { avatar: editing.avatar } : {}) };
    commit(editing.isNew ? [...profiles, entry] : profiles.map((profile) => (profile.id === editing.id ? entry : profile)));
    setEditing(null);
  };
  const remove = (id) => {
    if (profiles.length <= 1) return;
    deleteProfileData(id);
    commit(profiles.filter((profile) => profile.id !== id));
    setConfirmDelete('');
    setEditing(null);
  };
  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setFileError('');
    if (!file) return;
    if (!/^image\//.test(file.type)) { setFileError('Escolhe um ficheiro de imagem (PNG, JPG, WebP…).'); return; }
    if (file.size > 15 * 1024 * 1024) { setFileError('A imagem é grande demais (máximo 15 MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => setCropSrc(String(reader.result));
    reader.onerror = () => setFileError('Não foi possível ler a imagem.');
    reader.readAsDataURL(file);
  };

  return <div className="profile-gate">
    <div className="profile-gate-inner">
      <span className="brand-word profile-gate-brand">stream<BrandFlow/><span>nexus</span></span>
      <h1>{cropSrc ? 'Enquadra a imagem' : editing ? (editing.isNew ? 'Novo perfil' : 'Editar perfil') : managing ? 'Gerir perfis' : 'Quem está a ver?'}</h1>
      {!editing && <div className="profile-grid">
        {profiles.map((profile) => <button key={profile.id} className="profile-tile" onClick={() => { if (managing) { setPicker(false); setFileError(''); setEditing({ ...profile }); } else onChoose(profile.id); }}>
          <span className="profile-tile-avatar"><ProfileAvatar profile={profile} size={104}/>{profile.kids && <b className="profile-kids-badge">Infantil</b>}{managing && <i className="profile-tile-edit"><Icon name="settings" size={22}/></i>}</span>
          <strong>{profile.name}</strong>
        </button>)}
        {profiles.length < 6 && <button className="profile-tile profile-tile-add" onClick={startNew}><span className="profile-tile-avatar"><span className="profile-avatar profile-avatar-add" style={{ width: 104, height: 104 }}><Icon name="plus" size={40}/></span></span><strong>Adicionar perfil</strong></button>}
      </div>}
      {editing && cropSrc && <AvatarCropper src={cropSrc} onCancel={() => setCropSrc('')} onApply={(data) => { setEditing({ ...editing, avatar: { type: 'image', data } }); setCropSrc(''); setPicker(false); }}/>}
      {editing && !cropSrc && <form className="profile-edit" onSubmit={save}>
        <ProfileAvatar profile={{ name: editing.name || '?', color: editing.color, avatar: editing.avatar }} size={96}/>
        <div className="avatar-actions">
          <button type="button" className={`button button-glass button-sm ${picker ? 'is-active' : ''}`} onClick={() => setPicker((open) => !open)}>Escolher avatar</button>
          <label className="button button-glass button-sm avatar-upload">Carregar imagem<input type="file" accept="image/*" hidden onChange={onFile} aria-label="Carregar imagem"/></label>
          {editing.avatar && <button type="button" className="text-link" onClick={() => setEditing({ ...editing, avatar: null })}>Usar a inicial do nome</button>}
        </div>
        {fileError && <small className="is-error-text">{fileError}</small>}
        {picker && <div className="avatar-grid" role="listbox" aria-label="Avatares">{AVATARS.map((emoji) => <button type="button" key={emoji} role="option" aria-selected={editing.avatar?.value === emoji} className={editing.avatar?.value === emoji ? 'active' : ''} onClick={() => setEditing({ ...editing, avatar: { type: 'emoji', value: emoji } })}>{emoji}</button>)}</div>}
        <label className="input-label" htmlFor="profile-name">Nome</label>
        <input id="profile-name" className="text-input" autoFocus maxLength={24} placeholder="Ex.: Mãe, Pai, Filhos…" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })}/>
        <label className="profile-kids-toggle"><input type="checkbox" checked={Boolean(editing.kids)} onChange={(event) => setEditing({ ...editing, kids: event.target.checked })}/><span><strong>Perfil infantil</strong><small>Só filmes e séries para os mais novos; sem Adultos, TV ao vivo nem definições.</small></span></label>
        <div className="profile-colors" role="radiogroup" aria-label="Cor do perfil">{PROFILE_COLORS.map((color) => <button type="button" key={color} role="radio" aria-checked={editing.color === color} className={editing.color === color ? 'active' : ''} style={{ background: color }} onClick={() => setEditing({ ...editing, color })} aria-label={`Cor ${color}`}/>)}</div>
        <div className="profile-edit-actions">
          <button type="submit" className="button button-primary" disabled={!editing.name.trim()}>Guardar</button>
          <button type="button" className="button button-quiet" onClick={() => { setEditing(null); setConfirmDelete(''); }}>Cancelar</button>
          {!editing.isNew && profiles.length > 1 && (confirmDelete === editing.id
            ? <button type="button" className="button button-danger" onClick={() => remove(editing.id)}>Confirmar: apagar perfil e dados</button>
            : <button type="button" className="button button-glass" onClick={() => setConfirmDelete(editing.id)}>Apagar perfil</button>)}
        </div>
        {!editing.isNew && editing.id === DEFAULT_PROFILE_ID && <small className="profile-hint">Este perfil guarda os dados que já tinhas antes dos perfis existirem.</small>}
      </form>}
      {!editing && <div className="profile-gate-actions">
        <button className="button button-glass" onClick={() => setManaging((value) => !value)}>{managing ? 'Concluído' : 'Gerir perfis'}</button>
        {canCancel && <button className="button button-quiet" onClick={onCancel}>Voltar</button>}
      </div>}
    </div>
  </div>;
}
