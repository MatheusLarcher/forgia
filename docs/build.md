# Build e distribuição

O Forgia pode ser distribuído de duas formas a partir do mesmo código:

- **Web** — arquivos estáticos em `dist/`, que podem ser publicados em qualquer hospedagem
  (GitHub Pages, Netlify, Vercel, um servidor próprio…).
- **Programa para Windows** — instalador `.exe` gerado com Electron + electron-builder.

Requisito: [Node.js](https://nodejs.org) 18 ou superior.

## Desenvolvimento

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173` com recarga automática.

Para testar como programa desktop sem gerar instalador:

```bash
npm run desktop
```

## Versão web

```bash
npm run build     # gera dist/
npm run preview   # serve o dist/ para conferência
```

Como o Vite está configurado com `base: './'`, o conteúdo de `dist/` funciona em qualquer
subpasta — inclusive `https://<usuario>.github.io/forgia/`.

## Instalador do Windows

### Com dois cliques

Execute **`gerar_setup.bat`** na raiz do projeto. Ele:

1. confere se o Node.js está instalado;
2. roda `npm install`;
3. apaga o instalador anterior (para não confundir com uma versão antiga);
4. gera o build e empacota o instalador;
5. mostra o caminho, a **data e o tamanho** do arquivo gerado e abre a pasta `release/`.

Se algo falhar, a janela fica aberta mostrando o erro.

### Pelo terminal

```bash
npm run dist:win
```

### Resultado

```
release/
├── Forgia-Setup-<versão>.exe   # instalador
└── win-unpacked/               # programa já descompactado (útil para testar sem instalar)
```

O instalador:

- é em português;
- permite escolher a pasta de instalação (instala por usuário, sem pedir administrador);
- cria atalhos na área de trabalho e no Menu Iniciar;
- inclui desinstalador.

### Versão

A versão vem do campo `"version"` do `package.json` e entra no nome do arquivo
(`Forgia-Setup-0.1.0.exe`). Atualize-a antes de gerar uma nova release.

### Marca e ícones

O master autoral é `public/branding/forgia-forge-v1.svg`: F geométrico extrudado, face
laranja-forja, topo âmbar e lateral cobre sobre grafite. A barra usa símbolo de 36px +
wordmark Forgia; as demais cores e controles do editor permanecem iguais.

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

Para gerar uma validação sem substituir a release anterior na raiz:

```bash
npm run dist:win:branding
```

Saída: `release/branding/Forgia-Setup-0.1.0.exe` e `release/branding/win-unpacked/`.
Esse comando não instala o programa. Novas execuções substituem apenas essa saída de
validação. Não use `gerar_setup.bat` para preservar o instalador anterior na raiz.

### Pendências conhecidas

- **Assinatura digital**: o instalador não é assinado, então o Windows SmartScreen exibe um aviso
  na primeira execução.

## Publicando uma release no GitHub

1. Atualize `"version"` no `package.json`.
2. Gere o instalador (`gerar_setup.bat` ou `npm run dist:win`).
3. Crie uma tag (`git tag v0.1.0 && git push --tags`).
4. No GitHub, crie a *Release* a partir da tag e anexe `release/Forgia-Setup-<versão>.exe`.

A pasta `release/` fica fora do Git (veja `.gitignore`): o instalador é distribuído pelas
Releases, não pelo repositório.
