import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const RD_API = 'https://api.real-debrid.com/rest/1.0';
const RD_OAUTH = 'https://api.real-debrid.com/oauth/v2';
const RD_OPEN_SOURCE_CLIENT_ID = 'X245A4XAIBGVM';
const RD_SESSION_KEY = 'streamnexus.rd.session.v1';
const SEARCH_CATEGORIES = {
  movies: { label: 'Filmes', manager: 'Radarr', type: 'movie', category: '2000', icon: 'film' },
  series: { label: 'Séries', manager: 'Sonarr', type: 'tvsearch', category: '5000', icon: 'tv' },
  music: { label: 'Música', manager: 'Lidarr', type: 'music', category: '3000', icon: 'music' },
  books: { label: 'Livros', manager: 'Readarr', type: 'book', category: '7000', icon: 'book' },
  adult: { label: 'Adulto', manager: 'Whisparr', type: 'search', category: '6000', icon: 'adult' },
};
const PAGE_SEARCH_CATEGORY = { tv: 'series' };

function normalizeSearchText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesTorrentTitle(torrent, title) {
  const filename = normalizeSearchText(`${torrent.filename || ''} ${torrent.original_filename || ''}`);
  const candidates = [title.title, title.original, ...(title.aliases || [])].map(normalizeSearchText).filter(Boolean);
  return candidates.some((candidate) => {
    if (filename.includes(candidate)) return true;
    const tokens = candidate.split(' ').filter((token) => token.length > 2 && !['the', 'and', 'of', 'parte'].includes(token));
    return tokens.length >= 2 && tokens.every((token) => filename.includes(token));
  });
}

