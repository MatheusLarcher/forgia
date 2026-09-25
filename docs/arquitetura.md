# Arquitetura

O Forgia é um programa para Windows feito com **Electron**. A interface é escrita em
**JavaScript puro** (módulos ES), sem framework de interface; a renderização é feita com
**three.js**, as operações de furo com **three-bvh-csg**, e o empacotamento com **Vite**. O
Electron carrega o build do Vite (`dist/`). O `npm run dev` serve o mesmo código no navegador,
com recarga automática, só para desenvolver.

```
forgia/
├── index.html          # estrutura da tela (barras, viewport, biblioteca)
├── src/
│   ├── main.js         # ponto de entrada: cria o Editor e a UI
│   ├── editor.js       # núcleo: cena, câmera, seleção, histórico, salvamento
│   ├── ui.js           # interface: biblioteca, inspetor, diálogos, import/export
│   ├── textos/
│   │   ├── pt-BR.js    # todo texto visível da tela, por área (barra, dicas, avisos…)
│   │   └── index.js    # exporta `t` e `applyTexts()`, que preenche o HTML marcado
│   ├── theme.js        # tema claro/escuro: estado, data-tema, forgia.tema, paletas 3D
│   ├── dica.js         # cartão de dica ao parar o mouse sobre um botão
│   ├── shapes.js       # definição e geração da geometria de cada forma
│   ├── outline.js      # contorno da forma 'desenho' (funções puras: limpar, simplificar, validar)
│   ├── draw.js         # ferramenta Desenhar (tecla B)
│   ├── cruise.js       # ferramenta Cruzeiro (tecla C)
│   ├── surface.js      # superfície sob o cursor: raio com BVH, região plana e realce verde
│   ├── measure.js      # ferramenta Medir (tecla R), a régua
│   ├── marcar.js       # ferramenta Marcar parte (tecla N): alfinetes e pedido copiado
│   ├── coords.js       # conversão interno (Y para cima) ↔ usuário/ponte (Z para cima)
│   ├── ponte.js        # ponte da IA na página: pedidos do main, ocupado, aviso e piscar
│   ├── ponte-comandos.js # comandos da IA (estado, criar, lote…) no sistema do usuário
│   ├── ponte-codigo.js # Worker do código livre da IA (fachada forgia.*)
│   ├── captura.js      # PNG da vista (IA e Marcar parte), com câmera temporária
│   ├── statusbar.js    # barra de status: X/Y/Z da seleção, IA conectada, Conectar IA
│   ├── conectar.js     # diálogo Conectar IA
│   ├── importar.js     # leitura de STL/OBJ/3MF (Importar e comando importar)
│   ├── csg.js          # booleanas: sólidos − furos dentro de grupos
│   ├── handles.js      # alças de manipulação e transferidor de rotação
│   ├── edges.js        # contorno de seleção (arestas reais após CSG)
│   ├── viewcube.js     # cubo de navegação
│   ├── materials.js    # materiais de sólido e de furo (listrado)
│   ├── thumbs.js       # miniaturas 3D da biblioteca
│   ├── gpu.js          # cria os renderizadores WebGL (GPU forte → software → aviso)
│   ├── threemf.js      # leitor de .3MF (inclui extensão de produção do Bambu)
│   ├── icons.js        # ícones SVG (copiados do Lucide + próprios do Forgia)
│   └── style.css       # estilos; toda cor da interface vem de variável do tema
├── electron/
│   ├── main.cjs        # janela do programa desktop
│   ├── preload.cjs     # preload mínimo: só a ponte da IA (contextBridge)
│   ├── ponte.cjs       # ponte da IA no processo main (ponte.json, IPC, arquivos)
│   ├── ponte-servidor.cjs # servidor HTTP da ponte (Node puro, testado sem Electron)
│   └── mcp/            # servidor MCP (vai para resources\mcp, fora do asar)
│       ├── forgia-mcp.cjs  # JSON-RPC stdio escrito à mão
│       ├── ferramentas.cjs # ferramentas forgia_* (tools/list)
│       └── manual.cjs      # instructions (≤ 2 KB) e forgia_manual por seção
├── gerar_setup.bat     # gera o instalador do Windows com dois cliques
└── vite.config.js
```

## Modelo de dados

O projeto é uma lista de **objetos simples** (JSON), não de malhas. Cada objeto guarda o tipo da
forma, posição, rotação, tamanho em mm, cor, se é furo, parâmetros da forma e, no caso de grupos,
seus filhos. As malhas three.js são **derivadas** desses dados.

Isso permite que:

- o **histórico** (desfazer/refazer) seja uma pilha de snapshots em JSON;
- o **salvamento** seja apenas gravar esse JSON no `localStorage` (`forgia.design.v1`);
- a cena seja reconstruída a qualquer momento a partir dos dados (`sync`).

Malhas importadas (STL/OBJ/3MF) são guardadas à parte (`forgia.meshes.v1`) e referenciadas pelos
objetos. Se não couberem no armazenamento, o usuário é avisado.

No programa, esse `localStorage` fica na pasta de dados do Forgia (`%APPDATA%\Forgia`, pelo nome
do produto). No `npm run dev`, fica no navegador usado para desenvolver, separado do programa.

