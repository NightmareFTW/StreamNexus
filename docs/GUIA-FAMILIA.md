# StreamNexus — guia rápido para a família

Isto leva uns 10 minutos e só se faz uma vez.

## 1. Instalar

1. Descarrega o ficheiro `StreamNexus-Setup-….exe` da página de [Releases](https://github.com/NightmareFTW/StreamNexus/releases/latest) e abre-o.
2. O Windows pode avisar "O Windows protegeu o seu PC" (o instalador ainda não está assinado digitalmente). Carrega em **Mais informações** e depois em **Executar mesmo assim**.
3. Segue o instalador e abre a StreamNexus.

## 2. Ligar tudo com o código de convite

Quem te enviou a app deve ter-te dado duas coisas, **em mensagens separadas**:

- um **código de convite** (começa por `SN1.`);
- um **PIN**.

Na primeira vez que abres a app aparece o ecrã **"Vamos ligar a StreamNexus"**. Cola o código, escreve o PIN e carrega em **Ativar convite**. Fica ligado o catálogo e as outras ligações que foram partilhadas contigo.

Se não tiveres código, podes carregar em **Configurar mais tarde**.

## 3. Rede privada (só se as fontes estiverem noutro computador)

Se o convite inclui endereços que começam por `100.` (por exemplo `http://100.102.206.24:9696`), precisas do **Tailscale**:

1. Instala o Tailscale em [tailscale.com/download](https://tailscale.com/download).
2. Aceita o convite que recebeste por email, ou entra com a conta que te indicaram.
3. Deixa o Tailscale ligado (ícone junto ao relógio) quando usares a StreamNexus.

## 4. As tuas contas (cada pessoa usa a sua)

- **Real-Debrid** — para ver filmes e séries. É uma conta paga, pessoal; não a partilhes com outras pessoas. Na app, carrega no cartão do Real-Debrid no ecrã **Início** e segue os passos.
- **Spotify** (opcional) — para ouvir música com a tua conta Premium. Pede a quem te convidou para te adicionar à lista de utilizadores da app Spotify (precisa do teu email da conta Spotify) e depois liga a conta num álbum.
- **OpenSubtitles** (opcional) — as legendas já funcionam sem conta. A conta só dá acesso a mais algumas legendas.

## 5. Perfis

Cria o teu perfil (nome e avatar) no ecrã **Quem está a ver?**. Cada pessoa tem o seu histórico, a sua lista e as suas preferências. Há também um perfil infantil.

## Se algo falhar

- **"fetch failed" ou nada carrega:** confirma que tens internet e que o Tailscale está ligado (se estás a usar fontes partilhadas).
- **O convite diz "PIN errado":** confirma o PIN e copia o código **inteiro**, sem espaços a mais.
- **Atualizações:** a app avisa quando há uma versão nova; nas **Definições** podes procurar atualizações e instalar com um clique.
