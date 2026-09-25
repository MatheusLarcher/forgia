<h1 align="center">
  <img src="public/branding/forgia-forge-v1.svg" width="64" height="64" alt=""><br>
  Forgia
</h1>

<p align="center">
  <b>Da ideia à peça.</b>
</p>

<p align="center">
  Um programa para Windows, em português, para quem quer <b>imprimir em 3D</b> sem ser engenheiro:<br>
  você monta a peça com formas prontas, em milímetros, pede ajuda à IA se quiser e manda para a impressora.
</p>

<p align="center">
  <img alt="Windows 10 e 11" src="docs/media/selos/windows.svg">
  <img alt="Em português" src="docs/media/selos/idioma.svg">
  <img alt="Grátis" src="docs/media/selos/preco.svg">
  <img alt="Funciona offline" src="docs/media/selos/offline.svg">
  <img alt="Com IA pelo MCP" src="docs/media/selos/ia.svg">
</p>

<p align="center">
  <img src="docs/media/ia-chaveiro.gif" width="720" alt="Um pedido em português aparece na tela, a IA monta um chaveiro com o nome ANA no Forgia e a peça segue para a exportação em 3MF">
</p>

<p align="center"><sub>Reprodução dos comandos que o agente de IA (Claude Code) enviou numa sessão real de teste para o pedido
“faça um chaveiro com o nome ANA”: o mesmo lote, pela mesma ponte local, gravado da tela do próprio Forgia.
A legenda com o pedido foi posta na gravação. <a href="docs/media/forgia-apresentacao.webm">Ver em vídeo</a>.</sub></p>

---

## <img src="docs/media/icones/formas.svg" width="22" height="22" align="top" alt=""> Arraste formas e monte sua peça

Caixa, cilindro, esfera, cone, estrela, coração, texto… Arraste da biblioteca para a mesa, uma em
cima da outra, e ajuste **em milímetros**: clique no número da medida e digite. Qualquer forma pode
virar **furo** — ao agrupar, o furo recorta o que estiver em volta.

<p align="center">
  <img src="docs/media/arrastar.gif" width="720" alt="Uma caixa e um cilindro arrastados da biblioteca; o cilindro encaixa em cima da caixa e a altura é digitada: 35 mm">
</p>

## <img src="docs/media/icones/desenhar.svg" width="22" height="22" align="top" alt=""> Desenhe com o mouse e vire 3D

Aperte **B**, desenhe o contorno na mesa (à mão livre ou clicando ponto a ponto) e ele vira uma peça.
Puxe a alça de cima para dar altura. Bom para plaquinhas, cortadores de biscoito e enfeites.

<p align="center">
  <img src="docs/media/desenhar.gif" width="440" alt="Um coração desenhado à mão livre vira peça e ganha altura puxando a alça de cima">
</p>

## <img src="docs/media/icones/cruzeiro.svg" width="22" height="22" align="top" alt=""> Peça certinha em cima da outra, e régua de verdade

Com o **Cruzeiro** (tecla **C**), a peça desliza pela superfície das outras e gruda alinhada à face,
até em bola e em parede inclinada — sem ficar flutuando nem afundada. A **régua** (tecla **R**) mede
de ponto a ponto, grudando em cantos, meios de aresta e centros de furo.

<p align="center">
  <img src="docs/media/cruzeiro-medir.gif" width="760" alt="À esquerda, o nariz de cenoura desliza pelo boneco de neve até o rosto; à direita, a régua mede 47,2 mm entre os centros de dois furos sextavados">
</p>

## <img src="docs/media/icones/ia.svg" width="22" height="22" align="top" alt=""> Peça para a IA

Escreva o que quer ("faça um suporte de celular com furo para o cabo") no seu agente de IA e ele
monta a peça no Forgia aberto, em milímetros, como um passo só — um **Ctrl+Z** desfaz tudo. Quer
mexer só num pedaço? **Marcar parte** (tecla **N**): clique na parte, escreva o pedido e cole no
agente. Ele sabe exatamente qual parte, o ponto e a face.

<p align="center">
  <img src="docs/media/marcar.gif" width="440" alt="Um alfinete numerado na aba da tampa de uma caixa e o pedido 'aumenta a aba em 1 mm' escrito no mini-chat">
</p>