## Fluxo de uma alteração

```
ação do usuário (UI, alça, atalho)
        │
        ▼
editor.change(fn)  ── altera os objetos (dados)
        │
        ├─► empilha snapshot no histórico
        ├─► sync(): recria/atualiza as malhas da cena
        ├─► save(): grava no localStorage
        └─► emite eventos ('selection', 'history'…) ──► UI atualiza inspetor e botões
```

O `Editor` estende `EventTarget`; a `UI` só escuta eventos e chama métodos do editor, sem mexer
direto na cena.

## Formas (`shapes.js`)

Cada entrada de `SHAPES` define cor padrão, tamanho inicial e parâmetros editáveis
(ex.: número de lados do polígono, raio interno do tubo, texto); o nome da forma e os rótulos
dos parâmetros vêm de `t.formas` (veja *Textos*). A geometria é gerada em **tamanho unitário** e
escalada para o tamanho em mm do objeto, com normais vincadas para manter arestas vivas e curvas
suaves.

Para adicionar uma forma nova: crie a entrada em `SHAPES`, ponha o nome em `t.formas.nomes` (e os
rótulos de parâmetros novos em `t.formas.params`) e inclua o tipo na lista `BASIC` de `ui.js`
para ela aparecer na biblioteca.

### Forma `desenho` (`outline.js`)

O tipo `desenho` é a peça criada pela ferramenta Desenhar (e, na Fase C, pela IA). Não aparece na
biblioteca nem tem parâmetro no inspetor; o contorno fica em `params.points`:

```js
{ type: 'desenho', params: { points: [[x, z], [x, z], ...] }, size: [w, h, d], pos: [...], ... }
```

- `[x, z]` em mm no plano da mesa, nos eixos internos (x para a direita, z para a frente; o Y do
  usuário e da ponte é −z, veja *Coordenadas*);
- contorno fechado e simples (o último ponto liga no primeiro, sem repetir; nenhum lado cruza ou
  encosta em outro), com pelo menos 3 pontos e área maior que zero;
- centrado (o centro da caixa envolvente é `(0, 0)`; a posição na mesa fica em `pos`) e em
  sentido anti-horário visto de cima;
- os pontos definem o desenho; as medidas vêm de `size`, como nas outras formas: a caixa do
  contorno é esticada para `size[0] × size[2]`, com altura `size[1]`. `SHAPES.desenho.sizeFor`
  dá o tamanho inicial (caixa dos pontos × 2 mm).

A geometria sai do mesmo `extrude()` do coração e da estrela, deitada na mesa como o texto e
normalizada pelo `size`. `prepareOutline(pontos, { tolerance })` leva um traço qualquer (aberto,
com pontos repetidos, horário) para esse formato ou devolve o motivo da recusa (`poucos`, `area`,
`cruzado`); a auto-interseção é conferida em O(n²) nos pares de lados.

## Ferramentas (`editor.tool`)

Desenhar é uma **ferramenta**: um objeto com `enter()`/`exit()`, `onDown`/`onMove`/`onUp`
(devolvem `true` quando trataram o evento), `onKey` opcional, `update()` a cada quadro e `hint()`
(texto da dica de modo). `editor.setTool(nome)` liga a ferramenta (ou desliga, se já estiver
ligada) e `editor.setTool(null)` desliga a atual. Ferramentas, os modos alinhar/espelhar
(`editor.mode`) e a colocação de forma da biblioteca (`editor.placing`) são **exclusivos**: ligar
um desliga os outros, e `Esc` sai de qualquer um. Com uma ferramenta ligada, as alças e as cotas
somem e o clique esquerdo vai para ela; o botão direito e o do meio continuam movendo a vista.

- **Desenhar** (`draw.js`): guarda a vista (`editor.saveView()`), vai para o topo ortográfico e
  desliga o giro; ao sair, `editor.restoreView()` volta exatamente à câmera, posição, alvo e zoom
  de antes. O traço em andamento é uma camada SVG da sobreposição, redesenhada só quando os pontos, o
  cursor ou a vista mudam (`editor.viewKey()`). Os
  cliques usam `editor.snap`; a mão livre é suavizada e simplificada (RDP com tolerância de
  1,5 px, ou seja, proporcional ao zoom). A peça nasce num único `editor.change` (um desfazer).
  Avisos (desenho recusado) saem pelo evento `aviso` do editor, que a UI mostra como toast.
- **Cruzeiro** (`cruise.js`): só entra com peça móvel selecionada (`canEnter`). A bolinha é um
  botão da sobreposição, na base da seleção; arrastar por ela cria `editor.drag = { kind: 'cruise' }`.
  A cada movimento, `editor.surface.hit()` dá o ponto e a normal da face sob o cursor (sem as peças
  que se movem); a seleção gira de `setFromUnitVectors(cimaInicial, normal)` a partir da orientação
  do começo do arraste (mantém o giro em torno da normal) e a base vai para o ponto. Com `Shift`, a
  peça vai para o lado de dentro (topo rente à face). Soltar faz um `commit` só: um desfazer.
  Clicar no corpo da peça continua sendo o arraste normal.

