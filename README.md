<div align="center">

# 🔥 Forgia

**Da ideia à peça.**

Editor 3D simples e rápido para criar peças e projetos para **impressão 3D** —
um programa para Windows.

</div>

---

O Forgia é um modelador por formas: você arrasta blocos prontos (caixa, cilindro, esfera, texto…)
para a mesa de impressão, ajusta medidas em milímetros, combina tudo e marca partes como
**furo** para recortar. No fim, exporta um `.STL`, `.OBJ` ou `.GLB` pronto para o fatiador
(Bambu Studio, OrcaSlicer, PrusaSlicer, Cura…).

Quem já usou o Tinkercad se sente em casa — mas o Forgia roda **offline**, sem conta e sem
enviar seus projetos para a nuvem.

## ✨ Recursos

- **Biblioteca de formas**: caixa, cilindro, esfera, cone, telhado, telhado redondo, cunha,
  pirâmide, meia esfera, polígono, paraboloide, toroide, tubo, estrela, coração, icosaedro,
  texto em 3D e um conjunto de letras e números.
- **Sólido ou furo**: qualquer forma vira furo; ao agrupar, os furos recortam os sólidos
  (operações booleanas/CSG de verdade, com malha fechada).
- **Medidas em milímetros** com ajuste de grade de 0,1 mm a 10 mm.
- **Mesa da sua impressora**: predefinições para Bambu A1/P1, A1 mini, Prusa, Ender 3 e
  outras, ou tamanho personalizado.
- **Alças de manipulação** para redimensionar, elevar e girar (com transferidor), alinhar,
  espelhar, agrupar/desagrupar, bloquear e ocultar.
- **Importação** de `.STL`, `.OBJ` e `.3MF` (inclusive projetos do Bambu Studio / OrcaSlicer).
- **Exportação** para `.STL` (binário), `.OBJ` e `.GLB` — tudo ou só a seleção.
- **Cubo de navegação**, vista ortográfica/perspectiva e atalhos de teclado.
- **Tema claro e escuro** (na primeira abertura, segue o tema do Windows) e **dicas** que
  explicam cada botão quando o mouse para sobre ele.
- **Desfazer/refazer** e salvamento automático no próprio computador.

## 🚀 Começando

### Usar como programa (Windows)

Baixe o instalador `Forgia-Setup-x.y.z.exe` na página de
[Releases](../../releases) e execute. Como o instalador ainda não é assinado digitalmente, o
Windows pode exibir o aviso do SmartScreen: clique em **Mais informações → Executar assim mesmo**.

### Desenvolver a partir do código

Requer [Node.js](https://nodejs.org) 18 ou superior.

```bash
git clone <url-do-repositorio> forgia
cd forgia
npm install
npm run dev        # ciclo de desenvolvimento: abre em http://localhost:5173
```

O `npm run dev` abre o editor no navegador, com recarga automática, só para desenvolver. O
Forgia é distribuído como programa para Windows (`Forgia.exe`); não há versão web.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga automática (no navegador, só para desenvolver) |
| `npm run desktop` | Gera o build e abre como programa (Electron) |
| `npm run dist:win` | Gera o instalador do Windows em `release/` |

No Windows, basta dar dois cliques em **`gerar_setup.bat`** para gerar o instalador.

## 📚 Documentação

- [Guia de uso](docs/guia-de-uso.md) — como modelar, atalhos e dicas para impressão
- [Arquitetura](docs/arquitetura.md) — como o código está organizado
- [Build e distribuição](docs/build.md) — programa para Windows, instalador e atualização

## 🧱 Tecnologias

- [three.js](https://threejs.org) — renderização 3D
- [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) e
  [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — operações booleanas (furos)
- [Vite](https://vitejs.dev) — desenvolvimento e build
- [Electron](https://www.electronjs.org) + [electron-builder](https://www.electron.build) — programa e instalador para Windows
- [Lucide](https://lucide.dev) — ícones da interface (SVGs copiados para o código, sem pacote)

JavaScript puro, sem framework de interface.

## 🤝 Contribuindo

Sugestões e correções são bem-vindas! Abra uma *issue* descrevendo o problema ou a ideia, ou
envie um *pull request*. Veja a [arquitetura](docs/arquitetura.md) para se localizar no código.

## 📄 Autoria e licença

© 2026 [LarcherTech](https://larchertech.com/). Distribuído sob a licença [MIT](LICENSE).

Os ícones da interface vêm do [Lucide](https://lucide.dev) (licença ISC; os que derivam do
Feather, licença MIT). O aviso completo está em [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES), que o
instalador também coloca ao lado do `Forgia.exe`.

Feito no Brasil, por um carioca — [LarcherTech](https://larchertech.com/).
