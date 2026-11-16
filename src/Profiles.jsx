import { useState } from 'react';
import { Icon } from './ui.jsx';
import { DEFAULT_PROFILE_ID, PROFILE_COLORS, deleteProfileData, newProfileId, saveProfiles } from './profiles.js';

const initialOf = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

export function ProfileAvatar({ profile, size = 40 }) {
  return <span className="profile-avatar" style={{ '--avatar': profile.color, width: size, height: size, fontSize: Math.round(size * 0.44) }}>{initialOf(profile.name)}</span>;
}

// Ecrã "Quem está a ver?" (e gestão de perfis). Cada perfil tem a sua lista, o seu histórico e as suas preferências.
export function ProfileGate({ profiles, onProfiles, onChoose, startManaging = false, canCancel = false, onCancel }) {
  const [managing, setManaging] = useState(startManaging);
  const [editing, setEditing] = useState(null); // { id, name, color, isNew }
  const [confirmDelete, setConfirmDelete] = useState('');

  const commit = (list) => { saveProfiles(list); onProfiles(list); };
  const startNew = () => setEditing({ id: newProfileId(), name: '', color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length], isNew: true });
  const save = (event) => {
    event.preventDefault();
    const name = editing.name.trim().slice(0, 24);
    if (!name) return;
    const entry = { id: editing.id, name, color: editing.color };
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

  return <div className="profile-gate">
    <div className="profile-gate-inner">
      <span className="brand-word profile-gate-brand">stream<span>nexus</span></span>
      <h1>{editing ? (editing.isNew ? 'Novo perfil' : 'Editar perfil') : managing ? 'Gerir perfis' : 'Quem está a ver?'}</h1>
      {!editing && <div className="profile-grid">
        {profiles.map((profile) => <button key={profile.id} className="profile-tile" onClick={() => (managing ? setEditing({ ...profile }) : onChoose(profile.id))}>
          <span className="profile-tile-avatar"><ProfileAvatar profile={profile} size={104}/>{managing && <i className="profile-tile-edit"><Icon name="settings" size={22}/></i>}</span>
          <strong>{profile.name}</strong>
        </button>)}
        {profiles.length < 6 && <button className="profile-tile profile-tile-add" onClick={startNew}><span className="profile-tile-avatar"><span className="profile-avatar profile-avatar-add" style={{ width: 104, height: 104 }}><Icon name="plus" size={40}/></span></span><strong>Adicionar perfil</strong></button>}
      </div>}
      {editing && <form className="profile-edit" onSubmit={save}>
        <ProfileAvatar profile={{ name: editing.name || '?', color: editing.color }} size={96}/>
        <label className="input-label" htmlFor="profile-name">Nome</label>
        <input id="profile-name" className="text-input" autoFocus maxLength={24} placeholder="Ex.: Mãe, Pai, Filhos…" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })}/>
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