- **Medir** (`measure.js`): a régua fica só no estado da ferramenta (fora do projeto e do
  histórico) e é desenhada numa camada SVG com um rótulo HTML. O snap usa `editor.surface.hit()`:
  vértices e meios das arestas reais da peça sob o cursor (as do contorno de seleção,
  `outlineGeometry`), centros de face circular calculados dos **dados das formas** (tipo +
  `objectMatrix`, descendo nos grupos; nada de detectar círculos na malha), a face ou a grade
  (`editor.snap`). Vence o candidato mais perto do cursor (até 12 px) que não esteja atrás da
  superfície atingida. Editar o total move a peça do ponto final ao longo da linha num
  `editor.change` (um desfazer). ΔX/ΔY/ΔZ saem de `coords.js`.

- **Marcar parte** (`marcar.js`, tecla `N`): o hover mostra o contorno da **parte** sob o
  cursor (linha sem teste de profundidade, na cor do contorno do tema). Dentro de um grupo, a
  malha na tela é a booleana e o raio acerta o grupo; o ponto é testado contra a forma de cada
  filho já transformada (`groupFrame`, descendo em grupos aninhados; `closestPointToPoint` da BVH)
  e fica a mais próxima — na parede de um furo, a parte é o furo (em empate, o furo ganha). O
  clique põe um alfinete numerado (HTML da sobreposição, reprojetado a cada quadro, também com a
  ferramenta desligada) e abre o mini-chat. As marcações ficam em `editor.marks` (fora do projeto
  e do histórico), guardam o ponto, a normal, a face (`+X`…, no sistema do usuário) e o lado da
  parte nos eixos dela, e somem quando a parte é excluída (evento `change`). `info()` relê a parte
  a cada leitura (`forgia_marcacoes`, `forgia_estado`). Enter ou Copiar monta o **pedido** e o
  põe na área de transferência com o PNG da vista com os alfinetes (`src/captura.js`), pelo
  `copiar` do preload (`clipboard.write` do Electron, texto + imagem num item só).

  Formato do pedido copiado (estável, para a futura porta de entrada do Agent Code):

  ````text
  Pedido feito no Forgia, só para a parte marcada (detalhes: forgia_marcacoes).
  Marcação 1: Caixa 'aba' (parte de 'suporte'), ponto (10,59; 25; 25,23) mm, face virada para −Y.
  Pedido: aumenta essa aba em 2 mm

  ```forgia-pedido
  {"formato":"forgia.pedido/1","texto":"aumenta essa aba em 2 mm","marcacoes":[{"n":1,
   "peca":{"id","nome","tipo"},"parte":{"id","nome","tipo","furo","medidas","centro","caixa","params"},
   "ponto":[X,Y,Z],"normal":[..],"face":"-Y","lado_da_parte":"-Y","referencia":"…","pedido":"…"}]}
  ```
  ````

  `formato` muda de versão se algum campo mudar de sentido; campos novos entram sem mudar a versão.

### Superfície sob o cursor (`surface.js`)

Usada pelo Cruzeiro e pela colocação de forma nova da biblioteca (`updatePlacing`), que também
segue qualquer face, alinhada, no lugar do antigo limite "só faces viradas para cima".

- **Raio com BVH**: `ensureBVH(geometry)` monta uma `MeshBVH` do three-mesh-bvh com `indirect: true`
  (não mexe no índice da geometria, que é compartilhada pelo cache de formas e pelo CSG) e o
  `Mesh.prototype.raycast` passa a ser o `acceleratedRaycast` (sem BVH, cai no raycast normal).
- **Normal no mundo** pela matriz normal (certa também com a escala não uniforme de grupos) e
  ajustada ao eixo exato quando está a menos de ~0,5° dele.
- **Região plana**: triângulos que dividem vértice (vértices agrupados por posição, por causa das
  junções em T das booleanas) e estão no mesmo plano do triângulo atingido. A topologia fica em
  cache numa `WeakMap` por geometria e cada região achada fica marcada nos triângulos dela; a
  geometria verde anterior é liberada (`dispose()`) ao trocar de face. Acima de 100 mil
  triângulos (`MAX_TOPOLOGY_TRIS`), não se monta topologia: realça-se só a área em volta do ponto.
- **Face curva**: região plana pequena (menos da metade do disco de raio 0,6 × maior lado da base
  da peça que vai apoiar) com vizinhos quase alinhados. O realce vira os triângulos em volta do
  ponto (raio ≈ 1,3 × esse lado, para aparecer em volta da peça), com a borda esmaecida no shader.
- Cores em `PALETTES[tema].cruise` (face, contorno e opacidades); a troca de tema só muda
  cor/opacidade dos materiais.

## Furos e booleanas (`csg.js`)

Um grupo é resolvido como **união dos sólidos − união dos furos**, usando `three-bvh-csg`.
O resultado é guardado em cache por uma chave derivada só do que afeta a geometria
(`groupKey`), então mover o grupo inteiro ou trocar a cor não recalcula a booleana.

## Textos (`src/textos/`)

