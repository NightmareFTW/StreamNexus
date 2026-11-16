import { useMemo } from 'react';
import { Icon, PosterCard, ScrollRow } from './ui.jsx';
import { FeedShelves } from './Feed.jsx';

export const ADULT_CATEGORIES = [
  { label: "Amador", term: "amateur" }, { label: "Caseiro", term: "homemade" }, { label: "Casal", term: "couple" }, { label: "Webcam", term: "webcam" },
  { label: "Câmara escondida", term: "hidden cam" }, { label: "Voyeur", term: "voyeur" }, { label: "Selfie", term: "selfie" }, { label: "Asiático", term: "asian" },
  { label: "Japonês", term: "japanese" }, { label: "Coreano", term: "korean" }, { label: "Tailandês", term: "thai" }, { label: "Indiano", term: "indian" },
  { label: "Árabe", term: "arab" }, { label: "Latino", term: "latina" }, { label: "Brasileiro", term: "brazilian" }, { label: "Colombiano", term: "colombian" },
  { label: "Ébano", term: "ebony" }, { label: "Africano", term: "african" }, { label: "Europeu", term: "european" }, { label: "Checo", term: "czech" },
  { label: "Russo", term: "russian" }, { label: "Alemão", term: "german" }, { label: "Francês", term: "french" }, { label: "Britânico", term: "british" },
  { label: "Italiano", term: "italian" }, { label: "Espanhol", term: "spanish" }, { label: "Português", term: "portuguese" }, { label: "Turco", term: "turkish" },
  { label: "Interracial", term: "interracial" }, { label: "Lésbicas", term: "lesbian" }, { label: "MILF", term: "milf" }, { label: "Madura", term: "mature" },
  { label: "Avó", term: "granny" }, { label: "Ruiva", term: "redhead" }, { label: "Loira", term: "blonde" }, { label: "Morena", term: "brunette" },
  { label: "Pequena", term: "petite" }, { label: "BBW", term: "bbw" }, { label: "Alta", term: "tall" }, { label: "Musculada", term: "muscular" },
  { label: "Fitness", term: "fitness" }, { label: "Tatuagens", term: "tattoo" }, { label: "Piercings", term: "piercing" }, { label: "Peitos grandes", term: "big tits" },
  { label: "Peitos naturais", term: "natural tits" }, { label: "Rabo grande", term: "big ass" }, { label: "Pernas", term: "legs" }, { label: "Pés", term: "feet" },
  { label: "Cabeludo", term: "hairy" }, { label: "Depilada", term: "shaved" }, { label: "Gordinha", term: "chubby" }, { label: "Estrela porno", term: "pornstar" },
  { label: "Celebridade", term: "celebrity" }, { label: "Mãos", term: "hands" }, { label: "Anal", term: "anal" }, { label: "Oral", term: "blowjob" },
  { label: "Garganta funda", term: "deepthroat" }, { label: "Sexo oral feminino", term: "cunnilingus" }, { label: "Masturbação", term: "masturbation" }, { label: "Masturbação manual", term: "handjob" },
  { label: "Dedos", term: "fingering" }, { label: "Squirt", term: "squirt" }, { label: "Creampie", term: "creampie" }, { label: "Facial", term: "facial" },
  { label: "Ejaculação", term: "cumshot" }, { label: "Gozada", term: "cum" }, { label: "Bukkake", term: "bukkake" }, { label: "Rimming", term: "rimming" },
  { label: "Espanholada", term: "titfuck" }, { label: "Sessenta e nove", term: "69" }, { label: "Brinquedos", term: "toys" }, { label: "Vibrador", term: "vibrator" },
  { label: "Dildo", term: "dildo" }, { label: "Trio", term: "threesome" }, { label: "Orgia", term: "orgy" }, { label: "Gangbang", term: "gangbang" },
  { label: "Sexo em grupo", term: "group sex" }, { label: "Dupla penetração", term: "double penetration" }, { label: "Swingers", term: "swingers" }, { label: "Cuckold", term: "cuckold" },
  { label: "Hotwife", term: "hotwife" }, { label: "Troca de casais", term: "swap" }, { label: "Cowgirl", term: "cowgirl" }, { label: "Cowgirl invertida", term: "reverse cowgirl" },
  { label: "Doggy style", term: "doggy style" }, { label: "Missionário", term: "missionary" }, { label: "Sexo lento", term: "slow" }, { label: "Sexo selvagem", term: "rough" },
  { label: "Hardcore", term: "hardcore" }, { label: "Softcore", term: "softcore" }, { label: "Sensual", term: "sensual" }, { label: "Romântico", term: "romantic" },
  { label: "Tímida", term: "shy" }, { label: "Apaixonados", term: "passionate" }, { label: "BDSM", term: "bdsm" }, { label: "Bondage", term: "bondage" },
  { label: "Dominação", term: "femdom" }, { label: "Submissão", term: "submissive" }, { label: "Palmadas", term: "spanking" }, { label: "Facesitting", term: "facesitting" },
  { label: "Fetiche", term: "fetish" }, { label: "Látex", term: "latex" }, { label: "Couro", term: "leather" }, { label: "Meias", term: "stockings" },
  { label: "Collants", term: "pantyhose" }, { label: "Lingerie", term: "lingerie" }, { label: "Saltos altos", term: "high heels" }, { label: "Biquíni", term: "bikini" },
  { label: "Roupa interior", term: "panties" }, { label: "Massagem", term: "massage" }, { label: "Óleo", term: "oil" }, { label: "Chuveiro", term: "shower" },
  { label: "Casa de banho", term: "bathroom" }, { label: "Banheira", term: "bathtub" }, { label: "Piscina", term: "pool" }, { label: "Praia", term: "beach" },
  { label: "Ar livre", term: "outdoor" }, { label: "Sexo em público", term: "public" }, { label: "Carro", term: "car" }, { label: "Cozinha", term: "kitchen" },
  { label: "Sofá", term: "couch" }, { label: "Quarto", term: "bedroom" }, { label: "Hotel", term: "hotel" }, { label: "Escritório", term: "office" },
  { label: "Ginásio", term: "gym" }, { label: "Sauna", term: "sauna" }, { label: "Enfermeira", term: "nurse" }, { label: "Professora", term: "teacher" },
  { label: "Secretária", term: "secretary" }, { label: "Médica", term: "doctor" }, { label: "Massagista", term: "masseuse" }, { label: "Empregada", term: "maid" },
  { label: "Uniforme", term: "uniform" }, { label: "Polícia", term: "police" }, { label: "Encenação", term: "roleplay" }, { label: "Cosplay", term: "cosplay" },
  { label: "Halloween", term: "halloween" }, { label: "Hentai", term: "hentai" }, { label: "Anime", term: "anime" }, { label: "Desenhos animados", term: "cartoon" },
  { label: "3D", term: "3d" }, { label: "Paródia", term: "parody" }, { label: "Clássico", term: "vintage" }, { label: "Retro", term: "retro" },
  { label: "Filmes completos", term: "full movie" }, { label: "Compilações", term: "compilation" }, { label: "Melhores momentos", term: "best of" }, { label: "Realidade virtual", term: "vr" },
  { label: "POV", term: "pov" }, { label: "Primeiro plano", term: "close up" }, { label: "Câmara lenta", term: "slow motion" },
];

