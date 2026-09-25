# Forgia Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Aplicar a marca F 3D aprovada ao app e distribuição Windows sem mudar o editor.

**Architecture:** SVG master público; Electron existente rasteriza derivados. Vite copia os recursos para dist, compartilhados pela página e janela desktop. NSIS usa o mesmo ICO.

**Tech Stack:** SVG, Node.js, Electron, Vite, electron-builder, node:test.

**Spec:** `docs/superpowers/specs/2026-09-24-forgia-branding.md`

## Global Constraints

- Face `#f58220`, topo `#ffc16b`, cobre `#b95119`, grafite `#2b2f33`; símbolo 36px + Forgia.
- Não refatorar editor, instalar programa, alterar dados existentes ou executar git.
- Sem dependências novas; instalador de validação em `release/branding/`.
- Execução já aprovada; devolver ao ledger em review, não done.

## Review Focus

- Ícones 16px: F deve permanecer identificável; inspecionar prancha multiescala.
- URLs file://: testar referências do HTML compilado e ICO no ASAR.
- Cache: basename novo e reload/navegação no app real.
- Dados locais: usar origem de teste limpa, nunca limpar origem do usuário.
- Artefatos prévios: preservar saída release raiz e verificar hashes antes/depois.

### 1. Master e derivados

Files: criar `public/branding/forgia-forge-v1.svg`, `scripts/generate-branding.cjs`, `tests/branding.test.mjs`; derivados PNG/ICO/manifest em `public/branding/`.

Interface: `npm run branding:generate` lê master e gera PNG 1024, ICO 16/24/32/48/64/128/256 e manifesto SHA-256. `npm run test:branding` valida arquivos/configuração.

- [ ] Capturar fontes existentes para diff sem git em `docs/branding-evidence/before/`.
- [ ] Escrever teste node:test para PNG signature/IHDR/CRC, frames ICO, hashes do manifesto e URLs/configuração; rodar antes da implementação e observar falha por assets ausentes.
- [ ] Desenhar F frontal com extrusão (64,-64) em viewBox 1024, poucos polígonos e nenhum recurso externo; gerar raster via canvas Chromium do Electron, montar cabeçalho ICO com Buffer.
- [ ] Rodar gerador duas vezes, conferir identidade dos hashes e leitura visual multiescala.

### 2. Integração e distribuição

Files: modificar apenas `index.html`, bloco `.logo` em `src/style.css`, `electron/main.cjs`, `package.json`, `docs/build.md`.

Interface: HTML usa `./branding/forgia-forge-v1.svg` e `.ico`; `BrowserWindow.icon = path.join(__dirname, '..', 'dist', 'branding', 'forgia-forge-v1.ico')`; `build.win.icon` e `build.nsis.installerIcon/uninstallerIcon/installerHeaderIcon` usam `public/branding/forgia-forge-v1.ico`.

- [ ] Substituir mosaico por img decorativa 36x36 e span Forgia mantendo aria-label, link e toolbar.
- [ ] Aplicar flex/gap 9px, wordmark Segoe UI semibold 20px; foco visível, sem alterações globais.
- [ ] Adicionar scripts geração/teste e `dist:win:branding` com `-c.directories.output=release/branding`.
- [ ] Atualizar docs de regeneração e remover pendência do ícone padrão.
- [ ] Rodar `npm run test:branding`, `npm run build`, `npm run dist:win:branding`; inspecionar ASAR, paths, EXE/ICO e preservar release anterior.

### 3. Verificação real e entrega

Files: evidências em `docs/branding-evidence/`; nenhum código do editor alterado.

- [ ] Servir build com `npm run preview -- --host 127.0.0.1 --port 4178 --strictPort` e deixar rodando.
- [ ] Inspecionar app vazio, criar caixa, editar dimensão, reload e sair/voltar, excluir; importar arquivo inválido via File/DataTransfer em input se viável.
- [ ] Capturar screenshots da marca e editor real; registrar observações e limites sem encobrir avisos existentes.
- [ ] Salvar diff não-git e logs, registrar entregáveis e passar running → review.