Todo texto que aparece na tela fica em `src/textos/pt-BR.js`: um `export default { ... }` com
uma seção por área (`app`, `barra`, `ferramentas`, `vista`, `biblioteca`, `formas`, `inspetor`,
`modos`, `editor`, `dialogos`, `sobre`, `avisos`, `erros`, `dicas`). O arquivo só tem dados e
funções de formatação puras: texto que depende de um valor é função (`avisos.naoLeu(msg)`,
`inspetor.varias(n)`, `barra.grade(mm)`).

`src/textos/index.js` exporta:

- `t` — o objeto do idioma. O código lê `t.barra.importar`, `t.dicas.copy`…;
- `applyTexts(root = document)` — preenche o HTML marcado com uma chave de pontos: `data-t`
  (texto), `data-t-aria` (`aria-label`) e `data-t-placeholder` (placeholder), como em
  `<button data-t="barra.importar">`. Chave que não existe aparece na tela como a própria chave,
  fácil de notar.

Por isso os botões do `index.html` ficam vazios, só com `data-t`/`data-t-aria`. Texto novo entra
direto no `pt-BR.js`, nunca solto no código. Traduzir é escrever outro arquivo com as mesmas
chaves e trocar o import em `index.js`; não há seletor de idioma.

Ficam fora do arquivo: mensagens de `console.*`, o nome do produto no `package.json`, no
`electron/main.cjs` e no instalador, o `<title>` de reserva do HTML (o título completo vem de
`t.app.titulo`) e as letras A–Z/0–9 da categoria *Letras e números*, que são conteúdo.

## Tema claro e escuro (`src/theme.js`)

O tema é `'claro'` ou `'escuro'` e fica marcado no `<html>` como `data-tema`. Todas as cores da
interface vêm de variáveis de CSS definidas em `[data-tema="claro"]` e `[data-tema="escuro"]` no
`style.css`, com `color-scheme` para que selects, barras de rolagem e o seletor de cor nativos
acompanhem. Só as cores de conteúdo ficam fixas: os botões da paleta de cores e o degradê do
multicolorido.

```js
import { theme, THEMES, PALETTES } from './theme.js';

theme.name            // 'claro' | 'escuro'
theme.colors          // PALETTES[theme.name]: cores da vista 3D
theme.set('escuro')   // aplica o data-tema, salva e emite 'change' ({ save: false } não salva)
theme.toggle()
theme.watch(fn)       // chama fn(colors, name) agora e a cada troca; devolve a função que cancela
```

- **Escolha salva**: `localStorage['forgia.tema']`, gravada só quando o usuário escolhe (botão
  sol/lua `#btn-theme` na barra superior ou *Configurações > Aparência*). Sem escolha salva, o
  tema segue o Windows (`prefers-color-scheme`) e acompanha ao vivo se ele mudar.
- **Sem clarão ao abrir**: um `<script>` curto no `<head>` do `index.html`, antes do CSS, resolve
  o tema do mesmo jeito e marca o `data-tema` antes da primeira pintura. No Electron, a janela
  nasce oculta (`show: false`), com o fundo do tema do Windows (`nativeTheme`), e só aparece,
  maximizada, em `ready-to-show`.
- **Vista 3D**: `PALETTES` tem as cores da mesa, da grade, do volume de impressão, da luz do chão,
  da sombra, do contorno de seleção, do furo, das alças, do transferidor e do cubo de navegação.
  `editor.js`, `materials.js`, `handles.js` e `viewcube.js` assinam `theme.watch` e só trocam
  `.color`/`.opacity` dos materiais ou redesenham as texturas de canvas (alças e faces do cubo).
- **A troca só muda cores**: não chama `sync()`, não gera geometria nem refaz as booleanas (CSG),
  então grupos e furos continuam exatamente os mesmos (os `uuid` das geometrias não mudam). As
  cores das peças (`solidMaterial`) ficam como estão, e as miniaturas da biblioteca, PNG gerados
  uma vez, não são refeitas.
- **Depuração**: `window.forgia.theme` é o objeto `theme`.

## Cartão de dica (`src/dica.js`)

Qualquer elemento com `data-dica="<chave>"` ganha um cartão explicativo, com o conteúdo de
`t.dicas[<chave>]` = `{ titulo, atalho?, texto }`. O `dica.js` usa delegação de eventos no
`document`, então um botão criado depois (no inspetor, por exemplo) não precisa registrar nada.

- **Quando aparece**: depois de 400 ms com o ponteiro parado sobre o elemento. Some quando o
  ponteiro sai do elemento e do cartão (com uma folga para alcançar o X), no X, no Esc e ao clicar
  no elemento. Não abre com botão do mouse apertado, durante arraste ou colocação de forma, nem
  com diálogo aberto. Vale também para botão desabilitado: dá para saber o que ele faz antes de
  poder usá-lo.
- **Onde**: abaixo do elemento, centrado, com uma setinha apontando para ele; sem espaço embaixo,
  abre acima. Com `data-dica-lado="direita"` (coluna de vista), abre à direita.
