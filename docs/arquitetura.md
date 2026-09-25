# Arquitetura

O Forgia é uma aplicação web em **JavaScript puro** (módulos ES), sem framework de interface.
A renderização é feita com **three.js**, as operações de furo com **three-bvh-csg**, e o
empacotamento com **Vite**. O mesmo build roda no navegador ou dentro do **Electron** como
programa de Windows.

```
forgia/
├── index.html          # estrutura da tela (barras, viewport, biblioteca)
├── src/
│   ├── main.js         # ponto de entrada: cria o Editor e a UI
│   ├── editor.js       # núcleo: cena, câmera, seleção, histórico, salvamento
│   ├── ui.js           # interface: biblioteca, inspetor, diálogos, import/export
│   ├── shapes.js       # definição e geração da geometria de cada forma
│   ├── csg.js          # booleanas: sólidos − furos dentro de grupos
│   ├── handles.js      # alças de manipulação e transferidor de rotação
│   ├── edges.js        # contorno de seleção (arestas reais após CSG)
│   ├── viewcube.js     # cubo de navegação
│   ├── materials.js    # materiais de sólido e de furo (listrado)
│   ├── thumbs.js       # miniaturas 3D da biblioteca
│   ├── gpu.js          # cria os renderizadores WebGL (GPU forte → software → aviso)
│   ├── threemf.js      # leitor de .3MF (inclui extensão de produção do Bambu)
│   ├── icons.js        # ícones SVG da barra de ferramentas
│   └── style.css
├── electron/main.cjs   # janela do programa desktop
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

Cada entrada de `SHAPES` define rótulo, cor padrão, tamanho inicial e parâmetros editáveis
(ex.: número de lados do polígono, raio interno do tubo, texto). A geometria é gerada em
**tamanho unitário** e escalada para o tamanho em mm do objeto, com normais vincadas para
manter arestas vivas e curvas suaves.

Para adicionar uma forma nova: crie a entrada em `SHAPES` e inclua o tipo na lista `BASIC` de
`ui.js` para ela aparecer na biblioteca.

## Furos e booleanas (`csg.js`)

Um grupo é resolvido como **união dos sólidos − união dos furos**, usando `three-bvh-csg`.
O resultado é guardado em cache por uma chave derivada só do que afeta a geometria
(`groupKey`), então mover o grupo inteiro ou trocar a cor não recalcula a booleana.

## Coordenadas

Internamente a cena segue a convenção do three.js (**Y para cima**). Na exportação para
`.STL`/`.OBJ` a cena é rotacionada para **Z para cima**, que é o que os fatiadores esperam;
o `.GLB` permanece com Y para cima. A unidade é sempre **milímetro**.

## Desktop (Electron)

`electron/main.cjs` abre uma janela sem menu que carrega `dist/index.html`. Por isso o Vite usa
`base: './'` (caminhos relativos, que funcionam via `file://`). Há trava de instância única:
abrir o programa de novo apenas foca a janela existente.

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