## <img src="docs/media/icones/encaixe.svg" width="22" height="22" align="top" alt=""> Encaixes com folga, prontos para imprimir

Selecione uma peça e clique em **Criar encaixe**: o Forgia faz ao lado um bloco com o negativo dela,
aberto em cima, com a folga que você escolher (0,25 mm por padrão) — para imprimir um suporte, um
soquete ou uma tampa que entra sem apertar.

<p align="center">
  <img src="docs/media/encaixe.gif" width="440" alt="O suporte de celular selecionado, o diálogo Criar encaixe com folga de 0,25 mm e o bloco de encaixe criado ao lado">
</p>

## <img src="docs/media/icones/impressora.svg" width="22" height="22" align="top" alt=""> Do Forgia para a impressora

**Exportar** gera o `.STL` (o formato que todo fatiador abre) ou o `.3MF` com **as cores e as peças
separadas** — no Bambu Studio, cada cor vira um grupo para o AMS. Depois é abrir no seu fatiador
(Bambu Studio, OrcaSlicer, PrusaSlicer, Cura) e imprimir.

<p align="center">
  <img src="docs/media/exportar.gif" width="720" alt="O foguete colorido e o diálogo Exportar com as opções STL, OBJ, GLB e 3MF com cores e peças separadas">
</p>

---

## <img src="docs/media/icones/mais.svg" width="22" height="22" align="top" alt=""> E tem mais

| | |
| --- | --- |
| <img src="docs/media/icones/temas.svg" width="18" height="18" align="top" alt=""> **Tema claro e escuro** | Segue o Windows, ou escolha no botão de sol e lua. |
| <img src="docs/media/icones/dica.svg" width="18" height="18" align="top" alt=""> **Dicas com vídeo** | Pare o mouse num botão e veja, num vídeo curto, o que ele faz. |
| <img src="docs/media/icones/porca.svg" width="18" height="18" align="top" alt=""> **Porcas, parafusos e furos prontos** | De M2 a M8, com rosca real ou lisa, furo para parafuso (com bolsão de porca) e furo para inserto. |
| <img src="docs/media/icones/engrenagem.svg" width="18" height="18" align="top" alt=""> **Geradores** | Engrenagem, grade, mola, dobradiça, texto curvo e caixa com tampa, por parâmetros. |
| <img src="docs/media/icones/biblioteca.svg" width="18" height="18" align="top" alt=""> **Iniciantes e Suas criações** | Peças prontas para começar e as suas, guardadas para reusar. |
| <img src="docs/media/icones/plano.svg" width="18" height="18" align="top" alt=""> **Plano de trabalho** | Transforme a face de uma peça no chão, até inclinada, e monte em cima dela. |
| <img src="docs/media/icones/arquivo.svg" width="18" height="18" align="top" alt=""> **Projeto em arquivo** | Salve em `.forgia` (Ctrl+S), com cópia de segurança automática. |
| <img src="docs/media/icones/desfazer.svg" width="18" height="18" align="top" alt=""> **Desfazer** | Ctrl+Z e Ctrl+Y em tudo, inclusive no que a IA fez. |
| <img src="docs/media/icones/lista.svg" width="18" height="18" align="top" alt=""> **Lista de objetos** | Todas as peças e partes, com olho para esconder e cadeado para travar. |
| <img src="docs/media/icones/offline.svg" width="18" height="18" align="top" alt=""> **Sem conta e offline** | Seus projetos ficam no seu computador; nada vai para a nuvem. |

---

## <img src="docs/media/icones/comecar.svg" width="22" height="22" align="top" alt=""> Comece em 1 minuto

1. **Baixe** o `Forgia-Setup-0.1.0.exe` na página de [Releases](../../releases).
2. **Abra o instalador.** Como ele ainda não é assinado digitalmente, o Windows pode mostrar o aviso
   azul **“O Windows protegeu o computador”**. Clique em **Mais informações** e depois em
   **Executar assim mesmo**:

   <p align="center"><img src="docs/media/smartscreen.svg" width="640" alt="Ilustração do aviso do SmartScreen: passo 1, Mais informações; passo 2, Executar assim mesmo"></p>

3. **Arraste uma forma** da biblioteca (à direita) para a mesa e mude a medida clicando no número.
4. **Exporte**: botão **Exportar → .STL** (ou **.3MF**, para manter as cores).
5. **Abra no seu fatiador** — Bambu Studio, OrcaSlicer, PrusaSlicer ou Cura — e mande imprimir.