const titles = [
  { id: 'dune2', title: 'Dune: Parte Dois', original: 'Dune: Part Two', type: 'Filme', year: 2024, rating: '8.6', genre: 'Ficção científica', runtime: '2h 46m', poster: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg', description: 'Paul Atreides une-se a Chani e aos Fremen numa jornada de vingança e destino, entre as areias de Arrakis.', tag: 'EM DESTAQUE', accent: '#c28d5d' },
  { id: 'oppenheimer', title: 'Oppenheimer', original: 'Oppenheimer', type: 'Filme', year: 2023, rating: '8.3', genre: 'Drama', runtime: '3h 00m', poster: 'https://image.tmdb.org/t/p/w500/ptpr0kGAckfQkJeJIt8st5dglvd.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/ptpr0kGAckfQkJeJIt8st5dglvd.jpg', description: 'A história do físico J. Robert Oppenheimer e do papel que desempenhou na criação da bomba atómica.', tag: 'MAIS VISTO', accent: '#c77a46' },
  { id: 'interstellar', title: 'Interstellar', original: 'Interstellar', type: 'Filme', year: 2014, rating: '8.7', genre: 'Ficção científica', runtime: '2h 49m', poster: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg', description: 'Uma equipa de exploradores atravessa um buraco de minhoca para descobrir se a humanidade tem futuro entre as estrelas.', accent: '#8a929c' },
  { id: 'batman', title: 'The Batman', original: 'The Batman', type: 'Filme', year: 2022, rating: '7.8', genre: 'Ação', runtime: '2h 56m', poster: 'https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg', description: 'Quando um assassino deixa pistas enigmáticas, Batman mergulha no submundo de Gotham para revelar a verdade.', accent: '#9d454d' },
  { id: 'puss', title: 'O Gato das Botas: O Último Desejo', original: 'Puss in Boots: The Last Wish', type: 'Filme', year: 2022, rating: '7.9', genre: 'Animação', runtime: '1h 42m', poster: 'https://image.tmdb.org/t/p/w500/kuf6dutpsT0vSVehic3EZIqkOBt.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/a2tys4sD7xzVaogPntGsT1ypVoT.jpg', description: 'O Gato descobre que já gastou oito das suas nove vidas e parte numa aventura para recuperar o que perdeu.', accent: '#b28854' },
  { id: 'poor-things', title: 'Pobres Criaturas', original: 'Poor Things', type: 'Filme', year: 2023, rating: '7.8', genre: 'Fantasia', runtime: '2h 21m', poster: 'https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/s9o7LZV65k6FZT2a5bXnBvUNQjE.jpg', description: 'Uma jovem mulher, renascida com a curiosidade intacta, parte à descoberta de um mundo que ainda não conhece.', accent: '#bd8092' },
  { id: 'last-of-us', title: 'The Last of Us', original: 'The Last of Us', type: 'Série', year: 2023, rating: '8.7', genre: 'Drama', runtime: '1 temporada', poster: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2WfjB6FUDZ6x74gaj0bNwJ2b5FJ.jpg', description: 'Vinte anos após o colapso da civilização, Joel é contratado para tirar Ellie de uma zona de quarentena.', accent: '#759065' },
  { id: 'severance', title: 'Ruptura', original: 'Severance', type: 'Série', year: 2022, rating: '8.7', genre: 'Mistério', runtime: '2 temporadas', poster: 'https://image.tmdb.org/t/p/w500/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2A7lA8XP5s9l4m3bhYCyKJYhV0v.jpg', description: 'Um trabalhador aceita separar cirurgicamente as memórias do trabalho das memórias da vida pessoal.', accent: '#8498ad' },
  { id: 'spiderverse', title: 'Através do Aranhaverso', original: 'Spider-Man: Across the Spider-Verse', type: 'Filme', year: 2023, rating: '8.6', genre: 'Animação', runtime: '2h 20m', poster: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg', description: 'Miles Morales atravessa o multiverso e encontra uma equipa de heróis-aranha pronta para o proteger.', accent: '#b44c7c' },
  { id: 'arrival', title: 'O Primeiro Encontro', original: 'Arrival', type: 'Filme', year: 2016, rating: '7.9', genre: 'Ficção científica', runtime: '1h 56m', poster: 'https://image.tmdb.org/t/p/w500/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/yIZ1xendyqKvY3FGeeUYUd5X9Mm.jpg', description: 'Uma linguista é chamada para tentar comunicar com misteriosas naves que surgiram por todo o planeta.', accent: '#627c89' },
  { id: 'whiplash', title: 'Whiplash', original: 'Whiplash', type: 'Filme', year: 2014, rating: '8.5', genre: 'Drama', runtime: '1h 47m', poster: 'https://image.tmdb.org/t/p/w500/7fn624j5lj3xTme2SgiLCeuedmO.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/6bbZ6XyvgfjhQwbplnUh1LSj1ky.jpg', description: 'Um jovem baterista entra no conservatório mais competitivo do país e enfrenta um professor implacável.', accent: '#ba6445' },
  { id: 'dark-knight', title: 'O Cavaleiro das Trevas', original: 'The Dark Knight', aliases: ['The Dark Knight'], type: 'Filme', year: 2008, rating: '9.0', genre: 'Ação', runtime: '2h 32m', poster: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/nMKdUUepR0i5Zn0y1T4CsSB5jor.jpg', description: 'Batman enfrenta o caos provocado pelo Joker e descobre até onde Gotham está disposta a ir.', accent: '#68727c' },
  { id: 'inception', title: 'A Origem', original: 'Inception', aliases: ['Inception'], type: 'Filme', year: 2010, rating: '8.4', genre: 'Ficção científica', runtime: '2h 28m', poster: 'https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/s3TBrRGB1iav7gFOCNx3H31MoES.jpg', description: 'Um ladrão especializado em sonhos recebe a missão mais difícil da sua carreira: plantar uma ideia.', accent: '#727d88' },
  { id: 'parasite', title: 'Parasitas', original: 'Parasite', aliases: ['Gisaengchung'], type: 'Filme', year: 2019, rating: '8.5', genre: 'Drama', runtime: '2h 12m', poster: 'https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/TU9NIjwzjoKPwQHoHshkFcQUCG.jpg', description: 'Duas famílias de mundos opostos aproximam-se num jogo de ambição, humor e tensão.', accent: '#8f9a80' },
  { id: 'barbie', title: 'Barbie', original: 'Barbie', type: 'Filme', year: 2023, rating: '7.0', genre: 'Comédia', runtime: '1h 54m', poster: 'https://image.tmdb.org/t/p/w500/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/ctMserH8g2SeOAnCw5gFjdQF8mo.jpg', description: 'Barbie e Ken deixam o mundo cor-de-rosa para descobrir tudo o que a vida real tem para oferecer.', accent: '#d776a7' },
  { id: 'top-gun', title: 'Top Gun: Maverick', original: 'Top Gun: Maverick', aliases: ['Top Gun Maverick'], type: 'Filme', year: 2022, rating: '8.2', genre: 'Ação', runtime: '2h 10m', poster: 'https://image.tmdb.org/t/p/w500/62HCnUTziyWcpDaBO2i1DX17ljH.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/odJ4hx6g6vBt4lBWKFD1tI8WS4x.jpg', description: 'Maverick regressa para treinar uma nova geração de pilotos para uma missão sem margem para erro.', accent: '#77869a' },
  { id: 'everything-everywhere', title: 'Tudo em Todo o Lado ao Mesmo Tempo', original: 'Everything Everywhere All at Once', aliases: ['Everything Everywhere All at Once'], type: 'Filme', year: 2022, rating: '7.7', genre: 'Ficção científica', runtime: '2h 19m', poster: 'https://image.tmdb.org/t/p/w500/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/5dE2de7xY2j8u0j1e7Z9uVQfJkW.jpg', description: 'Uma imigrante é lançada numa aventura que atravessa universos e liga todas as versões da sua vida.', accent: '#916f9f' },
  { id: 'matrix', title: 'Matrix', original: 'The Matrix', aliases: ['The Matrix'], type: 'Filme', year: 1999, rating: '8.2', genre: 'Ficção científica', runtime: '2h 16m', poster: 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg', description: 'Neo descobre que a realidade que conhece esconde um mundo construído por máquinas.', accent: '#689075' },
  { id: 'mad-max', title: 'Mad Max: Estrada da Fúria', original: 'Mad Max: Fury Road', aliases: ['Mad Max Fury Road'], type: 'Filme', year: 2015, rating: '8.1', genre: 'Ação', runtime: '2h 00m', poster: 'https://image.tmdb.org/t/p/w500/8tZYtuWezp8JbcsvHYO0O46tFbo.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/phszHPFVhPHhMZgo0fWTKBDQsJA.jpg', description: 'Num deserto sem lei, Max junta-se a Furiosa numa fuga explosiva pela liberdade.', accent: '#b27649' },
  { id: 'coco', title: 'Coco', original: 'Coco', type: 'Filme', year: 2017, rating: '8.4', genre: 'Animação', runtime: '1h 45m', poster: 'https://image.tmdb.org/t/p/w500/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/smKp7QvP1kVf3nK0q6YpV0XJQJf.jpg', description: 'Miguel atravessa a Terra dos Mortos para desvendar a história da sua família e seguir a música.', accent: '#d18b4b' },
  { id: 'ratatouille', title: 'Ratatui', original: 'Ratatouille', type: 'Filme', year: 2007, rating: '8.1', genre: 'Animação', runtime: '1h 51m', poster: 'https://image.tmdb.org/t/p/w500/t3vaWRPSf6WjDSamIkKDs1iQWna.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/xgDj56UWyeWQcxQ44f5A3RTWuSs.jpg', description: 'Um rato com um paladar extraordinário encontra uma oportunidade improvável numa cozinha parisiense.', accent: '#a95848' },
  { id: 'walle', title: 'WALL·E', original: 'WALL·E', type: 'Filme', year: 2008, rating: '8.4', genre: 'Animação', runtime: '1h 38m', poster: 'https://image.tmdb.org/t/p/w500/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2Zw9XKxvE8j11yYpAbvBf9R8r7K.jpg', description: 'Um pequeno robot de limpeza encontra uma nova missão entre as estrelas e muda o futuro da humanidade.', accent: '#8190a0' },
  { id: 'inside-out', title: 'Divertida-Mente', original: 'Inside Out', aliases: ['Inside Out'], type: 'Filme', year: 2015, rating: '8.0', genre: 'Animação', runtime: '1h 35m', poster: 'https://image.tmdb.org/t/p/w500/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2u1QbX1hQ8jJqVY9RkzUq2YVQjA.jpg', description: 'Alegria, Tristeza e as outras emoções ajudam Riley a adaptar-se a uma nova cidade.', accent: '#7f8fd1' },
  { id: 'soul', title: 'Soul', original: 'Soul', type: 'Filme', year: 2020, rating: '8.1', genre: 'Animação', runtime: '1h 40m', poster: 'https://image.tmdb.org/t/p/w500/hm58Jw4Lw8OIeECIq5qyPYhAeRJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/8tABCBpzu3mZbzMB3sRzMEHEvJi.jpg', description: 'Um músico de jazz faz uma viagem inesperada para perceber o que torna a vida especial.', accent: '#729caa' },
  { id: 'dune1', title: 'Dune: Parte Um', original: 'Dune', aliases: ['Dune 2021'], type: 'Filme', year: 2021, rating: '8.0', genre: 'Ficção científica', runtime: '2h 35m', poster: 'https://image.tmdb.org/t/p/w500/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/jYEW5xZkZk2WTrdbMGAPFuBqbDc.jpg', description: 'Paul Atreides chega a Arrakis, o planeta mais perigoso e valioso do universo.', accent: '#bd9667' },
  { id: 'joker', title: 'Joker', original: 'Joker', type: 'Filme', year: 2019, rating: '8.2', genre: 'Drama', runtime: '2h 02m', poster: 'https://image.tmdb.org/t/p/w500/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/hO7KbdvGOtDdeg0W4Y5nKEHeDDh.jpg', description: 'Uma cidade indiferente e uma vida em queda transformam Arthur Fleck numa figura impossível de ignorar.', accent: '#a56865' },
  { id: 'queens-gambit', title: 'O Gambito da Rainha', original: "The Queen's Gambit", aliases: ['The Queens Gambit'], type: 'Série', year: 2020, rating: '8.5', genre: 'Drama', runtime: '1 temporada', poster: 'https://image.tmdb.org/t/p/w500/zU0htwkhNvBQdVSIKB9s6hgVeFK.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/34OGjFEbHj0E3lE2w0iTUVq0O4o.jpg', description: 'Uma jovem prodígio do xadrez enfrenta a competição, a fama e os seus próprios limites.', accent: '#a48256' },
  { id: 'arcane', title: 'Arcane', original: 'Arcane', type: 'Série', year: 2021, rating: '9.0', genre: 'Animação', runtime: '2 temporadas', poster: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/abf8tHznhSvl9BAElD2cQeRr7do.jpg', description: 'Duas irmãs ficam em lados opostos de um conflito entre a cidade de Piltover e o submundo de Zaun.', accent: '#9c70c1' },
  { id: 'breaking-bad', title: 'Breaking Bad', original: 'Breaking Bad', type: 'Série', year: 2008, rating: '9.5', genre: 'Drama', runtime: '5 temporadas', poster: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/eSzpy96DwBujGFj0xMbXBcGcfxX.jpg', description: 'Um professor de química toma uma decisão extrema que muda para sempre a sua família e o seu futuro.', accent: '#9aa66a' },
  { id: 'squid-game', title: 'Squid Game', original: 'Squid Game', type: 'Série', year: 2021, rating: '7.8', genre: 'Drama', runtime: '2 temporadas', poster: 'https://image.tmdb.org/t/p/w500/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/1Rr5SrvHxMXHu5RjKpaMba8VTzi.jpg', description: 'Centenas de pessoas em dificuldades aceitam competir em jogos infantis com consequências inesperadas.', accent: '#db718b' },
  { id: 'game-of-thrones', title: 'A Guerra dos Tronos', original: 'Game of Thrones', aliases: ['Game of Thrones'], type: 'Série', year: 2011, rating: '9.2', genre: 'Fantasia', runtime: '8 temporadas', poster: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/suopoADq0k8YZr4dQXcU6pToj6s.jpg', description: 'Famílias rivais disputam o poder num continente onde o inverno e uma antiga ameaça se aproximam.', accent: '#a58563' },
  { id: 'dark-series', title: 'Dark', original: 'Dark', type: 'Série', year: 2017, rating: '8.4', genre: 'Mistério', runtime: '3 temporadas', poster: 'https://image.tmdb.org/t/p/w500/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/5LoHuHWA4H8jElFlZDvsmU2n63b.jpg', description: 'O desaparecimento de uma criança revela segredos que atravessam gerações numa pequena cidade alemã.', accent: '#687b8b' },
  { id: 'succession', title: 'Succession', original: 'Succession', type: 'Série', year: 2018, rating: '8.3', genre: 'Drama', runtime: '4 temporadas', poster: 'https://image.tmdb.org/t/p/w500/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/7z9zQm7m7F6xPZtF2J8QzVYwVxG.jpg', description: 'Uma família poderosa disputa o controlo de um império mediático e o lugar do patriarca.', accent: '#8b8b91' },
  { id: 'the-bear', title: 'O Urso', original: 'The Bear', aliases: ['The Bear'], type: 'Série', year: 2022, rating: '8.2', genre: 'Drama', runtime: '4 temporadas', poster: 'https://image.tmdb.org/t/p/w500/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/7pEVq4q5bF3PZV1J7Q5QK5X4Fh3.jpg', description: 'Um chef regressa a Chicago para salvar o restaurante da família e aprender a trabalhar em equipa.', accent: '#cb7a4a' },
  { id: 'stranger-things', title: 'Stranger Things', original: 'Stranger Things', type: 'Série', year: 2016, rating: '8.6', genre: 'Ficção científica', runtime: '4 temporadas', poster: 'https://image.tmdb.org/t/p/w500/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/56v2KjBlU4XaOv9rVYEQypROD7P.jpg', description: 'Um grupo de amigos enfrenta experiências secretas e forças estranhas numa cidade dos anos 80.', accent: '#9c4444' },
  { id: 'the-last-dance', title: 'The Last Dance', original: 'The Last Dance', type: 'Série', year: 2020, rating: '8.8', genre: 'Documentário', runtime: '1 temporada', poster: 'https://image.tmdb.org/t/p/w500/4Uj8a3B6ksB9H9xU2gvl6UQVVV2.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/6LWy0jvMpmjoS9fojNgHIKoWL05.jpg', description: 'Uma série documental acompanha a última época de Michael Jordan com os Chicago Bulls.', accent: '#b04a4b' },
  { id: 'knives-out', title: 'Knives Out: Todos São Suspeitos', original: 'Knives Out', aliases: ['Knives Out'], type: 'Filme', year: 2019, rating: '7.9', genre: 'Mistério', runtime: '2h 10m', poster: 'https://image.tmdb.org/t/p/w500/pThyQovXQrw2m0s9x82twj48Jq4.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/3NTEMlG5mQdI6JL3eC5wc5VOO5N.jpg', description: 'Um detetive investiga uma morte numa família cheia de segredos e suspeitos.', accent: '#c18d59' },
  { id: 'la-la-land', title: 'La La Land: Melodia de Amor', original: 'La La Land', aliases: ['La La Land'], type: 'Filme', year: 2016, rating: '7.9', genre: 'Drama', runtime: '2h 08m', poster: 'https://image.tmdb.org/t/p/w500/uDO8zWDhfWwoFdKS4fDM8O5D5.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/nadTlnTE6DdgmYsN4iWc2a2wiaI.jpg', description: 'Uma atriz e um músico tentam encontrar o seu lugar numa Los Angeles cheia de possibilidades.', accent: '#b98968' },
];

const nav = [
  { id: 'home', label: 'Descobrir', icon: 'compass' },
  { id: 'films', label: 'Filmes', icon: 'film' },
  { id: 'series', label: 'Séries', icon: 'tv' },
  { id: 'tv', label: 'TV', icon: 'tv' },
  { id: 'music', label: 'Música', icon: 'music' },
  { id: 'books', label: 'Livros', icon: 'book' },
  { id: 'adult', label: 'Adultos', icon: 'adult' },
  { id: 'indexers', label: 'Pesquisar', icon: 'search' },
];

const DISCOVERY_COLLECTIONS = {
  tv: [
    { title: 'Episódios recentes', subtitle: 'Novos episódios e temporadas', query: 'S01 1080p', icon: 'tv', accent: 'red' },
    { title: 'Séries populares', subtitle: 'As séries mais procuradas', query: 'popular TV series', icon: 'spark', accent: 'gold' },
    { title: 'Animação', subtitle: 'Animação para todos os públicos', query: 'animated series', icon: 'spark', accent: 'violet' },
    { title: 'Documentários', subtitle: 'Histórias reais em episódios', query: 'documentary series', icon: 'film', accent: 'blue' },
    { title: 'Reality e competição', subtitle: 'Programas e concursos', query: 'reality TV show', icon: 'tv', accent: 'pink' },
    { title: 'Minisséries', subtitle: 'Histórias completas numa temporada', query: 'miniseries 1080p', icon: 'book', accent: 'green' },
  ],
  music: [
    { title: 'Álbuns populares', subtitle: 'Os sons que estão a rodar', query: 'popular album', icon: 'music', accent: 'red' },
    { title: 'Bandas sonoras', subtitle: 'Música para cada história', query: 'soundtrack', icon: 'spark', accent: 'gold' },
    { title: 'Rock e metal', subtitle: 'Guitarras no máximo', query: 'rock album', icon: 'music', accent: 'blue' },
    { title: 'Pop', subtitle: 'Novos singles e álbuns', query: 'pop album', icon: 'spark', accent: 'pink' },
    { title: 'Eletrónica', subtitle: 'Ritmos para continuar', query: 'electronic album', icon: 'music', accent: 'violet' },
    { title: 'Jazz e clássica', subtitle: 'Escuta sem pressa', query: 'jazz classical album', icon: 'music', accent: 'green' },
  ],
  books: [
    { title: 'Mais procurados', subtitle: 'Leituras em destaque', query: 'bestseller book', icon: 'book', accent: 'gold' },
    { title: 'Fantasia', subtitle: 'Mundos para descobrir', query: 'fantasy novel', icon: 'spark', accent: 'violet' },
    { title: 'Ficção científica', subtitle: 'Outros mundos, outras ideias', query: 'science fiction novel', icon: 'spark', accent: 'blue' },
    { title: 'Mistério e crime', subtitle: 'Histórias cheias de pistas', query: 'mystery crime novel', icon: 'book', accent: 'red' },
    { title: 'Romance', subtitle: 'Histórias de encontros', query: 'romance novel', icon: 'book', accent: 'pink' },
    { title: 'Banda desenhada', subtitle: 'Comics, manga e novelas gráficas', query: 'comic manga', icon: 'book', accent: 'green' },
  ],
  adult: [
    { title: 'Filmes recentes', subtitle: 'Novidades dos indexadores', query: '1080p', icon: 'film', accent: 'red' },
    { title: 'Alta definição', subtitle: 'Qualidade 1080p', query: '1080p x264', icon: 'film', accent: 'blue' },
    { title: '4K UHD', subtitle: 'Imagem de alta resolução', query: '2160p 4K', icon: 'film', accent: 'gold' },
    { title: 'Séries', subtitle: 'Episódios e temporadas', query: 'S01 1080p', icon: 'tv', accent: 'violet' },
    { title: 'VR', subtitle: 'Realidade virtual', query: 'VR 180', icon: 'spark', accent: 'green' },
    { title: 'Animação', subtitle: 'Animação adulta', query: 'adult animation', icon: 'spark', accent: 'pink' },
  ],
};

function makeDistinctShelves(shelves, excludedIds = [], limit = 12) {
  const seen = new Set(excludedIds);
  return shelves.map((shelf) => {
    const items = [];
    for (const item of shelf.items || []) {
      if (!item?.id || seen.has(item.id) || !item.poster) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= limit) break;
    }
    return { ...shelf, items };
  }).filter((shelf) => shelf.items.length > 0);
}

function Icon({ name, size = 18, stroke = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.5 5.1-5.1 2.5 2.5-5.1z"/></>,
    film: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4"/></>,
    tv: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 2 4 3 4-3M8 22h8"/></>,
    music: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20"/></>,
    adult: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h2m6 0h2m-8 5a3 3 0 0 0 6 0"/><path d="M8 2v2m8-2v2"/></>,
    bookmark: <><path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.8L6 21z"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v3h14v-3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.3a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.3a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    play: <path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="3"/></>,
    skipBack: <><path d="M5 5v14" strokeWidth="2.5"/><path d="m19 6-10 6 10 6z" fill="currentColor" stroke="none"/></>,
    skipForward: <><path d="M19 5v14" strokeWidth="2.5"/><path d="m5 6 10 6-10 6z" fill="currentColor" stroke="none"/></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/></>,
    volumeOff: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/></>,
    captions: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4m-4 4h3m4-4h3m-3 4h4"/></>,
    fullscreen: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></>,
    cloud: <><path d="M20 16.2A4 4 0 0 0 18 8.5a6 6 0 0 0-11.7 1.4A4 4 0 0 0 7 18h11"/><path d="m12 12-3 3h2v4h2v-4h2z"/></>,
    alert: <><path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>,
  };
  return <svg {...common}>{paths[name] || paths.spark}</svg>;
}

function formatPlaybackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function readSession() {
  if (window.streamnexus?.isDesktop) return null;
  try { return JSON.parse(sessionStorage.getItem(RD_SESSION_KEY) || 'null'); } catch { return null; }
}

async function saveSession(session) {
  if (window.streamnexus?.isDesktop) {
    await window.streamnexus.saveSession(session);
    return;
  }
  if (session) sessionStorage.setItem(RD_SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(RD_SESSION_KEY);
}

async function oauthRequest(path, { method = 'GET', body } = {}) {
  if (window.streamnexus?.isDesktop) return window.streamnexus.oauthRequest({ path, method, body });
  const response = await fetch(`${RD_OAUTH}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    body: body ? new URLSearchParams(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || `Real-Debrid respondeu com erro ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function rdRequest(path, { token, method = 'GET', body, headers = {} } = {}) {
  if (window.streamnexus?.isDesktop) return window.streamnexus.rdRequest({ path, token, method, body });
  const response = await fetch(`${RD_API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    body: body ? new URLSearchParams(body) : undefined,
  });
  if (response.status === 204 || response.status === 202) return null;
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.error || data?.message || `Real-Debrid respondeu com erro ${response.status}.`);
  return data;
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateString));
}

function getError(error) {
  if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) return 'Não foi possível ligar à API. Verifica a ligação à internet.';
  return error?.message || 'Ocorreu um erro inesperado.';
}

function App() {
  const [activePage, setActivePage] = useState('home');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Todos');
  const [modal, setModal] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const collectionRequestRef = useRef('');
  const lastBrowsePageRef = useRef(activePage);
  const browseVisitRef = useRef(0);
  const releaseRequestRef = useRef(0);
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState(readSession);
  const [rdUser, setRdUser] = useState(null);
  const [rdItems, setRdItems] = useState([]);
  const [rdSearch, setRdSearch] = useState(null);
  const [releaseSearch, setReleaseSearch] = useState(null);
  const [releaseBusyId, setReleaseBusyId] = useState('');
  const [integrationSettings, setIntegrationSettings] = useState({ prowlarrUrl: '', prowlarrApiKey: '', tmdbApiKey: '', openSubtitlesApiKey: '', openSubtitlesUsername: '', openSubtitlesPassword: '' });
  const [integrationForm, setIntegrationForm] = useState({ prowlarrUrl: '', prowlarrApiKey: '', tmdbApiKey: '', openSubtitlesApiKey: '', openSubtitlesUsername: '', openSubtitlesPassword: '' });
  const [integrationTest, setIntegrationTest] = useState('');
  const [catalogTitles, setCatalogTitles] = useState(titles);
  const [catalogRows, setCatalogRows] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState('sample');
  const [catalogUpdated, setCatalogUpdated] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [subtitleResults, setSubtitleResults] = useState([]);
  const [subtitleStatus, setSubtitleStatus] = useState('idle');
  const [subtitleError, setSubtitleError] = useState('');
  const [subtitleTrackUrl, setSubtitleTrackUrl] = useState('');
  const [subtitleLabel, setSubtitleLabel] = useState('');
  const [subtitleLanguage, setSubtitleLanguage] = useState('pt-PT');
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState([]);
  const [activeEmbeddedTrack, setActiveEmbeddedTrack] = useState(null);
  const [trailer, setTrailer] = useState({ status: 'idle', key: '', name: '' });
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const trailerRequestRef = useRef(0);
  const playerVideoRef = useRef(null);
  const audioStreamIdRef = useRef('');
  const playerControlsTimerRef = useRef(null);
  const [playerControlsVisible, setPlayerControlsVisible] = useState(true);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerSeekEnd, setPlayerSeekEnd] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [playerPlaybackError, setPlayerPlaybackError] = useState('');
  const [adultEnabled, setAdultEnabled] = useState(() => {
    try { return localStorage.getItem('streamnexus.settings.adult') === 'true'; } catch { return false; }
  });
  const [searchCategory, setSearchCategory] = useState('movies');
  const [indexerQuery, setIndexerQuery] = useState('');
  const [rdBusy, setRdBusy] = useState(false);
  const [rdError, setRdError] = useState('');
  const [deviceAuth, setDeviceAuth] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState('');
  const [magnet, setMagnet] = useState('');
  const [magnetBusy, setMagnetBusy] = useState(false);
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('streamnexus.watchlist') || '[]'); } catch { return []; }
  });
  const [playing, setPlaying] = useState(null);
  const [visibleCount, setVisibleCount] = useState(24);

  const notify = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setNotice(''), 3600);
  }, []);

  const refreshSession = useCallback(async (current) => {
    if (!current?.refresh_token || !current?.client_id || !current?.client_secret) return current;
    const now = Date.now();
    if (current.expires_at && current.expires_at - now > 60_000) return current;
    const data = await oauthRequest('/token', { method: 'POST', body: { client_id: current.client_id, client_secret: current.client_secret, code: current.refresh_token, grant_type: 'http://oauth.net/grant_type/device/1.0' } });
    if (!data.access_token) throw new Error('A sessão Real-Debrid expirou. Volta a ligar a conta.');
    const next = { ...current, ...data, expires_at: Date.now() + (data.expires_in || 0) * 1000 };
    await saveSession(next);
    setSession(next);
    return next;
  }, []);

  const callRd = useCallback(async (path, options = {}) => {
    const active = await refreshSession(session);
    if (!active?.access_token) throw new Error('Liga primeiro a tua conta Real-Debrid.');
    return rdRequest(path, { ...options, token: active.access_token });
  }, [refreshSession, session]);

  const loadRdAccount = useCallback(async () => {
    if (!session?.access_token) return;
    setRdBusy(true);
    setRdError('');
    try {
      const [user, torrents] = await Promise.all([callRd('/user'), callRd('/torrents?limit=5000')]);
      setRdUser(user);
      setRdItems(Array.isArray(torrents) ? torrents : []);
    } catch (error) {
      setRdError(getError(error));
      if (/token|sessão/i.test(error.message)) { await saveSession(null); setSession(null); setRdUser(null); }
    } finally { setRdBusy(false); }
  }, [callRd, session]);

  useEffect(() => { loadRdAccount(); }, [loadRdAccount]);

  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    let active = true;
    window.streamnexus.loadSession()
      .then((stored) => { if (active && stored) setSession(stored); })
      .catch((error) => { if (active) setRdError(getError(error)); });
    return () => { active = false; };
  }, []);

  const refreshCatalog = async () => {
    if (!integrationSettings.tmdbApiKey) { setCatalogStatus('sample'); return; }
    setCatalogStatus('loading');
    try {
      if (!window.streamnexus?.isDesktop) throw new Error('A atualização do catálogo está disponível na app desktop.');
      const data = await window.streamnexus.fetchCatalog();
      setCatalogTitles(data.titles?.length ? data.titles : titles);
      setCatalogRows(data.rows || null);
      setHeroIndex(0);
      setCatalogUpdated(new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()));
      setCatalogStatus('ready');
    } catch (error) {
      setCatalogStatus('error');
      notify(getError(error));
    }
  };

  useEffect(() => {
    if (!integrationSettings.tmdbApiKey) { setCatalogStatus('sample'); return; }
    refreshCatalog();
  }, [integrationSettings.tmdbApiKey]);

  const featuredTitles = activePage === 'films'
    ? (catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme'))
    : activePage === 'series'
      ? (catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série'))
      : (catalogRows?.trending?.length ? catalogRows.trending : catalogTitles);
  const featuredTitle = featuredTitles[heroIndex % Math.max(featuredTitles.length, 1)] || titles[0];
  useEffect(() => {
    if (!['home', 'films', 'series'].includes(activePage) || featuredTitles.length < 2 || query || genre !== 'Todos') return undefined;
    const timer = window.setInterval(() => setHeroIndex((index) => (index + 1) % featuredTitles.length), 8500);
    return () => window.clearInterval(timer);
  }, [activePage, featuredTitles.length, query, genre]);

  useEffect(() => { setHeroIndex(0); }, [activePage]);

  useEffect(() => {
    if (!subtitleTrackUrl) return undefined;
    return () => URL.revokeObjectURL(subtitleTrackUrl);
  }, [subtitleTrackUrl]);

  useEffect(() => {
    const video = playerVideoRef.current;
    const trackList = video?.textTracks;
    if (!trackList) return undefined;
    const updateTracks = () => {
      const originalTracks = Array.from(trackList).filter((track) => ['subtitles', 'captions'].includes(track.kind) && !String(track.label || '').startsWith('OpenSubtitles ·'));
      setEmbeddedSubtitleTracks(originalTracks);
      setActiveEmbeddedTrack(originalTracks.find((track) => track.mode === 'showing') || null);
    };
    trackList.addEventListener?.('addtrack', updateTracks);
    trackList.addEventListener?.('change', updateTracks);
    video.addEventListener('loadedmetadata', updateTracks);
    const timer = window.setTimeout(updateTracks, 350);
    return () => {
      window.clearTimeout(timer);
      trackList.removeEventListener?.('addtrack', updateTracks);
      trackList.removeEventListener?.('change', updateTracks);
      video.removeEventListener('loadedmetadata', updateTracks);
    };
  }, [playing?.url, subtitleTrackUrl]);

  const isPlayerOpen = modal?.type === 'player';
  const revealPlayerControls = useCallback(() => {
    setPlayerControlsVisible(true);
    window.clearTimeout(playerControlsTimerRef.current);
    if (isPlayerOpen) {
      playerControlsTimerRef.current = window.setTimeout(() => {
        setPlayerControlsVisible(false);
        setSubtitleMenuOpen(false);
      }, 3500);
    }
  }, [isPlayerOpen]);

  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    setPlayerFullscreen(isPlayerOpen);
    window.streamnexus.setFullscreen(isPlayerOpen).catch(() => {});
    return () => { if (isPlayerOpen) window.streamnexus.setFullscreen(false).catch(() => {}); };
  }, [isPlayerOpen]);

  useEffect(() => {
    if (!isPlayerOpen) {
      window.clearTimeout(playerControlsTimerRef.current);
      setPlayerControlsVisible(true);
      setSubtitleMenuOpen(false);
      return undefined;
    }
    revealPlayerControls();
    return () => window.clearTimeout(playerControlsTimerRef.current);
  }, [isPlayerOpen, revealPlayerControls]);

  useEffect(() => {
    if (isPlayerOpen) return undefined;
    const streamId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (streamId) window.streamnexus?.stopAudioStream(streamId).catch(() => {});
    return undefined;
  }, [isPlayerOpen]);

  useEffect(() => () => {
    window.clearTimeout(playerControlsTimerRef.current);
    const streamId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (streamId) window.streamnexus?.stopAudioStream(streamId).catch(() => {});
  }, []);

  useEffect(() => {
    const video = playerVideoRef.current;
    if (!isPlayerOpen || !video) return undefined;
    setPlayerPlaybackError('');
    const updateTime = () => {
      setPlayerCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
      setPlayerDuration(Number.isFinite(video.duration) ? video.duration : 0);
      try { setPlayerSeekEnd(video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0); } catch { setPlayerSeekEnd(0); }
    };
    const updatePlayback = () => setPlayerPlaying(!video.paused);
    const updateVolume = () => { setPlayerVolume(video.volume); setPlayerMuted(video.muted); };
    updateTime();
    updatePlayback();
    updateVolume();
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('durationchange', updateTime);
    video.addEventListener('loadedmetadata', updateTime);
    video.addEventListener('play', updatePlayback);
    video.addEventListener('pause', updatePlayback);
    video.addEventListener('volumechange', updateVolume);
    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('durationchange', updateTime);
      video.removeEventListener('loadedmetadata', updateTime);
      video.removeEventListener('play', updatePlayback);
      video.removeEventListener('pause', updatePlayback);
      video.removeEventListener('volumechange', updateVolume);
    };
  }, [isPlayerOpen, playing?.url]);

  const togglePlayerPlayback = () => {
    const video = playerVideoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => setPlayerPlaybackError('Não foi possível iniciar a reprodução.'));
    else video.pause();
    revealPlayerControls();
  };

  const seekPlayer = (seconds) => {
    const video = playerVideoRef.current;
    if (!video) return;
    const start = video.seekable.length ? video.seekable.start(0) : 0;
    const end = Number.isFinite(video.duration) ? video.duration : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : video.currentTime;
    video.currentTime = Math.min(Math.max(video.currentTime + seconds, start), end);
    revealPlayerControls();
  };

  const setPlayerSeekPosition = (value) => {
    const video = playerVideoRef.current;
    if (!video) return;
    let start = 0;
    let end = Number.isFinite(video.duration) ? video.duration : 0;
    try {
      if (video.seekable.length) {
        start = video.seekable.start(0);
        if (!end) end = video.seekable.end(video.seekable.length - 1);
      }
    } catch { return; }
    if (!end) return;
    video.currentTime = Math.min(Math.max(Number(value), start), end);
    revealPlayerControls();
  };

  const togglePlayerMute = () => {
    const video = playerVideoRef.current;
    if (!video) return;
    const shouldUnmute = video.muted;
    if (shouldUnmute && video.volume === 0) video.volume = 0.5;
    video.muted = !shouldUnmute;
    setPlayerMuted(video.muted);
    revealPlayerControls();
  };

  const togglePlayerFullscreen = () => {
    const next = !playerFullscreen;
    setPlayerFullscreen(next);
    window.streamnexus?.setFullscreen(next).catch(() => {});
    revealPlayerControls();
  };

  useEffect(() => {
    if (!playing?.pending || !playing.torrentId) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const details = await callRd(`/torrents/info/${encodeURIComponent(playing.torrentId)}`);
        if (cancelled) return;
        if (details.links?.length) {
          const unrestricted = await callRd('/unrestrict/link', { method: 'POST', body: { link: details.links[0] } });
          if (cancelled) return;
          const sourceUrl = unrestricted.download || details.links[0];
          const playbackStream = await preparePlayerAudio(sourceUrl);
          if (cancelled) {
            if (playbackStream.id) window.streamnexus?.stopAudioStream(playbackStream.id).catch(() => {});
            return;
          }
          setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, ...playbackStream, pending: false, progress: 100 } : current);
          loadRdAccount();
          return;
        }
        if (['dead', 'error', 'virus', 'magnet_error'].includes(details.status)) {
          setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, pending: false, error: 'O Real-Debrid não conseguiu preparar este ficheiro.' } : current);
          return;
        }
        setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, progress: Number(details.progress || 0), transferStatus: details.status } : current);
        timer = window.setTimeout(poll, 7000);
      } catch (error) {
        if (cancelled) return;
        setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, error: getError(error) } : current);
        timer = window.setTimeout(poll, 12000);
      }
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [playing?.pending, playing?.torrentId, callRd, loadRdAccount]);

  useEffect(() => {
    if (window.streamnexus?.isDesktop) {
      window.streamnexus.loadIntegrations()
        .then((settings) => { setIntegrationSettings(settings); setIntegrationForm(settings); })
        .catch((error) => setIntegrationTest(getError(error)));
      return;
    }
    try {
      const settings = JSON.parse(sessionStorage.getItem('streamnexus.integrations') || '{"prowlarrUrl":"","prowlarrApiKey":""}');
      setIntegrationSettings(settings); setIntegrationForm(settings);
    } catch { /* mantém a configuração vazia */ }
  }, []);

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (activePage !== 'indexers') setActivePage('indexers');
        window.setTimeout(() => document.querySelector('#indexer-query')?.focus(), 0);
      }
      if (event.key === 'Escape') {
        if (modal?.type === 'player') { setPlaying(null); setSubtitleTrackUrl(''); }
        setModal(null);
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [activePage, modal]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    return () => window.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!deviceAuth) return undefined;
    let stopped = false;
    let timer;
    const start = Date.now();
    const poll = async () => {
      if (stopped) return;
      try {
        const credentials = await oauthRequest(`/device/credentials?client_id=${encodeURIComponent(RD_OPEN_SOURCE_CLIENT_ID)}&code=${encodeURIComponent(deviceAuth.device_code)}`);
        if (credentials.client_id && credentials.client_secret) {
          setDeviceStatus('A concluir ligação segura…');
          const tokenData = await oauthRequest('/token', { method: 'POST', body: { client_id: credentials.client_id, client_secret: credentials.client_secret, code: deviceAuth.device_code, grant_type: 'http://oauth.net/grant_type/device/1.0' } });
          if (!tokenData.access_token) throw new Error('Não foi possível finalizar a ligação.');
          const next = { ...tokenData, ...credentials, expires_at: Date.now() + (tokenData.expires_in || 0) * 1000 };
          await saveSession(next);
          setSession(next);
          setDeviceAuth(null);
          setDeviceStatus('');
          setModal(null);
          notify('Real-Debrid ligado com sucesso.');
          return;
        }
        if (Date.now() - start > deviceAuth.expires_in * 1000) {
          setDeviceStatus('Este código expirou. Gera um novo código para tentar novamente.');
          setDeviceAuth(null);
          return;
        }
      } catch (error) {
        if (error?.status && error.status !== 400 && error.status !== 403) setDeviceStatus(getError(error));
        else if (!error?.status && error?.message && !error.message.includes('fetch')) setDeviceStatus(getError(error));
      }
      timer = window.setTimeout(poll, Math.max(5, deviceAuth.interval || 5) * 1000);
    };
    timer = window.setTimeout(poll, Math.max(5, deviceAuth.interval || 5) * 1000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [deviceAuth, notify]);

  const connectRealDebrid = async () => {
    setRdError('');
    setRdBusy(true);
    setDeviceStatus('A preparar autorização segura…');
    const authWindow = window.streamnexus?.isDesktop ? null : window.open('about:blank', '_blank');
    try {
      const data = await oauthRequest(`/device/code?client_id=${RD_OPEN_SOURCE_CLIENT_ID}&new_credentials=yes`);
      if (!data.device_code) throw new Error(data.error_description || data.error || 'Não foi possível iniciar a autorização.');
      setDeviceAuth(data);
      setDeviceStatus('À espera de autorização na tua conta…');
      if (window.streamnexus?.isDesktop) {
        await window.streamnexus.openAuthWindow(data.verification_url || 'https://real-debrid.com/device');
      } else if (authWindow) {
        authWindow.opener = null;
        authWindow.location.replace(data.verification_url || 'https://real-debrid.com/device');
      }
    } catch (error) {
      if (authWindow && !authWindow.closed) authWindow.close();
      setDeviceStatus(getError(error));
    }
    finally { setRdBusy(false); }
  };

  const disconnectRealDebrid = async () => {
    await saveSession(null);
    setSession(null);
    setRdUser(null);
    setRdItems([]);
    setRdSearch(null);
    setRdError('');
    setModal(null);
    notify('Sessão Real-Debrid terminada neste dispositivo.');
  };

  const addMagnet = async (event) => {
    event.preventDefault();
    const value = magnet.trim();
    if (!value.startsWith('magnet:?')) { setRdError('Cola um endereço magnet válido.'); return; }
    setMagnetBusy(true);
    setRdError('');
    try {
      await callRd('/torrents/addMagnet', { method: 'POST', body: { magnet: value } });
      setMagnet('');
      await loadRdAccount();
      setModal({ type: 'downloads' });
      notify('Magnet enviado para a tua conta Real-Debrid.');
    } catch (error) { setRdError(getError(error)); }
    finally { setMagnetBusy(false); }
  };

  const selectTorrentFiles = async (id) => {
    try {
      const details = await callRd(`/torrents/info/${encodeURIComponent(id)}`);
      if (!details.files?.length) { notify('Os ficheiros ainda estão a ser preparados. Tenta novamente dentro de instantes.'); return; }
      await callRd(`/torrents/selectFiles/${encodeURIComponent(id)}`, { method: 'POST', body: { files: 'all' } });
      await loadRdAccount();
      notify('Ficheiros selecionados. O Real-Debrid está a preparar o conteúdo.');
    } catch (error) { setRdError(getError(error)); }
  };

  const findSubtitles = async (title, fileName = '') => {
    setSubtitleResults([]);
    setSubtitleError('');
    setSubtitleTrackUrl('');
    setSubtitleStatus('loading');
    try {
      if (!window.streamnexus?.isDesktop) throw new Error('As legendas OpenSubtitles estão disponíveis na app desktop.');
      const results = await window.streamnexus.searchSubtitles({
        tmdbId: title?.tmdbId,
        tmdbType: title?.tmdbType,
        query: fileName || title?.original || title?.title || '',
      });
      setSubtitleResults(results);
      setSubtitleStatus(results.length ? 'found' : 'empty');
    } catch (error) {
      setSubtitleError(getError(error));
      setSubtitleStatus('error');
    }
  };

  const chooseSubtitle = async (subtitle) => {
    setSubtitleStatus('downloading');
    setSubtitleError('');
    try {
      const result = await window.streamnexus.downloadSubtitle({ fileId: subtitle.fileId, fileName: subtitle.fileName });
      let vtt = String(result.text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').trim();
      if (!vtt.startsWith('WEBVTT')) vtt = `WEBVTT\n\n${vtt}`;
      const blob = new Blob([vtt], { type: 'text/vtt;charset=utf-8' });
      setSubtitleTrackUrl(URL.createObjectURL(blob));
      setSubtitleLabel(`OpenSubtitles · ${subtitle.label || subtitle.language || 'Legenda'}`);
      setSubtitleLanguage(subtitle.language || 'pt-PT');
      setActiveEmbeddedTrack(null);
      setEmbeddedSubtitleTracks((tracks) => tracks.map((track) => { track.mode = 'disabled'; return track; }));
      setSubtitleStatus('selected');
    } catch (error) {
      setSubtitleError(getError(error));
      setSubtitleStatus('error');
    }
  };

  const preparePlayerAudio = async (sourceUrl) => {
    if (!window.streamnexus?.isDesktop || !sourceUrl) return { url: sourceUrl, sourceUrl };
    const previousId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (previousId) await window.streamnexus.stopAudioStream(previousId).catch(() => {});
    try {
      const stream = await window.streamnexus.prepareAudioStream(sourceUrl);
      audioStreamIdRef.current = stream.id;
      return { ...stream, sourceUrl };
    } catch (error) {
      return { url: sourceUrl, sourceUrl, audioWarning: getError(error) };
    }
  };

  const openTorrentStream = async (torrent, titleHint = null) => {
    try {
      let details = await callRd(`/torrents/info/${encodeURIComponent(torrent.id)}`);
      if (details.status === 'waiting_files_selection') {
        await callRd(`/torrents/selectFiles/${encodeURIComponent(torrent.id)}`, { method: 'POST', body: { files: 'all' } });
        details = await callRd(`/torrents/info/${encodeURIComponent(torrent.id)}`);
      }
      const fileName = torrent.filename || details.filename || 'O teu conteúdo';
      const title = titleHint || { title: fileName, original: fileName };
      let streamUrl = '';
      if (details.links?.length) {
        const data = await callRd('/unrestrict/link', { method: 'POST', body: { link: details.links[0] } });
        streamUrl = data.download || details.links[0];
      }
      const playbackStream = streamUrl ? await preparePlayerAudio(streamUrl) : { url: '', sourceUrl: '' };
      setEmbeddedSubtitleTracks([]);
      setActiveEmbeddedTrack(null);
      setPlayerPlaybackError('');
      setSubtitleLabel('');
      setTrailerPlaying(false);
      setPlaying({ title: title.title || fileName, ...playbackStream, pending: !streamUrl, progress: Number(details.progress || 0), transferStatus: details.status, torrentId: torrent.id, metadata: title, fileName });
      setModal({ type: 'player' });
      findSubtitles(title, fileName);
      if (!streamUrl) notify('A reprodução abriu. Vai começar assim que o Real-Debrid disponibilizar um link de vídeo.');
    } catch (error) { setRdError(getError(error)); notify(getError(error)); }
  };

  const selectEmbeddedSubtitle = (track) => {
    const video = playerVideoRef.current;
    if (!video?.textTracks) return;
    Array.from(video.textTracks).forEach((item) => { item.mode = item === track ? 'showing' : 'disabled'; });
    setSubtitleTrackUrl('');
    setActiveEmbeddedTrack(track);
    setSubtitleLabel(track.label || track.language || 'Legendas originais do ficheiro');
    setSubtitleStatus('original');
  };

  const toggleSaved = (id) => {
    const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id];
    setSaved(next);
    localStorage.setItem('streamnexus.watchlist', JSON.stringify(next));
    notify(saved.includes(id) ? 'Removido da tua lista.' : 'Adicionado à tua lista.');
  };

  const searchResults = useMemo(() => {
    let result = catalogTitles;
    if (activePage === 'films') result = result.filter((item) => item.type === 'Filme');
    if (activePage === 'series') result = result.filter((item) => item.type === 'Série');
    if (activePage === 'watchlist') result = result.filter((item) => saved.includes(item.id));
    if (query.trim()) {
      const search = normalizeSearchText(query);
      result = result.filter((item) => normalizeSearchText(`${item.title} ${item.original} ${(item.aliases || []).join(' ')} ${item.genre} ${item.type}`).includes(search));
    }
    if (genre !== 'Todos') result = result.filter((item) => item.genre === genre || item.genres?.includes(genre));
    return result;
  }, [activePage, catalogTitles, genre, query, saved]);

  useEffect(() => { setVisibleCount(24); }, [activePage, genre, query]);

  useEffect(() => {
    if (!adultEnabled && searchCategory === 'adult') {
      setSearchCategory('movies');
      setReleaseSearch(null);
    }
  }, [adultEnabled, searchCategory]);

  const toggleAdultSearch = (enabled) => {
    setAdultEnabled(enabled);
    try { localStorage.setItem('streamnexus.settings.adult', String(enabled)); } catch { /* preference remains for this session */ }
    if (!enabled && searchCategory === 'adult') {
      setSearchCategory('movies');
      setReleaseSearch(null);
    }
  };

  const selectedTitle = catalogTitles.find((item) => item.id === modal?.id);
  const pageTitle = ({ home: 'Descobrir', films: 'Filmes', series: 'Séries', tv: 'TV', music: 'Música', books: 'Livros', adult: 'Adultos', indexers: 'Pesquisar', watchlist: 'A minha lista', downloads: 'Real-Debrid' })[activePage] || 'Descobrir';
  const browseCategoryKey = PAGE_SEARCH_CATEGORY[activePage] || activePage;
  const genreTitles = activePage === 'films' ? catalogTitles.filter((item) => item.type === 'Filme') : catalogTitles.filter((item) => item.type === 'Série');
  const browseGenres = [...new Set(genreTitles.flatMap((item) => item.genres?.length ? item.genres : [item.genre]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-PT'));
  const readyTorrents = rdItems.filter((item) => item.status === 'downloaded');
  const browsingShelves = activePage === 'films'
    ? makeDistinctShelves([
      { eyebrow: 'EM ALTA', title: 'Filmes populares', items: catalogRows?.trending?.filter((item) => item.type === 'Filme')?.length ? catalogRows.trending.filter((item) => item.type === 'Filme') : catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme'), page: 'films' },
        { eyebrow: 'TENDÊNCIAS', title: 'Populares no StreamNexus', items: catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme').slice().reverse(), page: 'films' },
      { eyebrow: 'NO CINEMA E EM CASA', title: 'Estreias recentes', items: catalogRows?.nowPlaying?.length ? catalogRows.nowPlaying : catalogTitles.filter((item) => item.type === 'Filme'), page: 'films' },
      { eyebrow: 'ESCOLHIDOS PARA TI', title: 'Mais bem avaliados', items: catalogRows?.topMovies?.length ? catalogRows.topMovies : [...catalogTitles].filter((item) => item.type === 'Filme').sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'films', ranked: true },
    ], [featuredTitle.id])
    : activePage === 'series'
      ? makeDistinctShelves([
        { eyebrow: 'EM ALTA', title: 'Séries populares', items: catalogRows?.trending?.filter((item) => item.type === 'Série')?.length ? catalogRows.trending.filter((item) => item.type === 'Série') : catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série'), page: 'series' },
        { eyebrow: 'TENDÊNCIAS', title: 'Séries populares no StreamNexus', items: catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série').slice().reverse(), page: 'series' },
        { eyebrow: 'NOVOS EPISÓDIOS', title: 'Séries a acompanhar', items: catalogRows?.airingSeries?.length ? catalogRows.airingSeries : catalogTitles.filter((item) => item.type === 'Série'), page: 'series' },
        { eyebrow: 'ESCOLHIDOS PARA TI', title: 'Mais bem avaliadas', items: catalogRows?.topSeries?.length ? catalogRows.topSeries : [...catalogTitles].filter((item) => item.type === 'Série').sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'series', ranked: true },
      ], [featuredTitle.id])
      : makeDistinctShelves([
        { eyebrow: 'A TENDÊNCIA DA SEMANA', title: 'Em alta agora', items: catalogRows?.trending?.length ? catalogRows.trending : [...catalogTitles].sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'films' },
        { eyebrow: 'FILMES MAIS VISTOS', title: 'Populares no StreamNexus', items: catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme').slice().reverse(), page: 'films' },
        { eyebrow: 'ESTREIAS RECENTES', title: 'Filmes para descobrir', items: catalogRows?.nowPlaying?.length ? catalogRows.nowPlaying : catalogTitles.filter((item) => item.type === 'Filme'), page: 'films' },
        { eyebrow: 'SÉRIES MAIS VISTAS', title: 'Séries populares', items: catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série').slice().reverse(), page: 'series' },
        { eyebrow: 'NOVOS EPISÓDIOS', title: 'Séries em destaque', items: catalogRows?.airingSeries?.length ? catalogRows.airingSeries : catalogTitles.filter((item) => item.type === 'Série'), page: 'series' },
        { eyebrow: 'MAIS BEM AVALIADOS', title: 'Favoritos do público', items: [...(catalogRows?.topMovies || []), ...(catalogRows?.topSeries || [])].length ? [...(catalogRows?.topMovies || []), ...(catalogRows?.topSeries || [])] : [...catalogTitles].sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'films', ranked: true },
      ], [featuredTitle.id]);

  const visibleBrowsingShelves = genre === 'Todos' ? browsingShelves : makeDistinctShelves(
    browsingShelves.map((shelf) => ({ ...shelf, items: shelf.items.filter((item) => item.genre === genre || item.genres?.includes(genre)) })),
  []);

  const searchTitleInLibrary = async (title) => {
    if (!session?.access_token) {
      setRdSearch({ titleId: title.id, status: 'disconnected', matches: [] });
      return;
    }
    setRdSearch({ titleId: title.id, status: 'loading', matches: [] });
    try {
      const torrents = await callRd('/torrents?limit=5000');
      const library = Array.isArray(torrents) ? torrents : [];
      setRdItems(library);
      const matches = library.filter((torrent) => matchesTorrentTitle(torrent, title)).sort((a, b) => Number(b.status === 'downloaded') - Number(a.status === 'downloaded'));
      setRdSearch({ titleId: title.id, status: matches.length ? 'found' : 'empty', matches });
    } catch (error) {
      setRdSearch({ titleId: title.id, status: 'error', matches: [], message: getError(error) });
    }
  };

  const searchReleaseSources = async (queryText, categoryKey, titleId = null, collectionTitle = '') => {
    const category = SEARCH_CATEGORIES[categoryKey] || SEARCH_CATEGORIES.movies;
    const queryValue = String(queryText || '').trim();
    if (!queryValue) return;
    const requestId = ++releaseRequestRef.current;
    if (!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey) {
      setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: 'error', items: [], message: 'Configura o endereço e a API key do Prowlarr nas definições para pesquisar.' });
      return;
    }
    setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: 'loading', items: [] });
    try {
      let items;
      if (window.streamnexus?.isDesktop) {
        items = await window.streamnexus.searchReleases({ query: queryValue, type: category.type, categories: [category.category] });
      } else {
        const url = new URL(`${integrationSettings.prowlarrUrl.replace(/\/+$/, '')}/api/v1/search`);
        url.searchParams.set('query', queryValue); url.searchParams.set('type', category.type); url.searchParams.append('categories', category.category);
        const response = await fetch(url, { headers: { 'X-Api-Key': integrationSettings.prowlarrApiKey } });
        if (!response.ok) throw new Error(`Prowlarr respondeu com erro ${response.status}.`);
        items = (await response.json()).map((release) => ({ ...release, id: release.guid || release.downloadUrl || release.title, canGrab: Boolean(release.magnetUrl || release.downloadUrl), hasMagnet: Boolean(release.magnetUrl) }));
      }
      if (requestId !== releaseRequestRef.current) return;
      setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: items.length ? 'found' : 'empty', items });
    } catch (error) {
      if (requestId !== releaseRequestRef.current) return;
      setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: 'error', items: [], message: getError(error) });
    }
  };

  useEffect(() => {
    if (!['tv', 'music', 'books', 'adult'].includes(activePage) || (activePage === 'adult' && !adultEnabled)) return;
    const categoryKey = PAGE_SEARCH_CATEGORY[activePage] || activePage;
    if (!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey || (releaseSearch?.categoryKey === categoryKey && releaseSearch?.collectionTitle && releaseSearch.status !== 'error')) return;
    if (lastBrowsePageRef.current !== activePage) {
      lastBrowsePageRef.current = activePage;
      browseVisitRef.current += 1;
    }
    const firstCollection = DISCOVERY_COLLECTIONS[activePage][0];
    const requestKey = `${activePage}:${browseVisitRef.current}:${firstCollection.title}`;
    if (collectionRequestRef.current === requestKey) return;
    collectionRequestRef.current = requestKey;
    searchReleaseSources(firstCollection.query, categoryKey, null, firstCollection.title);
  }, [activePage, adultEnabled, integrationSettings.prowlarrUrl, integrationSettings.prowlarrApiKey, releaseSearch?.categoryKey]);

  const saveIntegrationSettings = async (event) => {
    event.preventDefault();
    setIntegrationTest('A guardar configuração…');
    try {
      const next = {
        ...integrationForm,
        prowlarrUrl: integrationForm.prowlarrUrl.trim().replace(/\/+$/, ''),
        prowlarrApiKey: integrationForm.prowlarrApiKey.trim(),
        tmdbApiKey: integrationForm.tmdbApiKey.trim(),
        openSubtitlesApiKey: integrationForm.openSubtitlesApiKey.trim(),
        openSubtitlesUsername: integrationForm.openSubtitlesUsername.trim(),
      };
      if (window.streamnexus?.isDesktop) await window.streamnexus.saveIntegrations(next);
      else sessionStorage.setItem('streamnexus.integrations', JSON.stringify(next));
      setIntegrationSettings(next);
      setIntegrationForm(next);
      setIntegrationTest('Configuração guardada.');
      notify('Prowlarr configurado.');
    } catch (error) { setIntegrationTest(getError(error)); }
  };

  const testProwlarr = async () => {
    setIntegrationTest('A testar ligação…');
    try {
      const base = integrationForm.prowlarrUrl.trim().replace(/\/+$/, '');
      if (!base || !integrationForm.prowlarrApiKey.trim()) throw new Error('Preenche o endereço e a API key.');
      if (window.streamnexus?.isDesktop) {
        await window.streamnexus.testProwlarr({ prowlarrUrl: base, prowlarrApiKey: integrationForm.prowlarrApiKey.trim() });
      } else {
        const response = await fetch(`${base}/api/v1/system/status`, { headers: { 'X-Api-Key': integrationForm.prowlarrApiKey.trim() } });
        if (!response.ok) throw new Error(`Prowlarr respondeu com erro ${response.status}.`);
      }
      setIntegrationTest('Ligação concluída. Prowlarr está acessível.');
    } catch (error) { setIntegrationTest(getError(error)); }
  };

  const testTmdb = async () => {
    setIntegrationTest('A testar TMDB…');
    try {
      if (!integrationForm.tmdbApiKey.trim()) throw new Error('Preenche a API key do TMDB.');
      if (!window.streamnexus?.isDesktop) throw new Error('Testa esta ligação na app desktop.');
      await window.streamnexus.testTmdb({ tmdbApiKey: integrationForm.tmdbApiKey.trim() });
      setIntegrationTest('TMDB ligado. O catálogo será atualizado ao guardar.');
    } catch (error) { setIntegrationTest(getError(error)); }
  };

  const testOpenSubtitles = async () => {
    setIntegrationTest('A testar OpenSubtitles…');
    try {
      const credentials = {
        openSubtitlesApiKey: integrationForm.openSubtitlesApiKey.trim(),
        openSubtitlesUsername: integrationForm.openSubtitlesUsername.trim(),
        openSubtitlesPassword: integrationForm.openSubtitlesPassword,
      };
      if (Object.values(credentials).some((value) => !value)) throw new Error('Preenche a API key, o utilizador e a palavra-passe do OpenSubtitles.');
      if (!window.streamnexus?.isDesktop) throw new Error('Testa esta ligação na app desktop.');
      await window.streamnexus.testOpenSubtitles(credentials);
      setIntegrationTest('OpenSubtitles ligado. As legendas PT-PT aparecem primeiro no leitor.');
    } catch (error) { setIntegrationTest(getError(error)); }
  };

  const grabRelease = async (release) => {
    if (!session?.access_token) { setModal({ type: 'connect' }); return; }
    setReleaseBusyId(release.id);
    try {
      const active = await refreshSession(session);
      if (window.streamnexus?.isDesktop) {
        await window.streamnexus.addReleaseToRealDebrid({ releaseId: release.id, token: active.access_token });
      } else if (release.magnetUrl?.startsWith('magnet:?')) {
        await callRd('/torrents/addMagnet', { method: 'POST', body: { magnet: release.magnetUrl } });
      } else {
        throw new Error('Para adicionar links de indexadores diretamente, abre a app desktop StreamNexus.');
      }
      notify('Lançamento enviado para a tua conta Real-Debrid.');
      if (modal?.type === 'details') await searchTitleInLibrary(catalogTitles.find((item) => item.id === modal.id));
      else await loadRdAccount();
    } catch (error) { notify(getError(error)); }
    finally { setReleaseBusyId(''); }
  };

  const openDetails = (title) => {
    setModal({ type: 'details', id: title.id });
    setTrailer({ status: 'loading', key: '', name: '' });
    setTrailerPlaying(false);
    const requestId = ++trailerRequestRef.current;
    if (!window.streamnexus?.isDesktop || !integrationSettings.tmdbApiKey) {
      setTrailer({ status: 'unavailable', key: '', name: '' });
    } else {
      window.streamnexus.fetchTrailer({ id: title.tmdbId, type: title.tmdbType || (title.type === 'Série' ? 'tv' : 'movie'), title: title.original || title.title, year: title.year })
        .then((result) => {
          if (requestId === trailerRequestRef.current) setTrailer(result?.key ? { status: 'ready', key: result.key, name: result.name || 'Trailer' } : { status: 'empty', key: '', name: '' });
        })
        .catch(() => { if (requestId === trailerRequestRef.current) setTrailer({ status: 'error', key: '', name: '' }); });
    }
    searchTitleInLibrary(title);
    searchReleaseSources(title.original || title.title, title.type === 'Série' ? 'series' : 'movies', title.id);
  };
  const startPlayback = (title) => {
    if (!session?.access_token) { setModal({ type: 'connect' }); return; }
    if (rdSearch?.titleId === title.id && rdSearch.matches?.length) { openTorrentStream(rdSearch.matches[0], title); return; }
    setMagnet('');
    setModal({ type: 'magnet', title });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); setActivePage('home'); }} aria-label="StreamNexus, início">
          <span className="brand-mark"><span></span><span></span></span>
          <span className="brand-word">stream<span>nexus</span><small>O teu próximo favorito</small></span>
        </a>

        <div className="side-section">
          <nav className="side-nav" aria-label="Navegação principal">
            {nav.map((item) => <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => { setActivePage(item.id); setQuery(''); setGenre('Todos'); setProfileMenuOpen(false); if (item.id === 'indexers') { setSearchCategory('movies'); setReleaseSearch(null); } }}><Icon name={item.icon} size={18}/><span>{item.label}</span></button>)}
          </nav>
        </div>
        <div className="profile-menu-wrap header-profile" ref={profileMenuRef}>
          <button className={`profile-trigger ${profileMenuOpen ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
            <span className="top-avatar">{rdUser?.username?.slice(0, 1)?.toUpperCase() || 'S'}</span>
            <span className="profile-trigger-name">{rdUser?.username || 'Perfil'}</span><Icon name="chevron" size={14}/>
          </button>
          {profileMenuOpen && <div className="profile-menu" role="menu">
            <div className="profile-menu-identity"><span className="top-avatar">{rdUser?.username?.slice(0, 1)?.toUpperCase() || 'S'}</span><span><strong>{rdUser?.username || 'StreamNexus'}</strong><small>{session?.access_token ? (rdUser?.type === 'premium' ? 'Real-Debrid Premium' : 'Real-Debrid ligado') : 'Conta local'}</small></span></div>
            <div className="profile-menu-divider"></div>
            <button role="menuitem" onClick={() => { setActivePage('watchlist'); setProfileMenuOpen(false); }}><Icon name="bookmark" size={16}/>A minha lista{saved.length > 0 && <small>{saved.length}</small>}</button>
            <button role="menuitem" onClick={() => { setActivePage('downloads'); setProfileMenuOpen(false); loadRdAccount(); }}><Icon name="cloud" size={16}/>Real-Debrid{session?.access_token && <small>{readyTorrents.length} prontos</small>}</button>
            <div className="profile-menu-divider"></div>
            <button role="menuitem" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setProfileMenuOpen(false); setModal({ type: 'integrations' }); }}><Icon name="settings" size={16}/>Definições e integrações</button>
          </div>}
        </div>
      </aside>

      <main className="main-content" id="top">
        {activePage === 'indexers' ? (
          <section className="indexer-page page-in">
            <div className="page-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> PROWLARR · REAL-DEBRID</span><h1>Pesquisar lançamentos</h1><p>Pesquisa nos indexadores configurados no Prowlarr e envia a tua escolha para a nuvem Real-Debrid.</p></div><button className="button button-quiet" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}><Icon name="settings" size={15}/>Configurar Prowlarr</button></div>
            <form className="indexer-search-form" onSubmit={(event) => { event.preventDefault(); searchReleaseSources(indexerQuery, searchCategory); }}>
              <label className="input-label" htmlFor="indexer-query">O que procuras?</label>
              <div className="indexer-search-controls"><input id="indexer-query" value={indexerQuery} onChange={(event) => { setIndexerQuery(event.target.value); setReleaseSearch(null); }} placeholder="Título, artista, álbum, autor…"/><select value={searchCategory} onChange={(event) => { setSearchCategory(event.target.value); setReleaseSearch(null); }} aria-label="Tipo de conteúdo">{Object.entries(SEARCH_CATEGORIES).filter(([key]) => key !== 'adult' || adultEnabled).map(([key, item]) => <option key={key} value={key}>{item.label} · {item.manager}</option>)}</select><button className="button button-primary" disabled={!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey || !indexerQuery.trim()}><Icon name="search" size={16}/>Pesquisar</button></div>
              <p className="indexer-search-hint">A pesquisa envia ao Prowlarr o tipo e a categoria Torznab de {SEARCH_CATEGORIES[searchCategory].manager}. Os resultados são enviados ao Real-Debrid.</p>
            </form>
            {!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey ? <div className="empty-list indexer-empty"><span><Icon name="link" size={22}/></span><strong>Configura o Prowlarr para começar</strong><p>Adiciona o endereço local e a API key do teu Prowlarr. A app pesquisa os indexadores que já configuraste lá.</p><button className="button button-primary" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar integração</button></div> : <ReleaseSearchResults search={releaseSearch} categoryKey={searchCategory} connected={Boolean(session?.access_token)} busyId={releaseBusyId} onAdd={grabRelease}/>}
            <div className="indexer-manager-note"><strong>Como funciona</strong><span>Os nomes Radarr, Sonarr, Lidarr, Readarr e Whisparr identificam aqui as categorias de filmes, séries, música, livros e Adulto. O Prowlarr pesquisa apenas indexadores configurados para cada categoria; não precisas de instalar os outros gestores. A escolha é enviada ao Real-Debrid.</span><button className="text-link" onClick={() => setModal({ type: 'integrations' })}>Gerir ligação <Icon name="chevron" size={14}/></button></div>
          </section>
        ) : activePage === 'downloads' ? (
          <section className="downloads-page page-in">
            <div className="page-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> A TUA NUVEM PESSOAL</span><h1>Real-Debrid</h1><p>Os teus torrents e downloads, prontos a ver.</p></div><div className="heading-actions"><button className="button button-quiet" onClick={loadRdAccount} disabled={rdBusy}><Icon name="refresh" size={16}/>{rdBusy ? 'A sincronizar…' : 'Sincronizar'}</button><button className="button button-primary" onClick={() => { setMagnet(''); setModal({ type: 'magnet' }); }} disabled={!session?.access_token}><Icon name="plus" size={17}/>Adicionar magnet</button></div></div>
            {!session?.access_token ? <div className="empty-cloud"><span className="empty-cloud-icon"><Icon name="cloud" size={26}/></span><h2>A tua biblioteca começa aqui</h2><p>Liga a tua conta Real-Debrid para ver e reproduzir os teus conteúdos neste espaço.</p><button className="button button-primary" onClick={() => setModal({ type: 'connect' })}>Ligar Real-Debrid <Icon name="chevron" size={16}/></button></div> : <>
              <div className="rd-account-strip"><div className="rd-account-avatar">{rdUser?.username?.slice(0, 1)?.toUpperCase() || 'R'}</div><div><strong>{rdUser?.username || 'A carregar conta…'}</strong><span>{rdUser?.type === 'premium' ? 'Conta Premium' : 'Conta Real-Debrid'}{rdUser?.expiration ? ` · válida até ${formatDate(rdUser.expiration)}` : ''}</span></div><span className="account-connected"><i></i> Ligado</span></div>
              {rdError && <div className="inline-error"><Icon name="alert" size={16}/>{rdError}</div>}
              <div className="library-stats"><div className="stat-card"><span>Itens na nuvem</span><strong>{rdItems.length.toString().padStart(2, '0')}</strong><small>na tua conta</small></div><div className="stat-card"><span>Prontos a ver</span><strong>{readyTorrents.length.toString().padStart(2, '0')}</strong><small>sem espera</small></div><div className="stat-card"><span>Estado da conta</span><strong className="status-active">Ativa</strong><small>sincronizada agora</small></div></div>
              <div className="section-heading downloads-heading"><div><span className="eyebrow">A TUA COLEÇÃO</span><h2>Conteúdos recentes</h2></div><span className="count-pill">{rdItems.length} {rdItems.length === 1 ? 'item' : 'itens'}</span></div>
              {rdItems.length ? <div className="torrent-list">{rdItems.map((torrent) => <TorrentRow key={torrent.id} torrent={torrent} onPlay={() => openTorrentStream(torrent)} onSelect={() => selectTorrentFiles(torrent.id)} onDelete={async () => { try { await callRd(`/torrents/delete/${encodeURIComponent(torrent.id)}`, { method: 'DELETE' }); await loadRdAccount(); notify('Item removido da tua conta.'); } catch (error) { setRdError(getError(error)); } }} />)}</div> : <div className="empty-list"><span><Icon name="film" size={22}/></span><strong>Ainda não há conteúdo aqui</strong><p>Adiciona um magnet para o enviares para a tua conta Real-Debrid.</p><button className="text-link" onClick={() => setModal({ type: 'magnet' })}>Adicionar o primeiro magnet <Icon name="chevron" size={14}/></button></div>}
            </>}
          </section>
        ) : ['home', 'films', 'series'].includes(activePage) && !query ? (
          <div className={`home-page page-in ${activePage !== 'home' ? 'catalog-browse-page' : ''}`}>
            {genre === 'Todos' && <section className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,9,14,.97) 0%, rgba(8,9,14,.89) 29%, rgba(8,9,14,.45) 58%, rgba(8,9,14,.08) 100%), linear-gradient(0deg, rgba(9,10,15,1) 0%, rgba(9,10,15,0) 35%), url(${featuredTitle.backdrop})` }}>
              <div className="hero-grain"></div><div className="hero-content"><div className="hero-kicker"><span className="live-mark"></span> {activePage === 'films' ? 'FILMES PARA DESCOBRIR' : activePage === 'series' ? 'SÉRIES EM DESTAQUE' : catalogStatus === 'ready' ? 'EM ALTA ESTA SEMANA' : 'A TUA PRÓXIMA DESCOBERTA'} {featuredTitle.type.toUpperCase()}</div><div className="hero-title-wrap"><span className="hero-title-small">{featuredTitle.original}</span><h1>{featuredTitle.title}</h1></div><p className="hero-copy">{featuredTitle.description}</p><div className="hero-meta"><span className="rating-star">★</span><strong>{featuredTitle.rating}</strong><i></i><span>{featuredTitle.year || 'Recente'}</span><i></i><span>{featuredTitle.genre}</span><span className="quality-tag">{featuredTitle.type.toUpperCase()}</span></div><div className="hero-actions"><button className="button button-primary hero-play" onClick={() => openDetails(featuredTitle)}><Icon name="play" size={17}/>Ver agora</button><button className="button button-glass" onClick={() => openDetails(featuredTitle)}>Mais informações <Icon name="chevron" size={15}/></button><button className={`hero-save ${saved.includes(featuredTitle.id) ? 'is-saved' : ''}`} aria-label="Adicionar à minha lista" onClick={() => toggleSaved(featuredTitle.id)}><Icon name={saved.includes(featuredTitle.id) ? 'check' : 'plus'} size={18}/></button></div></div>
              <div className="hero-pagination"><button aria-label="Anterior" className="hero-arrow" onClick={() => setHeroIndex((index) => (index - 1 + featuredTitles.length) % featuredTitles.length)}><Icon name="chevron" size={17}/></button><div><span className="current-slide">{String((heroIndex % featuredTitles.length) + 1).padStart(2, '0')}</span><span className="slide-track"><i style={{ width: `${((heroIndex % featuredTitles.length) + 1) / featuredTitles.length * 100}%` }}></i></span><span>{String(featuredTitles.length).padStart(2, '0')}</span></div><button aria-label="Seguinte" className="hero-arrow" onClick={() => setHeroIndex((index) => (index + 1) % featuredTitles.length)}><Icon name="chevron" size={17}/></button></div>
              <div className="hero-side-label"><span>{catalogStatus === 'ready' ? 'TENDÊNCIAS' : 'DESTAQUES'}</span><i></i><span>{featuredTitle.year || '2026'}</span></div>
            </section>}

            {activePage !== 'home' && <div className="genre-chips" aria-label="Filtrar por género"><button className={genre === 'Todos' ? 'active' : ''} onClick={() => setGenre('Todos')}>Todos</button>{browseGenres.map((category) => <button key={category} className={genre === category ? 'active' : ''} onClick={() => setGenre(category)}>{category}</button>)}</div>}

            {genre !== 'Todos' && visibleBrowsingShelves.length === 0 && <div className="empty-list catalog-empty"><span><Icon name="search" size={22}/></span><strong>Sem títulos nesta categoria</strong><p>Experimenta outro género ou volta a ver tudo.</p></div>}
            {visibleBrowsingShelves.map((shelf, shelfIndex) => <section className={`content-section discovery-rail ${shelfIndex === 0 ? 'discover-section' : ''}`} key={shelf.title}>
              <div className="section-heading"><div><span className="eyebrow">{shelf.eyebrow}</span><h2>{shelf.title}</h2></div><div className="section-controls"><button className="view-all" onClick={() => { setActivePage(shelf.page); setQuery(''); }}>{shelf.page === 'series' ? 'Todas as séries' : 'Explorar catálogo'} <Icon name="chevron" size={14}/></button><div className="arrow-pair"><button aria-label="Anterior" onClick={(event) => event.currentTarget.closest('.content-section').querySelector('.poster-row').scrollBy({ left: -500, behavior: 'smooth' })}><Icon name="chevron" size={16}/></button><button aria-label="Seguinte" onClick={(event) => event.currentTarget.closest('.content-section').querySelector('.poster-row').scrollBy({ left: 500, behavior: 'smooth' })}><Icon name="chevron" size={16}/></button></div></div></div>
              <div className={`poster-row ${shelf.ranked ? 'ranked-row' : ''}`}>{shelf.items.map((item, index) => <PosterCard key={item.id} item={item} index={index} rank={shelf.ranked ? index + 1 : null} saved={saved.includes(item.id)} onOpen={() => openDetails(item)} onSave={() => toggleSaved(item.id)}/>)}</div>
            </section>)}

            {activePage === 'home' && <section className="wide-promo"><div className="promo-orbit one"></div><div className="promo-orbit two"></div><div className="promo-copy"><span className="eyebrow"><span className="pulse-dot"></span> UMA SÓ CASA PARA TUDO O QUE VÊS</span><h2>A tua coleção.<br/><span>Sem fronteiras.</span></h2><p>Liga o Real-Debrid para trazer a tua biblioteca e os teus links para aqui.</p><button className="button button-light" onClick={() => setModal({ type: 'connect' })}>{session?.access_token ? 'Gerir integração' : 'Ligar Real-Debrid'} <Icon name="chevron" size={15}/></button></div><div className="promo-art"><span className="promo-disc disc-one"></span><span className="promo-disc disc-two"></span><span className="promo-card-art"><Icon name="play" size={24}/></span></div></section>}
          </div>
        ) : ['tv', 'music', 'books', 'adult'].includes(activePage) ? (
          <section className="media-browse-page page-in">
            <div className="media-browse-heading"><div><span className="eyebrow">A TUA PRÓXIMA DESCOBERTA</span><h1>{pageTitle}</h1><p>{activePage === 'tv' ? 'Episódios, programas e minisséries encontrados nos teus indexadores.' : activePage === 'music' ? 'Álbuns, bandas sonoras e sons para todos os momentos.' : activePage === 'books' ? 'Encontra a próxima história para ler.' : 'Explora conteúdos adultos através das categorias configuradas no Prowlarr.'}</p></div><span className="media-browse-emblem"><Icon name={SEARCH_CATEGORIES[browseCategoryKey].icon} size={25}/></span></div>
            {activePage === 'adult' && !adultEnabled ? <div className="browse-gate"><span className="browse-gate-icon"><Icon name="adult" size={25}/></span><div><strong>Pesquisa desativada</strong><p>Ativa a categoria Adultos nas definições quando quiseres usá-la.</p></div><button className="button button-primary" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Abrir definições <Icon name="settings" size={14}/></button></div> : <>
              <div className="collection-grid">{DISCOVERY_COLLECTIONS[activePage].map((collection) => <button key={collection.title} className={`collection-card accent-${collection.accent} ${releaseSearch?.collectionTitle === collection.title ? 'selected' : ''}`} onClick={() => searchReleaseSources(collection.query, browseCategoryKey, null, collection.title)}><span className="collection-icon"><Icon name={collection.icon} size={20}/></span><span className="collection-card-copy"><strong>{collection.title}</strong><small>{collection.subtitle}</small></span><Icon name="chevron" size={17}/></button>)}</div>
              {!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey ? <div className="browse-setup-note"><Icon name="link" size={17}/><span>Configura o Prowlarr para carregar resultados nestas coleções.</span><button className="text-link" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar <Icon name="chevron" size={13}/></button></div> : <section className="release-panel collection-results-panel"><div className="release-panel-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> {SEARCH_CATEGORIES[browseCategoryKey].manager.toUpperCase()} · PROWLARR</span><strong>{releaseSearch?.categoryKey === browseCategoryKey && releaseSearch.collectionTitle ? releaseSearch.collectionTitle : 'A carregar uma coleção'}</strong></div></div><ReleaseSearchResults search={releaseSearch?.categoryKey === browseCategoryKey && !releaseSearch.titleId && releaseSearch.collectionTitle ? releaseSearch : null} categoryKey={browseCategoryKey} connected={Boolean(session?.access_token)} busyId={releaseBusyId} onAdd={grabRelease}/></section>}
            </>}
          </section>
        ) : (
          <section className="catalog-page page-in">
            <div className="page-heading"><div><span className="eyebrow">O UNIVERSO É TEU</span><h1>{query ? 'Resultados da pesquisa' : pageTitle}</h1><p>{query ? `O que encontrámos para “${query}”.` : activePage === 'watchlist' ? 'Os títulos que guardaste para ver mais tarde.' : 'Escolhe a próxima história para a tua noite.'}</p></div>{['films', 'series'].includes(activePage) && <div className="catalog-filter"><label htmlFor="genre-select">Género</label><select id="genre-select" value={genre} onChange={(event) => setGenre(event.target.value)}><option>Todos</option>{browseGenres.map((category) => <option key={category}>{category}</option>)}</select></div>}</div>
            <div className="catalog-summary"><span>{searchResults.length} {searchResults.length === 1 ? 'título' : 'títulos'}</span><div className="active-filter"><span></span>Para descobrir</div></div>
            {searchResults.length ? <><div className="catalog-grid">{searchResults.slice(0, visibleCount).map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={saved.includes(item.id)} onOpen={() => openDetails(item)} onSave={() => toggleSaved(item.id)}/>)}</div>{visibleCount < searchResults.length && <div className="load-more-wrap"><button className="button button-quiet load-more" onClick={() => setVisibleCount((count) => Math.min(count + 24, searchResults.length))}>Carregar mais títulos <span>{Math.min(24, searchResults.length - visibleCount)} de {searchResults.length - visibleCount}</span></button></div>}</> : <div className="empty-list catalog-empty"><span><Icon name={activePage === 'watchlist' ? 'bookmark' : 'search'} size={22}/></span><strong>{activePage === 'watchlist' ? 'A tua lista ainda está vazia' : 'Não encontrámos esse título'}</strong><p>{activePage === 'watchlist' ? 'Guarda qualquer filme ou série com o botão +.' : 'Experimenta outro título ou género.'}</p>{activePage === 'watchlist' && <button className="text-link" onClick={() => setActivePage('home')}>Explorar catálogo <Icon name="chevron" size={14}/></button>}</div>}
          </section>
        )}
        {['home', 'films', 'series'].includes(activePage) && !query && <div className={`catalog-status ${catalogStatus === 'error' ? 'is-error' : ''}`}><span>{catalogStatus === 'loading' ? 'A atualizar tendências e estreias…' : catalogStatus === 'ready' ? `Catálogo atualizado em ${catalogUpdated}.` : catalogStatus === 'error' ? 'Falha ao atualizar. A mostrar o último catálogo disponível.' : 'Catálogo de demonstração. Liga o TMDB para ver títulos e tendências atualizados.'}</span><button className="text-link" onClick={() => integrationSettings.tmdbApiKey ? refreshCatalog() : setModal({ type: 'integrations' })} disabled={catalogStatus === 'loading'}>{integrationSettings.tmdbApiKey ? 'Atualizar' : 'Configurar TMDB'} <Icon name="chevron" size={14}/></button></div>}
        <footer className="footer"><span>© 2026 StreamNexus</span><span>Este produto usa a API do TMDB e não é endossado nem certificado pelo TMDB.</span><button onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Integrações <Icon name="settings" size={13}/></button></footer>
      </main>

      {notice && !isPlayerOpen && <div className="toast"><span className="toast-check"><Icon name="check" size={14}/></span>{notice}</div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { if (modal?.type === 'player') { setPlaying(null); setSubtitleTrackUrl(''); } setModal(null); setDeviceAuth(null); setDeviceStatus(''); } }}>
        {modal.type === 'details' && selectedTitle && <div className="detail-modal modal-card">
          <div className="detail-backdrop" style={{ backgroundImage: `linear-gradient(0deg,#101117 0%,rgba(16,17,23,.93) 13%,rgba(16,17,23,0) 100%),linear-gradient(90deg,rgba(16,17,23,.45),transparent),url(${selectedTitle.backdrop})` }}></div>
          <button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button>
          <div className="detail-content">
            <span className="eyebrow"><span className="pulse-dot"></span>{selectedTitle.type.toUpperCase()} · {selectedTitle.year}</span>
            <h2>{selectedTitle.title}</h2>
            <div className="detail-meta"><span className="rating-star">★</span><b>{selectedTitle.rating}</b><i></i><span>{selectedTitle.runtime}</span><i></i><span>{selectedTitle.genre}</span><span className="quality-tag">4K UHD</span></div>
            <p>{selectedTitle.description}</p>
            <div className="detail-actions"><button className="button button-primary" onClick={() => startPlayback(selectedTitle)}><Icon name="play" size={16}/>Ver agora</button><button className="button button-glass" onClick={() => toggleSaved(selectedTitle.id)}><Icon name={saved.includes(selectedTitle.id) ? 'check' : 'plus'} size={16}/>{saved.includes(selectedTitle.id) ? 'Na tua lista' : 'A minha lista'}</button></div>
            <div className="detail-divider"></div>
            <div className="detail-facts"><span><small>TÍTULO ORIGINAL</small><strong>{selectedTitle.original}</strong></span><span><small>GÉNERO</small><strong>{(selectedTitle.genres || [selectedTitle.genre]).join(', ')}</strong></span><span><small>AVALIAÇÃO</small><strong>★ {selectedTitle.rating} / 10</strong></span></div>
            <section className="trailer-panel">
              <div className="trailer-heading"><div><span className="eyebrow">MAIS INFORMAÇÕES</span><strong>Trailer</strong></div>{trailer.status === 'ready' && <button className="button button-quiet button-sm" onClick={() => setTrailerPlaying((current) => !current)}><Icon name={trailerPlaying ? 'close' : 'play'} size={13}/>{trailerPlaying ? 'Fechar trailer' : 'Ver trailer'}</button>}</div>
              {trailer.status === 'loading' && <p className="trailer-message">A procurar o trailer…</p>}
              {trailer.status === 'ready' && <><p className="trailer-message">{trailer.name}</p>{trailerPlaying && <div className="trailer-frame"><iframe title={`Trailer: ${selectedTitle.title}`} src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div>}</>}
              {trailer.status === 'empty' && <p className="trailer-message">Não encontrámos um trailer oficial no TMDB.</p>}
              {trailer.status === 'unavailable' && <p className="trailer-message">Liga o catálogo TMDB para carregar trailers deste título.</p>}
              {trailer.status === 'error' && <p className="trailer-message">Não foi possível carregar o trailer neste momento.</p>}
            </section>
            <ReleaseSearchPanel title={selectedTitle} search={releaseSearch} connected={Boolean(session?.access_token)} busyId={releaseBusyId} configured={Boolean(integrationSettings.prowlarrUrl && integrationSettings.prowlarrApiKey)} onRefresh={() => searchReleaseSources(selectedTitle.original || selectedTitle.title, selectedTitle.type === 'Série' ? 'series' : 'movies', selectedTitle.id)} onConfigure={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }} onAdd={grabRelease}/>
            <RdTitleMatches title={selectedTitle} search={rdSearch} connected={Boolean(session?.access_token)} onRefresh={() => searchTitleInLibrary(selectedTitle)} onConnect={() => setModal({ type: 'connect' })} onAdd={() => startPlayback(selectedTitle)} onOpen={(torrent) => openTorrentStream(torrent, selectedTitle)}/>
          </div>
        </div>}

        {modal.type === 'integrations' && <div className="integration-modal modal-card">
          <button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button>
          <div className="modal-emblem magnet-emblem"><Icon name="settings" size={23}/></div><span className="eyebrow">CATÁLOGO, PESQUISA E LEGENDAS</span><h2>Integrações</h2>
          <p className="connect-lead">Liga o Prowlarr para pesquisar fontes, o TMDB para atualizar tendências e estreias, e o OpenSubtitles para procurar legendas. A preferência de legendas é português de Portugal.</p>
          <form onSubmit={saveIntegrationSettings} className="integration-form">
            <div className="integration-group-title">Prowlarr</div>
            <label className="input-label" htmlFor="prowlarr-url">Endereço do Prowlarr</label><input id="prowlarr-url" className="text-input" type="url" placeholder="http://localhost:9696" value={integrationForm.prowlarrUrl} onChange={(event) => setIntegrationForm((current) => ({ ...current, prowlarrUrl: event.target.value }))}/>
            <label className="input-label" htmlFor="prowlarr-key">API key do Prowlarr</label><input id="prowlarr-key" className="text-input" type="password" autoComplete="off" placeholder="Settings > General > Security" value={integrationForm.prowlarrApiKey} onChange={(event) => setIntegrationForm((current) => ({ ...current, prowlarrApiKey: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testProwlarr}>Testar Prowlarr</button>

            <div className="integration-group-title">TMDB</div>
            <small className="integration-help">Cria uma API key nas definições da conta TMDB. Esta ligação atualiza os títulos, imagens e tendências.</small>
            <label className="input-label" htmlFor="tmdb-key">API key do TMDB</label><input id="tmdb-key" className="text-input" type="password" autoComplete="off" placeholder="API Read Access Token" value={integrationForm.tmdbApiKey || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, tmdbApiKey: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testTmdb}>Testar TMDB</button>

            <div className="integration-group-title">OpenSubtitles</div>
            <small className="integration-help">A API key e as credenciais da conta OpenSubtitles são necessárias para pesquisar e descarregar legendas.</small>
            <label className="input-label" htmlFor="opensubtitles-key">API key</label><input id="opensubtitles-key" className="text-input" type="password" autoComplete="off" placeholder="API key do OpenSubtitles" value={integrationForm.openSubtitlesApiKey || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, openSubtitlesApiKey: event.target.value }))}/>
            <label className="input-label" htmlFor="opensubtitles-user">Nome de utilizador</label><input id="opensubtitles-user" className="text-input" autoComplete="username" placeholder="Utilizador da conta" value={integrationForm.openSubtitlesUsername || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, openSubtitlesUsername: event.target.value }))}/>
            <label className="input-label" htmlFor="opensubtitles-password">Palavra-passe</label><input id="opensubtitles-password" className="text-input" type="password" autoComplete="new-password" placeholder="Palavra-passe da conta" value={integrationForm.openSubtitlesPassword || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, openSubtitlesPassword: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testOpenSubtitles}>Testar OpenSubtitles</button>

            <div className="integration-test-line">{integrationTest && <span className={/erro|não|inválid|failed|error|não foi/i.test(integrationTest) ? 'is-error' : ''}>{integrationTest}</span>}</div>
            <div className="integration-actions"><span className="integration-help">As chaves são cifradas na app desktop.</span><button className="button button-primary"><Icon name="check" size={15}/>Guardar</button></div>
          </form>
          <div className="adult-setting"><span><strong>Pesquisa de conteúdo adulto</strong><small>Ativa a categoria Adulto (Whisparr) no menu e nas pesquisas.</small></span><input type="checkbox" checked={adultEnabled} onChange={(event) => toggleAdultSearch(event.target.checked)} aria-label="Ativar pesquisa de conteúdo adulto"/></div>
          <div className="readarr-note"><strong>Readarr</strong><span>O projeto foi descontinuado oficialmente em 2025. A pesquisa de livros continua disponível pela categoria Books no Prowlarr.</span></div>
          <p className="privacy-note"><Icon name="alert" size={14}/>{window.streamnexus?.isDesktop ? 'Todas as chaves e credenciais são guardadas cifradas com a proteção de credenciais do Windows.' : 'Nesta pré-visualização, as chaves ficam apenas nesta sessão do separador.'}</p>
          <section className="credits-panel"><strong>Créditos</strong><div><span className="tmdb-wordmark">TMDB</span><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div></section>
        </div>}

        {modal.type === 'connect' && <div className="connect-modal modal-card"><button className="modal-close" aria-label="Fechar" onClick={() => { setModal(null); setDeviceAuth(null); setDeviceStatus(''); }}><Icon name="close"/></button><div className="modal-emblem"><Icon name="cloud" size={26}/><span className="emblem-orbit"></span></div><span className="eyebrow">INTEGRAÇÃO OFICIAL</span><h2>{session?.access_token ? 'A tua conta está ligada' : 'A tua nuvem, aqui'}</h2><p className="connect-lead">Liga o Real-Debrid para sincronizar os teus torrents e reproduzir os conteúdos da tua conta.</p>
          {session?.access_token ? <div className="connected-panel"><div className="connected-user"><span className="connected-avatar">{rdUser?.username?.slice(0, 1)?.toUpperCase() || 'R'}</span><span><strong>{rdUser?.username || 'Conta Real-Debrid'}</strong><small>{rdUser?.type === 'premium' ? 'Conta Premium' : 'Ligação ativa'}{rdUser?.expiration ? ` · até ${formatDate(rdUser.expiration)}` : ''}</small></span><span className="connected-dot"><Icon name="check" size={13}/></span></div><div className="connected-actions"><button className="button button-primary" onClick={() => { setModal(null); setActivePage('downloads'); loadRdAccount(); }}>Abrir biblioteca <Icon name="chevron" size={15}/></button><button className="button button-danger-quiet" onClick={disconnectRealDebrid}>Desligar conta</button></div></div> : <div className="connect-steps"><div className="connect-step"><span>1</span><div><strong>Autoriza a ligação</strong><small>Vamos abrir o Real-Debrid numa janela segura da app.</small></div></div><div className="connect-step"><span>2</span><div><strong>Confirma o código</strong><small>Introduz o código apresentado na tua conta.</small></div></div><div className="connect-step"><span>3</span><div><strong>Pronto a ver</strong><small>A biblioteca fica disponível no StreamNexus.</small></div></div></div>}
          {deviceAuth && <div className="device-code-panel"><span className="eyebrow">CÓDIGO DE AUTORIZAÇÃO</span><strong>{deviceAuth.user_code}</strong><small>Introduz este código na janela Real-Debrid aberta pela app.</small></div>}
          {deviceStatus && <div className={`device-status ${deviceStatus.includes('expirou') || deviceStatus.includes('Não foi') || deviceStatus.includes('não foi') ? 'is-error' : ''}`}><span className="spinner"></span>{deviceStatus}</div>}
          {rdError && <div className="inline-error"><Icon name="alert" size={16}/>{rdError}</div>}
          {!session?.access_token && !deviceAuth && <button className="button button-primary connect-cta" onClick={connectRealDebrid} disabled={rdBusy}><Icon name="link" size={16}/>{rdBusy ? 'A iniciar ligação…' : 'Ligar ao Real-Debrid'}<Icon name="external" size={14}/></button>}
          {!session?.access_token && <p className="privacy-note"><Icon name="alert" size={14}/>{window.streamnexus?.isDesktop ? 'A sessão é guardada com a proteção de credenciais do Windows. Nunca pedimos o teu token privado.' : 'A sessão fica apenas neste separador. Nunca pedimos o teu token privado.'}</p>}
        </div>}

        {modal.type === 'magnet' && <div className="magnet-modal modal-card"><button className="modal-close" aria-label="Fechar" onClick={() => { setModal(null); setRdError(''); }}><Icon name="close"/></button><div className="modal-emblem magnet-emblem"><Icon name="link" size={24}/></div><span className="eyebrow">REAL-DEBRID · ADICIONAR CONTEÚDO</span><h2>{modal.title ? `Ver ${modal.title.title}` : 'Adicionar um magnet'}</h2><p className="connect-lead">Cola um magnet da tua coleção. O ficheiro é enviado diretamente para a tua conta Real-Debrid.</p><form onSubmit={addMagnet}><label className="input-label" htmlFor="magnet-input">Link magnet</label><textarea id="magnet-input" className="magnet-input" placeholder="magnet:?xt=urn:btih:…" rows="3" value={magnet} onChange={(event) => setMagnet(event.target.value)} autoFocus/><div className="magnet-hint"><span><Icon name="cloud" size={14}/>A ligação é feita diretamente à API Real-Debrid.</span><span>Não guardamos o link.</span></div>{rdError && <div className="inline-error"><Icon name="alert" size={16}/>{rdError}</div>}<button className="button button-primary connect-cta" disabled={magnetBusy || !session?.access_token || !magnet.trim()}><Icon name="plus" size={16}/>{magnetBusy ? 'A enviar para a nuvem…' : 'Adicionar à biblioteca'}<Icon name="chevron" size={15}/></button></form></div>}

        {modal.type === 'downloads' && <div className="modal-card small-confirm"><div className="modal-emblem magnet-emblem"><Icon name="cloud" size={24}/></div><span className="eyebrow">REAL-DEBRID</span><h2>Magnet enviado</h2><p>O conteúdo foi enviado para a tua conta. A transferência pode demorar alguns instantes a ficar pronta.</p><div className="small-confirm-actions"><button className="button button-quiet" onClick={() => setModal(null)}>Fechar</button><button className="button button-primary" onClick={() => { setModal(null); setActivePage('downloads'); loadRdAccount(); }}>Ver biblioteca <Icon name="chevron" size={14}/></button></div></div>}

        {modal.type === 'player' && <div className={`player-modal modal-card ${playerControlsVisible ? '' : 'controls-hidden'}`} onMouseMove={revealPlayerControls} onTouchStart={revealPlayerControls}>
          <div className="player-frame">
            {playing?.url && <video ref={playerVideoRef} autoPlay playsInline preload="auto" src={playing.url} onClick={togglePlayerPlayback} onError={() => setPlayerPlaybackError('O leitor integrado não conseguiu abrir este vídeo.')}>{subtitleTrackUrl && <track kind="subtitles" srcLang={subtitleLanguage} label={subtitleLabel} src={subtitleTrackUrl} default/>}</video>}
            {playerPlaybackError && <div className="player-playback-error"><strong>{playerPlaybackError}</strong><span>Confirma a ligação ou tenta abrir o ficheiro original.</span>{playing?.sourceUrl && <button className="button button-quiet button-sm" onClick={async () => { try { await window.streamnexus.openExternalPlayer(playing.sourceUrl); } catch (error) { setPlayerPlaybackError(getError(error)); } }}><Icon name="external" size={13}/>Abrir com VLC</button>}</div>}
            {!playing?.url && <div className="player-empty"><span className="spinner"></span><strong>{playing?.error ? 'Não foi possível preparar o vídeo' : 'A preparar reprodução…'}</strong><span>{playing?.error || (playing?.pending ? `A aguardar o Real-Debrid · ${playing.progress || 0}%` : 'A preparar o ficheiro de vídeo')}</span>{playing?.pending && <div className="player-progress"><i style={{ width: `${playing.progress || 3}%` }}/></div>}{playing?.error && <button className="button button-quiet button-sm" onClick={() => { setModal(null); setPlaying(null); }}>Fechar</button>}</div>}
          </div>
          <div className={`player-overlay ${playerControlsVisible ? '' : 'is-hidden'}`} onClick={(event) => { if (event.target === event.currentTarget) togglePlayerPlayback(); }}>
            <div className="player-topbar">
              <div className="player-title"><span className="eyebrow">A REPRODUZIR A PARTIR DA TUA NUVEM</span><strong>{playing?.title}</strong>{playing?.audioWarning && <small className="audio-hint">O áudio pode não ser compatível. {playing.audioWarning} Também podes abrir com VLC.</small>}</div>
              <div className="player-top-actions"><span className="quality-tag">REAL-DEBRID</span>{playing?.sourceUrl && <button className="player-icon-button" aria-label="Abrir com VLC" title="Abrir com VLC" onClick={async () => { try { await window.streamnexus.openExternalPlayer(playing.sourceUrl); } catch (error) { setPlayerPlaybackError(getError(error)); } }}><Icon name="external" size={19}/></button>}<button className="player-icon-button" aria-label="Fechar filme" title="Fechar" onClick={() => { setModal(null); setPlaying(null); setSubtitleTrackUrl(''); setEmbeddedSubtitleTracks([]); }}><Icon name="close" size={21}/></button></div>
            </div>

            {subtitleMenuOpen && <section className="subtitle-panel">
              <div className="subtitle-panel-head"><div><span className="eyebrow">LEGENDAS</span><strong>{activeEmbeddedTrack ? `${activeEmbeddedTrack.label || activeEmbeddedTrack.language || 'Legendas'} · Original do ficheiro` : subtitleLabel || 'Português de Portugal'}</strong></div><button className="button button-quiet button-sm" onClick={() => findSubtitles(playing?.metadata, playing?.fileName)} disabled={subtitleStatus === 'loading' || subtitleStatus === 'downloading'}><Icon name="refresh" size={13}/>{subtitleStatus === 'loading' ? 'A procurar…' : 'Procurar'}</button></div>
              {embeddedSubtitleTracks.length > 0 && <div className="embedded-subtitles"><span>Legendas originais do ficheiro</span><div><button className={!activeEmbeddedTrack && !subtitleTrackUrl ? 'active' : ''} onClick={() => { Array.from(playerVideoRef.current?.textTracks || []).forEach((track) => { track.mode = 'disabled'; }); setActiveEmbeddedTrack(null); setSubtitleLabel(''); setSubtitleStatus('found'); }}>Desligadas</button>{embeddedSubtitleTracks.map((track, index) => <button key={`${track.language}-${track.label}-${index}`} className={activeEmbeddedTrack === track ? 'active' : ''} onClick={() => selectEmbeddedSubtitle(track)}>{track.label || track.language || `Faixa ${index + 1}`} <small>Original</small></button>)}</div></div>}
              {embeddedSubtitleTracks.length === 0 && /\b(subs?|subtitles?|legendas?)\b/i.test(playing?.fileName || '') && <p className="subtitle-message">O leitor web não expôs as legendas embutidas neste ficheiro. Podes selecioná-las ao abrir com VLC.</p>}
              {subtitleStatus === 'loading' && <p className="subtitle-message"><span className="spinner"></span>A procurar legendas em PT-PT e PT-BR…</p>}
              {subtitleStatus === 'downloading' && <p className="subtitle-message"><span className="spinner"></span>A descarregar a legenda…</p>}
              {subtitleStatus === 'error' && <p className="subtitle-message is-error">{subtitleError}<button className="text-link" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar OpenSubtitles</button></p>}
              {subtitleStatus === 'empty' && <p className="subtitle-message">Não foram encontradas legendas em português para este título.</p>}
              {subtitleStatus === 'selected' && <p className="subtitle-message is-ready"><Icon name="check" size={14}/>Legenda carregada. Ativa-a pelo botão de legendas.</p>}
              {subtitleStatus === 'original' && <p className="subtitle-message is-ready"><Icon name="check" size={14}/>A usar as legendas originais incorporadas neste ficheiro.</p>}
              {playing?.pending && <p className="subtitle-message">As legendas ficam disponíveis assim que o Real-Debrid entregar o vídeo.</p>}
              {subtitleResults.length > 0 && <div className="subtitle-results">{subtitleResults.map((subtitle) => <button key={`${subtitle.fileId}-${subtitle.fileName}`} className={`subtitle-option ${subtitle.language === 'pt-PT' ? 'preferred' : ''}`} onClick={() => chooseSubtitle(subtitle)}><span><strong>{subtitle.label}</strong><small>{subtitle.fileName}{subtitle.release ? ` · ${subtitle.release}` : ''}</small></span><span>{subtitle.language === 'pt-PT' ? 'PT-PT · Preferida' : 'PT-BR'} <Icon name="download" size={13}/></span></button>)}</div>}
            </section>}

            <div className="player-bottom">
              <input className="player-seek" aria-label="Posição do filme" type="range" min="0" max={playerDuration || playerSeekEnd || 1} step="0.1" value={playerDuration || playerSeekEnd ? Math.min(playerCurrentTime, playerDuration || playerSeekEnd) : 0} disabled={!playerDuration && !playerSeekEnd} onChange={(event) => setPlayerSeekPosition(event.target.value)}/>
              <div className="player-control-row">
                <div className="player-control-group"><button className="player-icon-button" aria-label={playerPlaying ? 'Pausar' : 'Reproduzir'} onClick={togglePlayerPlayback}><Icon name={playerPlaying ? 'pause' : 'play'} size={21}/></button><button className="player-icon-button" aria-label="Recuar 10 segundos" onClick={() => seekPlayer(-10)}><Icon name="skipBack" size={20}/></button><button className="player-icon-button" aria-label="Avançar 10 segundos" onClick={() => seekPlayer(10)}><Icon name="skipForward" size={20}/></button><span className="player-time">{formatPlaybackTime(playerCurrentTime)} <i>/</i> {playerDuration ? formatPlaybackTime(playerDuration) : 'AO VIVO'}</span></div>
                <div className="player-control-group player-control-end"><button className="player-icon-button" aria-label={playerMuted ? 'Ativar som' : 'Silenciar'} onClick={togglePlayerMute}><Icon name={playerMuted || playerVolume === 0 ? 'volumeOff' : 'volume'} size={20}/></button><input className="player-volume" aria-label="Volume" type="range" min="0" max="1" step="0.05" value={playerMuted ? 0 : playerVolume} onChange={(event) => { const value = Number(event.target.value); const video = playerVideoRef.current; if (video) { video.volume = value; video.muted = value === 0; } setPlayerVolume(value); setPlayerMuted(value === 0); }}/><button className={`player-icon-button captions-button ${subtitleMenuOpen ? 'active' : ''}`} aria-label="Legendas" aria-expanded={subtitleMenuOpen} title="Legendas" onClick={() => { setSubtitleMenuOpen((open) => !open); revealPlayerControls(); }}><Icon name="captions" size={22}/></button><button className="player-icon-button" aria-label={playerFullscreen ? 'Sair de ecrã inteiro' : 'Ecrã inteiro'} title={playerFullscreen ? 'Sair de ecrã inteiro' : 'Ecrã inteiro'} onClick={togglePlayerFullscreen}><Icon name="fullscreen" size={20}/></button></div>
              </div>
            </div>
          </div>
        </div>}
      </div>}
    </div>
  );
}

function PosterCard({ item, index, saved, onOpen, onSave, rank }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <article className={`poster-card ${rank ? 'ranked-poster-card' : ''}`} style={{ '--card-delay': `${index * 45}ms`, '--poster-accent': item.accent || '#705d8b' }}>
    {rank && <span className="poster-rank">{rank}</span>}
    <button className="poster-image" onClick={onOpen} aria-label={`Ver detalhes de ${item.title}`}>
      {imageFailed ? <span className="poster-fallback"><i>{item.type === 'Série' ? 'SÉRIE' : 'FILME'}</i><strong>{item.title}</strong><small>{item.year}</small></span> : <img src={item.poster} alt={`Poster de ${item.title}`} loading="lazy" onError={() => setImageFailed(true)}/>}
      <span className="poster-shade"></span><span className="poster-hover-play"><Icon name="play" size={17}/></span><span className="poster-type">{item.type}</span>
    </button>
    <button className={`poster-save ${saved ? 'saved' : ''}`} aria-label={saved ? 'Remover da lista' : 'Adicionar à lista'} onClick={onSave}><Icon name={saved ? 'check' : 'plus'} size={15}/></button>
    <button className="poster-title" onClick={onOpen}>{item.title}</button><div className="poster-sub"><span>{item.year} <i>·</i> {item.genre}</span><span className="poster-rating">★ {item.rating}</span></div>
  </article>;
}

function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return 'Tamanho desconhecido';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** order)).toFixed(order > 1 ? 1 : 0)} ${units[order]}`;
}

function ReleaseSearchResults({ search, categoryKey, connected, busyId, onAdd }) {
  const [page, setPage] = useState(1);
  const category = SEARCH_CATEGORIES[categoryKey] || SEARCH_CATEGORIES.movies;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil((search?.items?.length || 0) / pageSize));
  const firstItem = (page - 1) * pageSize;
  const visibleItems = (search?.items || []).slice(firstItem, firstItem + pageSize);
  useEffect(() => { setPage(1); }, [search?.titleId, search?.categoryKey, search?.status, search?.items?.length]);
  if (!search || search.categoryKey !== categoryKey) return <div className="release-results-state"><Icon name="search" size={17}/><p>Pesquisa lançamentos de {category.label.toLowerCase()} nos indexadores.</p></div>;
  if (search.status === 'loading') return <div className="release-results-state"><span className="spinner"></span><p>A consultar os indexadores…</p></div>;
  if (search.status === 'error') return <div className="release-results-state is-error"><Icon name="alert" size={17}/><p>{search.message}</p></div>;
  if (search.status === 'empty') return <div className="release-results-state"><Icon name="search" size={17}/><p>Sem resultados. Verifica se tens indexadores configurados para a categoria {category.label.toLowerCase()} no Prowlarr.</p></div>;
  return <div className="release-results">
    <div className="release-results-heading"><strong>{search.collectionTitle ? `${search.collectionTitle}: ` : ''}{search.items.length} {search.items.length === 1 ? 'lançamento encontrado' : 'lançamentos encontrados'}</strong><span>{category.manager} · Prowlarr{search.query ? ` · ${search.query}` : ''}</span></div>
    <div className="release-results-list">{visibleItems.map((release) => <article className="release-card" key={release.id}><div className="release-info"><strong title={release.title}>{release.title}</strong><span>{release.indexer} <i>·</i> {formatBytes(release.size)} <i>·</i> {release.seeders == null ? 'Seeders n/d' : `${release.seeders} seeders`}</span></div><span className={`release-source ${release.hasMagnet ? 'has-magnet' : ''}`}>{release.hasMagnet ? 'MAGNET' : 'TORRENT'}</span><button className="button button-primary button-sm" disabled={!release.canGrab || busyId === release.id} onClick={() => onAdd(release)}><Icon name={busyId === release.id ? 'refresh' : 'cloud'} size={14}/>{busyId === release.id ? 'A enviar…' : connected ? 'Adicionar ao RD' : 'Ligar RD'}</button></article>)}</div>
    {totalPages > 1 && <div className="release-pagination"><span>{firstItem + 1}-{Math.min(firstItem + pageSize, search.items.length)} de {search.items.length}</span><div><button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><small>{page} / {totalPages}</small><button className="button button-quiet" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Seguinte</button></div></div>}
  </div>;
}

function ReleaseSearchPanel({ title, search, connected, busyId, configured, onRefresh, onConfigure, onAdd }) {
  const categoryKey = title.type === 'Série' ? 'series' : 'movies';
  const current = search?.titleId === title.id ? search : null;
  return <section className="release-panel">
    <div className="release-panel-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> PESQUISA NOS INDEXADORES</span><strong>{SEARCH_CATEGORIES[categoryKey].manager} · enviar ao Real-Debrid</strong></div><div>{configured && <button className="rd-search-refresh" onClick={onRefresh} disabled={current?.status === 'loading'} aria-label="Pesquisar novamente"><Icon name="refresh" size={15}/></button>}<button className="rd-search-refresh" onClick={onConfigure} aria-label="Configurar Prowlarr"><Icon name="settings" size={15}/></button></div></div>
    {!configured ? <div className="release-results-state"><p>Configura o Prowlarr para procurar lançamentos e magnets para este título.</p><button className="text-link" onClick={onConfigure}>Configurar fontes <Icon name="chevron" size={14}/></button></div> : !current || current.status === 'loading' ? <div className="release-results-state"><span className="spinner"></span><p>A pesquisar “{title.original || title.title}” no Prowlarr…</p></div> : <ReleaseSearchResults search={current} categoryKey={categoryKey} connected={connected} busyId={busyId} onAdd={onAdd}/>}
  </section>;
}

function RdTitleMatches({ title, search, connected, onRefresh, onConnect, onAdd, onOpen }) {
  const current = search?.titleId === title.id ? search : null;
  const matches = current?.matches || [];
  const loading = current?.status === 'loading';
  const getStatus = (status) => status === 'downloaded' ? 'Pronto a ver' : status === 'waiting_files_selection' ? 'Selecionar ficheiros' : status === 'downloading' ? 'A transferir' : status === 'queued' ? 'Na fila' : status === 'dead' || status === 'error' ? 'Indisponível' : 'A preparar';
  return <section className="rd-title-search">
    <div className="rd-title-search-head"><div><span className="eyebrow"><span className="pulse-dot"></span> NA TUA CONTA REAL-DEBRID</span><strong>Procurar na tua biblioteca</strong></div>{connected && <button className="rd-search-refresh" onClick={onRefresh} disabled={loading} aria-label="Pesquisar novamente"><Icon name="refresh" size={15}/></button>}</div>
    {!connected ? <div className="rd-search-message"><p>Liga o Real-Debrid para procurar este título entre os magnets da tua conta.</p><button className="text-link" onClick={onConnect}>Ligar conta <Icon name="chevron" size={14}/></button></div>
      : loading || !current ? <div className="rd-search-message"><span className="spinner"></span><p>A procurar nos teus torrents guardados…</p></div>
        : current.status === 'error' ? <div className="rd-search-message is-error"><Icon name="alert" size={15}/><p>{current.message}</p><button className="text-link" onClick={onRefresh}>Tentar novamente</button></div>
          : current.status === 'empty' ? <div className="rd-search-message"><p>Não encontrámos este título nos teus torrents Real-Debrid.</p><small>A API não pesquisa magnets globais por nome. Podes adicionar um magnet teu à biblioteca.</small><button className="button button-quiet button-sm" onClick={onAdd}><Icon name="plus" size={14}/>Adicionar magnet</button></div>
            : <div className="rd-match-list">{matches.slice(0, 5).map((torrent) => <div className="rd-match-item" key={torrent.id}><span className={`rd-match-status ${torrent.status === 'downloaded' ? 'ready' : ''}`}><i></i>{getStatus(torrent.status)}</span><strong title={torrent.filename || torrent.original_filename}>{torrent.filename || torrent.original_filename || title.title}</strong><button className={`button ${torrent.status === 'downloaded' ? 'button-primary' : 'button-quiet'} button-sm`} onClick={() => onOpen(torrent)}>{torrent.status === 'downloaded' ? <><Icon name="play" size={13}/>Reproduzir</> : 'Abrir'}</button></div>)}{matches.length > 5 && <small className="rd-more-matches">Mais {matches.length - 5} correspondências na tua biblioteca.</small>}</div>}
  </section>;
}

function TorrentRow({ torrent, onPlay, onSelect, onDelete }) {
  const status = torrent.status === 'downloaded' ? 'Pronto a ver' : torrent.status === 'waiting_files_selection' ? 'Escolher ficheiros' : torrent.status === 'magnet_conversion' ? 'A preparar' : torrent.status === 'downloading' ? 'A transferir' : torrent.status === 'queued' ? 'Na fila' : torrent.status === 'dead' || torrent.status === 'error' ? 'Indisponível' : 'A processar';
  const isReady = torrent.status === 'downloaded';
  const needsSelection = torrent.status === 'waiting_files_selection';
  const isDownloading = ['magnet_conversion', 'downloading', 'queued'].includes(torrent.status);
  const progress = isReady ? 100 : Number(torrent.progress || 0);
  const title = torrent.filename || torrent.original_filename || 'Magnet sem nome';
  const size = Number(torrent.bytes) ? `${(Number(torrent.bytes) / (1024 ** 3)).toFixed(1)} GB` : '-';
  return <div className="torrent-row"><div className={`torrent-cover ${isReady ? 'is-ready' : ''}`}><Icon name={isReady || isDownloading ? 'play' : 'film'} size={18}/></div><div className="torrent-main"><strong title={title}>{title}</strong><span>{size}<i>·</i> Adicionado {formatDate(torrent.added)}</span></div><div className="torrent-progress"><div className="torrent-progress-label"><span className={isReady ? 'ready-status' : ''}><i></i>{status}</span><small>{progress}%</small></div><div className="progress-track"><span style={{ width: `${progress}%` }}></span></div></div><div className="torrent-actions">{isReady ? <button className="button button-primary button-sm" onClick={onPlay}><Icon name="play" size={14}/>Reproduzir</button> : needsSelection ? <button className="button button-quiet button-sm" onClick={onSelect}>Selecionar ficheiros</button> : isDownloading ? <button className="button button-quiet button-sm" onClick={onPlay}><Icon name="play" size={14}/>Abrir</button> : <button className="button button-quiet button-sm" onClick={onSelect}><Icon name="refresh" size={14}/>Ver estado</button>}<button className="torrent-delete" aria-label={`Remover ${title}`} onClick={onDelete}><Icon name="trash" size={15}/></button></div></div>;
}

export default App;