- **O que mostra**: o título; as teclas do atalho, cada uma num `<kbd>` (sem atalho, um selo
  "i"); e uma a três frases. O componente já aceita vídeo (`t.dicas[k].video`), ainda sem uso:
  sem `video`, o bloco nem existe no DOM.
- **Acessibilidade**: o cartão é `role="tooltip"` e o elemento ganha `aria-describedby` enquanto
  ele está aberto. Elementos com cartão não têm `title` (nada de dica nativa duplicada) e mantêm o
  `aria-label` vindo de `t`.

## Coordenadas

Internamente a cena segue a convenção do three.js (**Y para cima**). Na exportação para
`.STL`/`.OBJ` a cena é rotacionada para **Z para cima**, que é o que os fatiadores esperam;
o `.GLB` permanece com Y para cima. A unidade é sempre **milímetro**.

O que o usuário vê e o que a IA vai usar é um **sistema único**: mm, **Z para cima**, **X para a
direita**, **Y para o fundo da mesa**, origem no **centro da mesa** — o mesmo do STL exportado.
A conversão fica só em `src/coords.js` (testada em `tests/coords.test.mjs`):

```js
import { toUser, fromUser, boxToUser } from './coords.js';

toUser([x, y, z])         // interno -> usuário: [x, −z, y]
fromUser([X, Y, Z])       // usuário -> interno: [X, Z, −Y]
boxToUser(min, max)       // caixa interna -> { min, max } do usuário (Y mín vem do z máx)
```

Aceitam `[x, y, z]` ou `{ x, y, z }` (um `Vector3`) e devolvem `[x, y, z]`, sem `−0`. Como não há
translação, valem igual para diferenças (ΔX/ΔY/ΔZ da régua).

## Ponte da IA e servidor MCP

Um agente de IA (Agent Code, Claude Code, Codex, Cursor ou qualquer cliente MCP) controla o
Forgia aberto. No Forgia não há API, chave nem custo por chamada: o agente roda no computador do
usuário e fala com o Forgia por uma ponte **só local**.

```
agente de IA ──stdio (JSON-RPC)──► Forgia.exe + ELECTRON_RUN_AS_NODE=1 + resources\mcp\forgia-mcp.cjs
                                        │ lê <dados>\ponte.json a cada chamada (porta, token)
                                        ▼
                         HTTP 127.0.0.1:47821 (ou livre)  POST /comando { cmd, args }
                                        │ electron/ponte-servidor.cjs (Host, Origin, token, IA ligada)
                                        ▼
                         processo main: electron/ponte.cjs ── IPC ──► página: src/ponte.js
                                                                        └─ src/ponte-comandos.js
```

### Servidor HTTP (`electron/ponte-servidor.cjs`, `electron/ponte.cjs`)

- Escuta **só em 127.0.0.1**, na porta **47821** (longe da 9876 do MCP do Blender); ocupada, usa
  uma livre. Ligado por padrão, com *Configurações > IA > Permitir IA* para desligar.
- A cada abertura gera um **token** aleatório (32 bytes) e grava `{ porta, token, pid, versao }`
  em `<userData>\ponte.json` (`%APPDATA%\Forgia\ponte.json` no instalado); ao fechar, apaga o
  arquivo se ele ainda for o desta execução.
- Recusa (antes de chegar ao editor): `Host` que não seja `127.0.0.1`/`localhost` na porta certa
  (DNS rebinding), qualquer `Origin` ou `Sec-Fetch-*` (pedido de página do navegador; nunca
  responde CORS), token ausente ou errado (comparação em tempo constante), IA desligada,
  `executar_codigo` com o código livre desligado, corpo acima de 4 MB e comando fora da lista.
  Fonte: <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports> ("Security").
- Respostas JSON `{ ok, ... }`: 200 feito; 422 recusado pelo editor (erro que ensina, com
  `validos` e `exemplo`); 409 ocupado; 401/403/404/405/413/503 para o resto.
- A página **não ganha disco**: `importar` lê o arquivo no main (`.stl/.obj/.3mf`, até 200 MB) e
  entrega os bytes; `exportar_stl` recebe o STL da página e grava no main, só em caminho absoluto
  `.stl` mandado pelo agente (dono do token). A sessão da janela cancela `http(s)`/`ws(s)`: o
  Forgia é offline e o código livre não alcança a rede.
- `electron/preload.cjs` expõe só `window.forgiaPonte` (`aoPedido`, `responder`, `configurar`,
  `info`, `aoEstado`, `copiar`); `contextIsolation` e `sandbox` ligados, `nodeIntegration`
  desligado. O main só aceita IPC da própria janela.

### Comandos (`src/ponte-comandos.js`, `src/ponte.js`)

- **Sistema único** (`src/coords.js`): mm, Z para cima, X para a direita, Y para o fundo, origem
  no centro da mesa. `centro` = centro do objeto; `caixa` = `{ min, max }` no mundo; `medidas`
  `[X, Y, Z]` nos eixos do próprio objeto; `rotacao` em graus `[X, Y, Z]` (gira em X, depois Y,
  depois Z, nos eixos fixos da mesa). Números arredondados a 0,01.
