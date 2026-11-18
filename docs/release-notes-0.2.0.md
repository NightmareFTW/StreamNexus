# StreamNexus v0.2.0 — pronta para partilhar com a família

Aplicação de ambiente de trabalho (Windows x64) para descobrir e ver filmes, séries, TV em direto, música e livros, ligada aos serviços que configurares.

## Instalação (família)

1. Transfere `StreamNexus-Setup-0.2.0.exe` e executa-o.
2. O instalador **ainda não está assinado**, por isso o Windows pode avisar: carrega em **Mais informações → Executar mesmo assim**.
3. Na primeira vez que abres a app, cola o **código de convite** e o **PIN** que te foram enviados. Fica tudo ligado.
4. Segue o [guia rápido para a família](https://github.com/NightmareFTW/StreamNexus/blob/main/docs/GUIA-FAMILIA.md): rede privada (Tailscale, se for preciso) e a tua conta Real-Debrid.

SHA-256: `9fba83cea9c1ea327514be6abb52d0c04f3206c1f663b0fc953e5b3e55d6318c`

## Novidades desde a 0.1.0

- **Convite para a família**: gera nas Definições um código cifrado com PIN; quem instala só o cola no primeiro arranque.
- **Perfis** com avatares (emojis ou fotografia com recorte), perfil infantil e preferências por perfil.
- **Início** personalizado: continuar a ver, calendário de estreias, sugestões, música e leitura.
- **Séries**: escolha de temporada e episódio, retoma automática, episódio seguinte com contagem decrescente e "Ver agora" com escolha automática da melhor fonte.
- **Legendas**: nova fonte sem conta (OpenSubtitles via addon público), ordenada pela versão mais parecida com o ficheiro; legendas desenhadas pela app, atraso ajustável e deteção de português do Brasil.
- **Livros**: pedidos ao **Shelfarr** e biblioteca de **Audiolivros** do **Audiobookshelf** (com "Continuar a ouvir" no Início), com alternador eBooks/Audiolivros.
- **Adultos**: leitor próprio com escolha de qualidade e pré-visualização ao passar o rato.
- **Atualizações dentro da app**: botão nas Definições e verificação automática ao iniciar.
- **Rede mais robusta**: pedidos externos pela rede do Chromium e falha rápida quando um serviço está lento.

## Notas

- Precisas da **tua** conta Real-Debrid para ver filmes e séries; não a partilhes.
- O Spotify dentro da app depende de uma assinatura da castlabs que ainda não está incluída; sem ela a música toca noutro dispositivo Spotify (modo comando remoto).
- O ícone da aplicação ainda é o padrão do Electron.
- A StreamNexus não aloja nem distribui conteúdos; é um projeto independente, sem relação com os serviços referidos. Vê o [README](https://github.com/NightmareFTW/StreamNexus#readme) e as [notas de terceiros](https://github.com/NightmareFTW/StreamNexus/blob/main/THIRD-PARTY-NOTICES.md).

---

**English:** StreamNexus 0.2.0 adds family invites, profiles, a redesigned home, series/episode handling, account-free subtitles, Shelfarr and Audiobookshelf integrations, an in-app updater and more robust networking. Windows x64 installer, unsigned (SmartScreen: *More info → Run anyway*).
