# Forgia — marca aprovada

O usuário aprovou «pode fazer»: F geométrico esculpido em 3D, laranja-forja sobre grafite, aplicado ao app, favicon e Windows/instalador. Execução direta; não reabrir brainstorming.

## Design

- Símbolo autoral: silhueta frontal inequívoca de F, haste robusta e dois braços de comprimentos diferentes; extrusão curta para cima/direita com poucos planos. Não usar cubo genérico, mosaico, ferramentas ou texturas.
- Face `#f58220`, topo âmbar `#ffc16b`, lateral cobre `#b95119`, fundo grafite `#2b2f33`, volume do fundo `#202428`. Cantos arredondados e espaço de proteção integrado ao quadrado.
- Aplicação no topo: símbolo 36px e palavra **Forgia** em Segoe UI semibold, 20px, grafite; alinhamento horizontal, discreto. Manter barra de 56px, toolbar, paleta branca/azul e todo comportamento existente. Marca não anima.
- SVG master independente de fontes/recursos externos. PNG 1024px e ICO 16/24/32/48/64/128/256 derivados do mesmo desenho. Novo basename `forgia-forge-v1` evita cache do favicon antigo.

## Integração e limites

Recursos públicos em `public/branding/`, copiados pelo Vite para `dist/branding/`. HTML com URLs relativas seguras em `file://`; BrowserWindow aponta para o ICO realmente incluído em `dist/branding/` no ASAR. electron-builder/NSIS referenciam o ICO em `public/branding/`. Gerador reproduzível usando Electron já instalado, sem nova dependência.

Não refatorar editor, instalar programa, alterar dados existentes ou executar git. Preservar instaladores anteriores gerando a validação em `release/branding/`.

## Aceite

Testes concretos de dimensões, integridade dos PNG/ICO, consistência master/derivados, URLs relativas, configuração Windows e inclusão no ASAR. Build web e instalador NSIS. App real em origem de teste limpa: vazio, criar/editar/excluir, reload, sair/voltar e erro de arquivo inválido quando viável. Screenshots e resultados no ledger; revisão final pelo supervisor/crítico.