- `estado` é semântico e compacto: id, nome, tipo (nomes em português: `caixa`, `cilindro`…),
  furo, cor, medidas, centro, caixa, rotação (só se houver), parâmetros com nome legível,
  `apoiado_em` (`mesa`, id do objeto logo abaixo, `no_ar`, `abaixo_da_mesa`), grupo, partes (só a
  contagem; com `filhos: true` ou `ids`, a lista), marcações, seleção e desfazer. Até 150 objetos
  por resposta. `formas` é o catálogo derivado de `SHAPES` (parâmetros com unidade, limites,
  padrão e significado).
- Toda resposta que altera devolve `criados`, `alterados`, `excluidos`, `refs` e o estado final
  de cada objeto afetado (com a caixa): o agente confere pelo retorno, sem reler nem capturar.
- Âncoras de intenção em `criar`/`alterar`/`importar`: `centro` (null mantém o eixo), `base_z`,
  `sobre: id` (base no topo dele, X/Y no centro dele), `alinhar_com: id`, `mover`. Em `alterar`,
  medidas, giro e parâmetros mantêm o centro X/Y e a base; `esticar { lado: '+Z', mm }` cresce um
  lado e deixa o oposto parado.
- **Partes de grupo**: os comandos acham o objeto em qualquer nível. O grupo guarda os filhos no
  quadro dele, centrado na caixa da booleana; mexer ou excluir uma parte muda essa caixa, e
  `renormalize()` recentra os filhos e ajusta posição e tamanho do grupo (mantendo a escala) para
  que nada saia do lugar no mundo, do grupo mais interno para fora.
- **Um pedido = um desfazer**: `editor.batch(fn, { validate })` suspende os `commit()` (inclusive
  os de `group()`, `align()`, `mirror()`… chamados por dentro, que ganharam um parâmetro com a
  lista de objetos para não mexer na seleção) e grava um só no fim. Se algo falhar, ou se
  `validateProject` achar objeto inválido (id repetido, número não finito, medida ≤ 0, grupo sem
  partes…), objetos e seleção voltam ao snapshot e nada entra no histórico. A pilha de desfazer é
  uma só para IA e usuário.
- `lote`: lista de comandos `{ cmd, ...args }` (ou `{ cmd, args }`) aplicada como **um** passo;
  `ref` em `criar`/`agrupar`/`duplicar`/`importar` e `"$ref"` nos ids seguintes.
- **Ocupado**: com o usuário arrastando (`editor.drag`) ou colocando forma (`editor.placing`),
  comando que altera volta 409 e nada muda. Os pedidos são atendidos um de cada vez.
- **Como a IA aparece**: aviso no canto da vista "IA: criou 2, alterou 1 · Desfazer" por ~6 s
  (conta as peças do topo; o Desfazer só vale enquanto o passo da IA for o último) e o contorno
  dos objetos afetados pisca ~1,5 s (`editor.flash`). A seleção do usuário só muda com
  `selecionar`.
- As mensagens para o agente (erros, descrições das ferramentas, manual) são protocolo, não tela:
  ficam em `src/ponte-comandos.js` e `electron/mcp/`, fora de `src/textos`.

### Código livre (`executar_codigo`, `src/ponte-codigo.js`)

Só em último caso (regra do manual). O código roda num **Worker**, fora da thread da interface:
um laço infinito não congela a janela e o limite de **10 s** (`worker.terminate()`) o interrompe
de verdade. No Worker não há DOM, Node, disco, rede (sessão bloqueada) nem os internos do
editor: só a fachada estável `forgia.*` (`criar`, `alterar`, `excluir`, `agrupar`, `duplicar`,
`alinhar`, `espelhar`, `soltar_na_mesa`, `selecionar`, `objetos()`, `formas()`, `util`) e `THREE`
com as classes de matemática e curvas. A fachada **enfileira** comandos (os mesmos do `lote`;
`criar` devolve `"$ref"`); no fim, a página aplica a fila como um lote: um desfazer, validado, e
erro ou projeto inválido não deixam nada. Limite: o código não lê o resultado do que ele mesmo
criou (`objetos()` é o projeto do início); para isso o agente usa o retorno. O aviso diz "IA
executou código". *Configurações > IA > Permitir código livre da IA* (ligado por padrão) desliga.

### Captura (`src/captura.js`)

Câmera temporária (vistas `iso`, `frente`, `topo`, `direita`, `esquerda`, `tras` ou `atual`;
ortográfica nas vistas de eixo) desenhada uma vez numa região do próprio canvas com a proporção
pedida (viewport + scissor), copiada para um canvas 2D com o fundo degradê do tema e os
alfinetes das marcações; a vista do usuário é redesenhada na mesma tarefa, então a tela nunca
mostra a câmera temporária. Alças, transferidor, realce verde e contornos ficam de fora. Como não
depende do `requestAnimationFrame`, funciona com a janela minimizada. Vai ao agente como
conteúdo `image` (PNG base64).

### Servidor MCP (`electron/mcp/`)

