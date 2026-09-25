<div align="center">

# 🔥 Forgia

**Da ideia à peça.**

Editor 3D simples e rápido para criar peças e projetos para **impressão 3D** —
no navegador ou como programa para Windows.

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
- **Desfazer/refazer** e salvamento automático no próprio computador.

## 🚀 Começando

### Usar como programa (Windows)

Baixe o instalador `Forgia-Setup-x.y.z.exe` na página de
[Releases](../../releases) e execute. Como o instalador ainda não é assinado digitalmente, o
Windows pode exibir o aviso do SmartScreen: clique em **Mais informações → Executar assim mesmo**.

### Rodar a partir do código

Requer [Node.js](https://nodejs.org) 18 ou superior.

```bash
git clone <url-do-repositorio> forgia
cd forgia
npm install
npm run dev        # abre em http://localhost:5173
```

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Gera a versão web estática em `dist/` |
| `npm run preview` | Serve o `dist/` localmente para conferir o build |
| `npm run desktop` | Gera o build e abre como programa (Electron) |
| `npm run dist:win` | Gera o instalador do Windows em `release/` |

No Windows, basta dar dois cliques em **`gerar_setup.bat`** para gerar o instalador.

## 📚 Documentação

- [Guia de uso](docs/guia-de-uso.md) — como modelar, atalhos e dicas para impressão
- [Arquitetura](docs/arquitetura.md) — como o código está organizado
- [Build e distribuição](docs/build.md) — versão web, programa desktop e instalador

## 🧱 Tecnologias

- [three.js](https://threejs.org) — renderização 3D
- [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) e
  [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — operações booleanas (furos)
- [Vite](https://vitejs.dev) — desenvolvimento e build
- [Electron](https://www.electronjs.org) + [electron-builder](https://www.electron.build) — programa e instalador para Windows

JavaScript puro, sem framework de interface.

## 🤝 Contribuindo

Sugestões e correções são bem-vindas! Abra uma *issue* descrevendo o problema ou a ideia, ou
envie um *pull request*. Veja a [arquitetura](docs/arquitetura.md) para se localizar no código.

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