export function AdultModeTabs({ mode, onMode }) {
  return <div className="mode-tabs" role="tablist" aria-label="Tipo de conteúdo adulto">
    {[['videos', 'Vídeos (+18)'], ['cinema', 'Cinema para adultos']].map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => onMode(key)}>{label}</button>)}
  </div>;
}

export const ADULT_ORIENTATIONS = [['straight', 'Hétero'], ['gay', 'Gay'], ['trans', 'Trans']];

export function AdultVideosPage({ mode, onMode, orientation, onOrientation, state, category, onCategory, onPlay, onRetry }) {
  const shelves = useMemo(() => state.rows.filter((row) => row.items.length > 0).map((row) => ({ ...row, page: 'adult' })), [state.rows]);
  return <section className="live-tv adult-videos page-in">
    <div className="live-head">
      <div><span className="eyebrow"><span className="pulse-dot"></span> +18 · CONTEÚDO PARA ADULTOS</span><h1>Vídeos</h1><p>Catálogo das APIs públicas do RedTube, Pornhub e Eporner. Os vídeos reproduzem-se no leitor incorporado de cada site.</p></div>
      <div className="live-controls live-controls-col"><AdultModeTabs mode={mode} onMode={onMode}/><div className="mode-tabs" role="tablist" aria-label="Orientação">{ADULT_ORIENTATIONS.map(([key, label]) => <button key={key} role="tab" aria-selected={orientation === key} className={orientation === key ? 'active' : ''} onClick={() => onOrientation(key)}>{label}</button>)}</div></div>
    </div>

    <ScrollRow className="genre-chips" aria-label="Categorias">
      <button className={category === 'Todos' ? 'active' : ''} onClick={() => onCategory('Todos')}>Todos</button>
      {ADULT_CATEGORIES.map((entry) => <button key={entry.label} className={category === entry.label ? 'active' : ''} onClick={() => onCategory(entry.label)}>{entry.label}</button>)}
    </ScrollRow>

    {state.status === 'loading' && state.rows.length === 0 && <div className="empty-list catalog-empty"><span><span className="spinner"></span></span><strong>A carregar vídeos…</strong><p>A consultar as fontes.</p></div>}
    {state.status === 'error' && <div className="empty-list catalog-empty"><span><Icon name="alert" size={22}/></span><strong>Não foi possível carregar os vídeos</strong><p className="is-error-text">{state.message}</p><button className="text-link" onClick={onRetry}>Tentar novamente <Icon name="refresh" size={14}/></button></div>}

    {(state.rows.length > 0 || category !== 'Todos') && <FeedShelves key={orientation} kind="adultvideos" shelves={shelves} genre={category} activePage="adult" orientation={orientation} renderCard={(item, index) => <PosterCard key={item.id} item={item} index={index} saved={false} hideSave onOpen={() => onPlay(item)}/>}/>}
  </section>;
}