- JSON-RPC 2.0 sobre stdio, **escrito à mão** (sem `@modelcontextprotocol/sdk`): `initialize`
  (devolve `instructions` e `capabilities.tools`; aceita as versões 2025-06-18, 2025-03-26 e
  2024-11-05), `notifications/initialized`, `ping`, `tools/list` e `tools/call`. No stdout só vão
  mensagens MCP (até `console.log` é desviado para o stderr).
- Roda pelo **próprio `Forgia.exe`** com `ELECTRON_RUN_AS_NODE=1`: quem instala o Forgia não
  precisa de Node. Nesse modo o Electron é Node puro: não abre janela nem passa pela trava de
  instância única. O script vai para `resources\mcp\` pelo `build.extraResources` (e sai do asar
  por `"!electron/mcp/**"` em `build.files`).
- A cada chamada lê `ponte.json` da pasta de dados — `FORGIA_DADOS`, se definida (testes com
  `--user-data-dir`), senão `%APPDATA%\Forgia` —, então aguenta o Forgia fechado e reaberto com
  porta e token novos. Forgia fechado: a ferramenta devolve erro "Abra o Forgia".
- Ferramentas (`ferramentas.cjs`): `forgia_estado`, `forgia_formas`, `forgia_criar`,
  `forgia_alterar`, `forgia_excluir`, `forgia_agrupar`, `forgia_desagrupar`, `forgia_alinhar`,
  `forgia_espelhar`, `forgia_soltar_na_mesa`, `forgia_selecionar`, `forgia_duplicar`,
  `forgia_lote`, `forgia_captura`, `forgia_medir`, `forgia_marcacoes`, `forgia_exportar_stl`,
  `forgia_importar`, `forgia_desfazer`, `forgia_refazer`, `forgia_executar_codigo` e
  `forgia_manual` (respondida pelo próprio servidor, funciona com o Forgia fechado).

### Manual da IA (`electron/mcp/manual.cjs`)

Não há skill à parte: o manual vive no servidor MCP e acompanha a versão instalada. Três lugares:

1. **`instructions`** do `initialize` (1.337 bytes; o Claude Code corta em ~2 KB e injeta em
   **toda** conversa, então só o essencial): o que é o Forgia, coordenadas, "monte num
   `forgia_lote`", "confira pelo retorno, não pela imagem", "leia `forgia_manual` antes da primeira
   modelagem", marcações e a regra do código livre só em último caso. O limite é conferido em
   `tests/mcp-manual.test.mjs`.
2. **Descrição de cada ferramenta e parâmetro** (`ferramentas.cjs`), com unidade e exemplo.
3. **`forgia_manual`**: sem seção, o **guia rápido** (medidas de cada forma, posição, furos e um
   exemplo de lote completo, numa chamada só); com seção, o detalhe: `coordenadas`, `receitas`
   (chaveiro, caixa com tampa, padrão em círculo, furo de lado, peça orgânica por `importar`),
   `impressao` (paredes, texto, folgas, parafusos, balanços), `marcacoes`, `codigo_livre` e `erros`.

Foi escrito como skill, com o método das skills de criação de skill (`writing-skills`,
`skill-creator`): linha de base dos pedidos de teste 1–4 **sem** o manual, falhas anotadas
(manual lido em duas chamadas, `forgia_formas` por tipo, texto criado fora do lote só para medir a
largura), receitas positivas para essas falhas e a regra de disciplina (código livre) explícita,
com o que **não** a justifica. As regras de impressão vêm da skill `3d-print-modeling`. Todo
exemplo de lote do manual roda no exe (`tests/manual-exe.test.mjs`) e os pedidos de teste rodam
com um agente real (`tests/agente-real.mjs`, números em `docs/fase-c-evidence/agente/`).

### Conectar IA (`src/conectar.js`)

O botão **Conectar IA** (barra de status e *Configurações > IA*) abre um seletor de agente e um
texto para colar nele, com os caminhos **reais** desta instalação, que o processo main informa
(`ponte:info`: `app.getPath('exe')`, `process.resourcesPath\mcp\forgia-mcp.cjs`, pasta de dados).
`FORGIA_DADOS` só entra quando a pasta de dados não é a padrão (perfil de teste). Clicar de novo
gera os caminhos da versão instalada, e o texto manda trocar a configuração antiga.

| Agente | Servidor | Permissões |
|---|---|---|
| Agent Code / Claude Code | `claude mcp remove --scope user forgia` e `claude mcp add --scope user forgia -e "ELECTRON_RUN_AS_NODE=1" -- "<exe>" "<script>"` (sintaxe do `claude mcp add --help` 2.1.x: `-e` aceita vários valores, então vem depois do nome e antes de `--`); sem o comando, a mesma entrada em `mcpServers` do `~/.claude.json`, mesclada | `"mcp__forgia"` em `permissions.allow` do `~/.claude/settings.json`, **mesclando** com o que existe |
| Codex | `[mcp_servers.forgia]` em `~/.codex/config.toml` (strings literais TOML, `env`, `startup_timeout_sec`, `tool_timeout_sec`) | `default_tools_approval_mode = "auto"` na mesma seção |
| Cursor | `mcpServers.forgia` em `~/.cursor/mcp.json`, mesclado | pela interface do Cursor (Run Mode / lista de permitidas): o texto pede ao agente para orientar o usuário |
| Outro | comando, argumento, variáveis e o bloco `mcpServers` genérico | liberar as ferramentas `forgia_*` |

Os textos ficam em `t.conectar.prompts`; `conectar.js` só monta os pedaços técnicos (comando,
JSON, TOML) e é testado em `tests/conectar.test.mjs`. `tests/conectar-exe.mjs` abre o diálogo no
exe, guarda o texto de cada agente e roda o `claude mcp add` gerado no Git Bash e no PowerShell com
`CLAUDE_CONFIG_DIR` temporário, conferindo com `claude mcp list` que o servidor conecta.

### Barra de status (`src/statusbar.js`)

X/Y/Z do centro e medidas da seleção (uma peça: o mesmo cálculo do `forgia_estado`; várias: a
caixa de todas), o indicador da IA (`conectada` até 10 min depois do último pedido, `pronta`,
`desligada`, `indisponivel`) e o botão **Conectar IA**.

### Testes

- `node --test tests/ponte-seguranca.test.mjs`: o servidor HTTP sem Electron (token, Origin,
  Sec-Fetch, Host, IA e código desligados, corpo, método, porta ocupada, só 127.0.0.1).
- `FORGIA_EXE=release\fase-c\win-unpacked\Forgia.exe node --test tests/ponte-exe.test.mjs`: o exe
  gerado com perfil temporário (segurança no servidor real, MCP pelo exe, cubo, barra × estado,
  lote e desfazer, parte de grupo, código livre com erro, laço infinito e projeto inválido,
  Permitir IA, ocupado, captura minimizada, exportar/importar, fechar e reabrir). Evidências em
  `docs/fase-c-evidence/ponte/` (fora do Git). Sem `FORGIA_EXE`, o teste é pulado.
- `FORGIA_EXE=… node --test tests/marcar-exe.test.mjs`: Marcar parte com mouse e teclado reais
  (realce da parte, alfinete na aba e na parede do furo dentro de um grupo, Enter copia texto +
  imagem conferidos na área de transferência do Windows, fora do projeto e do desfazer,
  `forgia_marcacoes`, captura com alfinetes, some ao excluir, Limpar marcações).

## Desktop (Electron)

`electron/main.cjs` abre uma janela sem menu que carrega `dist/index.html`. Por isso o Vite usa
`base: './'` (caminhos relativos, que funcionam via `file://`). Há trava de instância única:
abrir o programa de novo apenas foca a janela existente. Links `http(s)` que pedem janela nova,
como o crédito da LarcherTech, abrem no navegador padrão (`setWindowOpenHandler`), não dentro do
programa.

