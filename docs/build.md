# Build e distribuição

O Forgia é distribuído como **programa para Windows**: o `Forgia.exe`, que chega ao usuário por
um instalador `.exe` gerado com Electron + electron-builder (NSIS). Não há versão web publicada;
o navegador só entra no ciclo de desenvolvimento (`npm run dev`).

Requisito: [Node.js](https://nodejs.org) 18 ou superior.

## Desenvolvimento

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173` com recarga automática. Serve só para desenvolver: o que vale
como produto, e o que se testa antes de entregar, é o `Forgia.exe`.

Para testar como programa desktop sem gerar instalador:

```bash
npm run desktop
```

O `npm run desktop` abre o Electron com o mesmo nome de produto ("Forgia"), então usa a mesma
pasta de dados do programa instalado (`%APPDATA%\Forgia`) e o mesmo projeto salvo; com o Forgia
instalado aberto, a trava de instância única só traz a janela dele para a frente. Para testar
sem tocar no projeto salvo, use uma pasta de dados própria:

```bash
npm run desktop -- --user-data-dir=<pasta temporária>
```

## Instalador do Windows

### Com dois cliques

Execute **`gerar_setup.bat`** na raiz do projeto. Ele:

1. confere se o Node.js está instalado e sobe a versão (veja *Versão*);
2. roda `npm install`;
3. apaga o instalador anterior e as builds antigas de `release/builds/` (as que estiverem em uso
   ficam para a próxima vez);
4. gera o build e empacota numa pasta nova, `release/builds/<versão>/`, e copia o instalador para
   `release/Forgia-Setup.exe`. Pasta nova a cada build porque um `win-unpacked` antigo pode estar
   travado (um Forgia aberto dali, ou outro programa que leu o `app.asar`), e o empacotamento
   falharia ao apagá-lo;
5. mostra o caminho, a **data e o tamanho** do arquivo gerado e abre a pasta `release/`.

Se algo falhar, a janela fica aberta mostrando o erro e a versão do `package.json` volta à de antes.

### Pelo terminal

```bash
npm run dist:win
```

### Resultado

Pelo `gerar_setup.bat`, `release/Forgia-Setup.exe` e o resto em `release/builds/<versão>/`; pelo
`npm run dist:win`, tudo direto em `release/`:

```
release/
├── Forgia-Setup.exe            # instalador
└── win-unpacked/               # programa já descompactado (útil para testar sem instalar)
    ├── Forgia.exe
    ├── LICENSE.txt             # extraFiles (veja abaixo)
    ├── THIRD-PARTY-NOTICES.txt # extraFiles
    └── …                       # runtime do Electron e resources/app.asar
```

Para abrir o `win-unpacked/Forgia.exe` sem usar o projeto salvo do Forgia instalado, rode-o com
`--user-data-dir=<pasta temporária>`.

O instalador:

- é em português;
- permite escolher a pasta de instalação (instala por usuário, sem pedir administrador);
- cria atalhos na área de trabalho e no Menu Iniciar;
- atualiza por cima o Forgia já instalado, inclusive a 0.1.0 (veja *GUID fixo do instalador*);
- coloca `LICENSE.txt` e `THIRD-PARTY-NOTICES.txt` ao lado do `Forgia.exe`;
- inclui desinstalador.

### Versão

A versão vem do campo `"version"` do `package.json` e aparece no rodapé do instalador
("Forgia 0.1.1"), em Configurações ("Forgia v0.1.1") e em Atalhos > Sobre o Forgia ("versão
0.1.1"), pelo `__APP_VERSION__` do `vite.config.js`.

O `gerar_setup.bat` sobe a versão sozinho: antes do build, ele roda `node scripts/bump-version.mjs`,
que soma 1 no patch (0.1.0 → 0.1.1), troca só o valor da chave `"version"` (a formatação do
arquivo fica igual) e imprime a versão nova, que o `.bat` mostra como "Versao desta build". Só o
`gerar_setup.bat` sobe a versão; `npm run dist:win` e `npm run dist:win:branding` usam a que está no
`package.json`. Para subir o minor ou o major, edite o `package.json` à mão antes.

O número sobe a cada geração, mesmo se o build falhar ou for só teste, então as versões publicadas
podem pular números. O `package.json` alterado vai no commit da release.

O nome do instalador é fixo, `Forgia-Setup.exe`, sem a versão: assim o link
`releases/latest/download/Forgia-Setup.exe` do README baixa sempre o da última release.

### GUID fixo do instalador (`nsis.guid`)

O Windows reconhece a instalação pelo GUID do instalador. Ele é o nome da chave
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>` (a entrada de "Programas
instalados") e da chave `HKCU\Software\<GUID>`, onde o instalador procura a pasta da versão
anterior para atualizar por cima. Sem `nsis.guid`, o electron-builder calcula o GUID a partir do
`appId`: `UUID.v5(appId, namespace fixo do electron-builder)`, em
`node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js`.

Depois da 0.1.0, o `appId` passou a ser `com.larchertech.forgia`. Com o GUID calculado do appId
novo, o instalador novo não reconheceria a instalação existente: em vez de atualizá-la, criaria
uma segunda entrada "Forgia" em "Programas instalados". Por isso o `package.json` fixa
`build.nsis.guid` em `153d514a-c2d8-5c34-bb9e-2434891e3e5f`, o GUID derivado do appId usado até
a 0.1.0 (o appId antigo está no `package.json` do primeiro commit). É a mesma chave do Forgia
0.1.0 instalado, o que dá para conferir no PowerShell:

```powershell
Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' |
  Where-Object PSChildName -eq '153d514a-c2d8-5c34-bb9e-2434891e3e5f' |
  Get-ItemProperty | Select-Object DisplayName, DisplayVersion, Publisher
```

**Não mude esse valor**: outro GUID quebra a atualização por cima de todas as instalações
existentes. Os projetos salvos não dependem dele, porque a pasta de dados (`%APPDATA%\Forgia`)
usa o nome do produto.

### Licenças junto do programa (`extraFiles`)

O `build.extraFiles` do `package.json` copia dois arquivos da raiz do projeto para a pasta do
programa, ao lado do `Forgia.exe` (em `win-unpacked/` e na pasta instalada):

| No projeto | No programa |
|---|---|
| `LICENSE` | `LICENSE.txt` |
| `THIRD-PARTY-NOTICES` | `THIRD-PARTY-NOTICES.txt` |

A licença do Forgia (MIT) e a dos ícones do Lucide (ISC, com a parte MIT do Feather) pedem que o
aviso de copyright acompanhe as cópias distribuídas. A extensão `.txt` faz os dois abrirem com
dois cliques no Bloco de Notas. Ao copiar um ícone novo do Lucide para `src/icons.js`, atualize a
lista em `THIRD-PARTY-NOTICES`.

### Servidor MCP fora do asar (`extraResources`)

O servidor MCP da ponte da IA (`electron/mcp/*.cjs`) roda pelo próprio `Forgia.exe` com
`ELECTRON_RUN_AS_NODE=1`, então precisa estar em arquivo comum, não dentro do `app.asar`:

- `build.files` exclui `electron/mcp/**` do asar;
- `build.extraResources` copia `electron/mcp/*.cjs` para `resources\mcp\` (em `win-unpacked/` e na
  pasta instalada: `<pasta do Forgia>\resources\mcp\forgia-mcp.cjs`).

Conferência rápida no programa gerado (sem abrir janela, e sem esbarrar na instância única):

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | .\release\fase-c\win-unpacked\Forgia.exe .\release\fase-c\win-unpacked\resources\mcp\forgia-mcp.cjs
```

### Marca e ícones

O master autoral é `public/branding/forgia-forge-v1.svg`: F geométrico extrudado, face
laranja-forja, topo âmbar e lateral cobre sobre grafite. A barra superior usa o símbolo (26px) +
o wordmark Forgia.

Para regenerar os derivados depois de editar o SVG:

```bash
npm run branding:generate
npm run test:branding
npm run build
```

O gerador `scripts/generate-branding.cjs` usa o Chromium do Electron já instalado, sem
novas dependências, fontes externas ou rede. Gera PNG 1024×1024, ICO com frames PNG de
16/24/32/48/64/128/256px e manifesto JSON com versões do renderizador e hashes SHA-256.
O perfil isolado do gerador fica em `build/branding-generator-profile/`, fora do Git e da distribuição.
Os assets gerados são mantidos junto ao master; regeneração é necessária apenas ao mudar o desenho.

Vite copia `public/branding/` para `dist/branding/`. Logo e favicon usam URLs relativas,
compatíveis com subpastas e `file://`. BrowserWindow lê o ICO de `dist/branding/`, incluído
no ASAR pelo padrão `dist/**/*`. Windows, instalador, cabeçalho NSIS e desinstalador
referenciam explicitamente o mesmo ICO em `package.json`. Em futura mudança de marca,
incremente `forgia-forge-v1` em todas as referências para evitar favicon antigo em cache.
O símbolo da LarcherTech usado no crédito (`public/branding/larchertech-lb.png`) vai
empacotado pelo mesmo caminho: nada é carregado da internet.

Para gerar uma validação sem substituir a release anterior na raiz:

```bash
npm run dist:win:branding
```

Saída: `release/branding/Forgia-Setup.exe` e `release/branding/win-unpacked/`.
Esse comando não instala o programa. Novas execuções substituem apenas essa saída de
validação. Não use `gerar_setup.bat` para preservar o instalador anterior na raiz.

### Pendências conhecidas

- **Assinatura digital**: o instalador não é assinado, então o Windows SmartScreen exibe um aviso
  na primeira execução.

## Dicas animadas: regravar os vídeos

Os 22 vídeos do cartão de dica (`public/ajuda/<dica>-<tema>.webm`, 11 funções × claro e escuro)
saem do próprio Forgia, a partir dos roteiros (`ajuda/roteiros/*.json`) e das cenas
(`ajuda/cenas/*.json`). Regravar tudo é um comando:

```bash
npm run gravar-dicas
```

Ele faz o build do Vite e abre o **modo gravação** (`scripts/gravar-dicas.mjs` →
`scripts/gravar/principal.cjs`): uma janela do Forgia sem moldura, de tamanho fixo, que aparece na
tela sempre por cima e não recebe o mouse físico, com um perfil **temporário** (`--user-data-dir` e
`FORGIA_DADOS` em `%TEMP%`, apagado no fim; nunca o `%APPDATA%\Forgia`). Não precisa de nada além
do Electron do projeto: a captura é `desktopCapturer` + `MediaRecorder` (WebM VP9, sem som).
Leva uns 4 minutos para os 22 vídeos (≈ 4,5 MB no total; o instalador cresce o mesmo tanto).

Opções (depois de `--`): `--dicas=cruise,align` (só alguns roteiros), `--temas=claro`,
`--cenas` (remonta as cenas pela `montagem` antes: Iniciantes + lote da ponte), `--cena=<arquivo>`
(remonta uma cena fora de `ajuda/cenas`, ex.: `docs/media/cenas/caixa-esp32.json`), `--so-cenas`,
`--previa` (só a foto da pose inicial, para acertar o enquadramento), `--fotos=<pasta>`,
`--resumo=<arquivo.json>` (tamanho, duração e a diferença início × fim de cada vídeo),
`--roteiros=<pasta>` e `--saida=<pasta>`. O formato dos roteiros está em
[arquitetura.md](arquitetura.md#dicas-animadas-modo-gravação).

Conferência: `node --test tests/dicas-gravacao.test.mjs` (roteiros, cenas e os 22 vídeos: 640×480,
VP9, 4–6 s, até 300 KB) e, no programa gerado,
`FORGIA_EXE=release\fase-e\win-unpacked\Forgia.exe node --test tests/dicas-exe.test.mjs` (o cartão
toca o vídeo do tema, troca com o tema, pausa, para ao fechar e a vista mantém os quadros).

## Mídias do README

Os GIFs de `docs/media/` saem do mesmo modo gravação. **Regravar exige o ffmpeg instalado na
máquina** (é uma ferramenta do computador, não uma dependência do projeto; no Windows,
`winget install Gyan.FFmpeg`):

```bash
npm run gravar-dicas                        # as dicas (se mudaram): public/ajuda
npm run gravar-dicas -- --roteiros=docs/media/roteiros --temas=claro --saida=docs/fase-e-evidence/readme-video
npm run gravar-dicas -- --roteiros=docs/media/roteiros --dicas=conectar-agentcode,conectar-claude,conectar-codex,conectar-outro --temas=escuro --saida=docs/fase-e-evidence/readme-video
npm run gravar-dicas -- --roteiros=docs/media/roteiros --dicas=pedir --temas=claro,escuro   # dica do Pedir à IA: public/ajuda
FFMPEG=<caminho do ffmpeg.exe> node scripts/gifs-readme.mjs
```

A segunda linha grava a janela inteira para as cenas do README (a IA montando o chaveiro,
arrastar formas, abrir um modelo baixado, exportar, Conectar IA); a terceira converte essas
gravações e quatro dicas (desenhar, marcar, encaixe, cruzeiro + medir) em GIF e gera
`docs/media/forgia-apresentacao.webm`. Ela também gera os vídeos das abas do Conectar IA dentro do app
(`public/ajuda/conectar-<agente>-<tema>.webm`, VP9 800 px) a partir das gravações `conectar-*` nos
dois temas (por isso a linha com `--temas=escuro`); `--so=conectar-app` refaz só esses. Os GIFs
passam por um filtro de ruído só no tempo (`hqdn3d=0:0:4:4`, nada borra), que tira o chiado da
compressão da gravação e deixa cada GIF com cerca de metade do tamanho. `--so=encaixe,importar` refaz só esses. As gravações
intermediárias ficam em `docs/fase-e-evidence/` (fora do Git). A pré-visualização local do README
(conversor mínimo, não é o GitHub) é `npx electron scripts/previa-readme.cjs`.

**Regra dos GIFs: não perder qualidade.** Todo texto dentro deles (legenda, selo, cota, botão) tem
que se ler no tamanho exibido no README, no computador e no celular; legibilidade vem antes do
tamanho. Por isso:

- cada GIF sai na **largura original da gravação** (README 960 px, dicas 640 px; o
  `cruzeiro-medir.gif` junta duas dicas lado a lado, 1280 px), com a paleta própria de 128 cores
  e o pontilhado leve de sempre;
- o tamanho só cai **sem perda**: quadros repetidos (tempo parado) viram um quadro mais longo
  (`mpdecimate` + tempo variável por quadro) e só o retângulo que muda é regravado;
- **~3 MB por GIF é referência, não limite**: o script avisa quando passa, para conferir se a
  nitidez compensa. Não reduza largura, cores nem pontilhado a ponto de borrar texto;
- não troque GIF por MP4: vídeo no README só toca se for subido num comentário do GitHub, fora do
  repositório.

O modelo do GIF de importar é o esqueleto de *Triceratops horridus* do Smithsonian (CC0, domínio
público), convertido do OBJ original para `docs/media/modelos/triceratops.3mf` (150 mm, em mm)
por `node scripts/modelo-readme.mjs --obj=<arquivo.obj>`. O ZIP de origem fica fora do Git; veja o
link e a licença no README. O roteiro solta o arquivo na janela com a ação `arquivo` do modo
gravação (o mesmo drop de um arraste do Explorador).

A imagem de prévia do repositório (Settings → Social preview) sai de
`npx electron scripts/previa-social.cjs` para `docs/media/previa-social.png` (1280×640, até
1 MB); os textos da página do GitHub estão em [github-pagina.md](github-pagina.md).

## Publicando uma release no GitHub

1. Gere o instalador com `gerar_setup.bat` (ele sobe a versão; veja *Versão*).
2. Faça o commit do `package.json` com a versão nova.
3. Crie uma tag com essa versão (ex.: `git tag v0.1.1 && git push --tags`).
4. No GitHub, crie a *Release* a partir da tag e anexe `release/Forgia-Setup.exe` com esse nome
   exato: é ele que o link `releases/latest/download/Forgia-Setup.exe` procura.

A pasta `release/` fica fora do Git (veja `.gitignore`): o instalador é distribuído pelas
Releases, não pelo repositório.
