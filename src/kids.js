// Perfil infantil: só mostra conteúdo adequado aos mais novos.
// Filmes e séries têm de ser de animação, família ou infantil, e não podem ser de terror, crime, thriller, guerra ou mistério.
// Vídeos +18 e canais de TV ficam sempre de fora; álbuns e livros passam.
export const KIDS_OK_GENRES = ['Animação', 'Família', 'Infantil'];
export const KIDS_BLOCKED_GENRES = ['Terror', 'Crime', 'Thriller', 'Guerra', 'Mistério'];

export function kidsAllowed(item) {
  if (!item || item.adult) return false;
  if (item.type === 'Filme' || item.type === 'Série') {
    const genres = item.genres?.length ? item.genres : [item.genre];
    return genres.some((genre) => KIDS_OK_GENRES.includes(genre)) && !genres.some((genre) => KIDS_BLOCKED_GENRES.includes(genre));
  }
  if (item.type === 'Vídeo' || item.type === 'Canal') return false;
  return true;
}