## Placa de vídeo (GPU) e fallback

Todos os renderizadores (cena, cubo de navegação, miniaturas) são criados por `createRenderer`
em `src/gpu.js`, em cascata:

1. **GPU** — `powerPreference: 'high-performance'` com `failIfMajorPerformanceCaveat: true`
   (recusa contexto lento). Modo `gpu`.
2. **Software** — se falhar, tenta de novo sem a restrição (SwiftShader ou driver fraco). O 3D
   funciona, mais lento; aparece um aviso único na tela. Modo `software`.
3. **Sem WebGL** — lança `GpuUnavailableError`; `main.js` mostra no lugar do 3D a mensagem
   "O 3D não pôde iniciar neste computador". Modo `none`.

O resultado fica em `window.forgia.gpu` (`{ mode, renderer }`) e aparece no fim do diálogo
**Atalhos** ("Placa de vídeo: …"). No modo software o console mostra os erros da primeira
tentativa do three.js — é esperado.

No **Electron** (`electron/main.cjs`), antes de a janela abrir:

- `force_high_performance_gpu` — em notebooks híbridos o processo de GPU usa a placa dedicada;
- `enable-unsafe-swiftshader` — mantém o WebGL por software como último recurso (o Chromium
  novo deixou de ligá-lo sozinho). Seguro aqui porque só carregamos arquivos locais;
- **não** usamos `ignore-gpu-blocklist` nem `disable-gpu`: driver na lista negra cai no modo
  software em vez de travar.
- Só no **app instalado no Windows**: grava a preferência do Windows (Configurações > Sistema >
  Tela > Gráficos) para o próprio `Forgia.exe` — `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`,
  valor = caminho do exe, dado `GpuPreference=2;` (alto desempenho). Só grava se o valor **não
  existir** (respeita escolha do usuário), de forma assíncrona via `reg.exe`, e falhas são só
  registradas no console. O Windows aplica **a partir do próximo lançamento**. O desinstalador
  (`build/installer.nsh`) remove o valor, exceto numa atualização.

Testes: `node --test tests/gpu-electron.test.mjs` (switches e lógica do registro com `reg.exe`
simulado) e `npx electron tests/gpu-runtime.cjs --expect=gpu` (também `--disable-gpu
--expect=software` e `--disable-gpu --disable-software-rasterizer --expect=none`), que salvam
evidência em `docs/gpu-evidence/` (pasta local, fora do Git). No navegador, `tests/no-webgl.html` (via `npm run dev`)
simula um computador sem WebGL.