## <img src="docs/media/icones/conectar.svg" width="22" height="22" align="top" alt=""> Conectar com a IA

Você não precisa saber nada de programação. Clique em **Conectar IA** (na barra de baixo), escolha o
seu agente — **Agent Code, Claude Code, Codex, Cursor** ou outro — e cole o texto que o Forgia gera na
conversa com ele. O agente faz a instalação sozinho. Daí em diante, é só pedir: ele cria e altera
peças no Forgia aberto, e tudo o que ele faz aparece na tela e pode ser desfeito. O Forgia não cobra
nada e não usa chave de IA: quem conversa é o agente que você já usa, no seu computador.

<p align="center">
  <img src="docs/media/conectar.gif" width="720" alt="O diálogo Conectar IA com a escolha do agente e o botão Copiar; o texto aparece borrado">
</p>

<p align="center"><sub>Na gravação, o texto aparece borrado porque mostra os caminhos de pastas deste computador.</sub></p>

## <img src="docs/media/icones/perguntas.svg" width="22" height="22" align="top" alt=""> Perguntas de quem está começando

<details>
<summary><b>O que é STL?</b></summary>

É o arquivo com o formato da peça: só a superfície, feita de triângulos, sem cor. Todo programa de
impressão 3D abre. O **3MF** é a versão moderna: guarda também as cores e as peças separadas.

</details>

<details>
<summary><b>O que é fatiador?</b></summary>

É o programa que transforma a peça em camadas e caminhos do bico da impressora (o arquivo que a
impressora entende). O Forgia **desenha** a peça; o fatiador (Bambu Studio, OrcaSlicer, PrusaSlicer,
Cura) **prepara a impressão**: suportes, preenchimento, temperatura.

</details>

<details>
<summary><b>Que folga usar num encaixe?</b></summary>

Para uma peça entrar na outra numa impressora de filamento comum, **0,2 a 0,3 mm de cada lado**
costuma funcionar — o Forgia usa **0,25 mm** por padrão. Encaixe apertado (que precisa de força):
0,1 a 0,15 mm. Encaixe bem solto: 0,4 mm ou mais. Na dúvida, imprima um teste pequeno antes.

</details>

<details>
<summary><b>Por que a peça precisa estar apoiada na mesa?</b></summary>

A impressora constrói de baixo para cima, camada sobre camada. O que fica flutuando no ar não tem onde
se apoiar e vira fio solto. Deixe a face maior encostada na mesa: selecione a peça e aperte
**Shift+D** (Soltar na mesa). Partes muito inclinadas ou em balanço podem precisar de suporte no
fatiador.

</details>

---

## <img src="docs/media/icones/devs.svg" width="22" height="22" align="top" alt=""> Para devs

Electron 33 + JavaScript puro (módulos ES, sem framework de interface), [three.js](https://threejs.org)
para o 3D, [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) para os furos e Vite para o
build. A IA fala com o Forgia por um servidor MCP escrito à mão, que roda pelo próprio `Forgia.exe`.

```bash
npm install
npm run dev          # desenvolvimento no navegador, com recarga automática
npm run dist:win     # instalador do Windows em release/
npm run gravar-dicas # regrava os vídeos das dicas a partir dos roteiros
```

- [docs/arquitetura.md](docs/arquitetura.md) — como o código está organizado.
- [docs/build.md](docs/build.md) — build, instalador e como regravar as dicas e as mídias deste README.
- [docs/guia-de-uso.md](docs/guia-de-uso.md) — todas as ferramentas e atalhos.
- Testes: `node --test tests/*.test.mjs` e `npm run test:branding`; os do programa gerado, com
  `FORGIA_EXE=release\…\win-unpacked\Forgia.exe` (lista em [docs/arquitetura.md](docs/arquitetura.md#testes)).

Ícones da interface: [Lucide](https://lucide.dev) (licença ISC; aviso em [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES)).

---

<p align="center">
  <a href="https://larchertech.com/"><img src="public/branding/larchertech-lb.png" width="28" height="26" alt="LarcherTech"></a><br>
  <sub>Feito no Rio de Janeiro por um carioca · © <a href="https://larchertech.com/">LarcherTech</a> · <a href="LICENSE">MIT</a></sub>
</p>
