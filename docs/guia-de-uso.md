# Guia de uso

Este guia mostra o fluxo completo: da primeira forma na mesa até o arquivo pronto para o fatiador.

## A tela

| Área | Para que serve |
|---|---|
| **Barra superior** | Novo projeto, nome do projeto, **Importar**, **Exportar**, **Atalhos** e o botão **sol/lua** do tema |
| **Barra de ferramentas** | Copiar, colar, duplicar, excluir, desfazer/refazer, mostrar tudo, agrupar, desagrupar, alinhar, espelhar e as ferramentas **Desenhar**, **Cruzeiro**, **Medir** e **Marcar parte** |
| **Mesa (plano de trabalho)** | Onde o projeto é montado. Tem o tamanho da mesa da sua impressora |
| **Cubo de navegação** (canto superior esquerdo) | Clique numa face, aresta ou vértice para girar a vista até ela |
| **Biblioteca** (direita) | Formas prontas, em duas categorias: *Formas básicas* e *Letras e números* |
| **Inspetor** | Aparece ao selecionar algo: cor, sólido/furo e os parâmetros da forma |
| **Canto inferior direito** | Configurações (aparência, IA e plano de trabalho), tamanho da mesa e ajuste de grade |
| **Barra de status** (rodapé) | X, Y e Z do centro da seleção e as medidas dela, o estado da IA e o botão **Conectar IA** |

## Dicas nos botões

Pare o mouse sobre um botão da barra de ferramentas, sobre os botões redondos abaixo do cubo de
navegação ou sobre os botões de ícone da barra superior e do inspetor: depois de um instante
aparece um cartão com o nome da ação, o atalho de teclado e uma explicação curta. Funciona até
com o botão desabilitado, para você saber o que ele faz antes de poder usá-lo. O cartão fecha
quando o mouse sai, no **X** ou com `Esc`.

## Tema claro e escuro

O botão **sol/lua**, na ponta direita da barra superior, troca o tema: no tema claro ele mostra a
lua (passa para o escuro); no escuro, o sol (passa para o claro). A mesma escolha fica em
**Configurações > Aparência**, nos botões *Claro* e *Escuro*, e vale na hora.

Na primeira vez que o Forgia abre, ele segue o tema do Windows (e acompanha se o Windows mudar).
Depois que você escolhe, vale a sua escolha, que fica salva. A troca muda só as cores da tela e
da mesa: as peças mantêm as cores que você deu, e nada do projeto é recalculado.

## Fluxo básico

1. **Escolha a mesa da sua impressora** no seletor *Área* (ou em *Configurações*, onde também dá para
   digitar largura, comprimento e altura em mm).
2. **Arraste formas** da biblioteca para a mesa.
3. **Ajuste as medidas** pelas alças ou digitando o valor direto (clique na cota que aparece
   durante a edição).
4. **Combine as formas**: posicione umas sobre as outras e agrupe com `Ctrl+G`.
5. **Recorte com furos**: marque uma forma como **Furo** no inspetor (ou `H`) e agrupe com o sólido.
   O furo é subtraído do sólido.
6. **Exporte** em *Exportar* → `.STL` e abra no fatiador.

## Sólidos e furos

Toda forma é um **sólido** ou um **furo**:

- **Sólido** — vira material na peça impressa.
- **Furo** — aparece translúcido com listras; ao agrupar, ele **remove** material dos sólidos do grupo.

Para ter um furo, arraste a forma da biblioteca (uma *Caixa* ou um *Cilindro*, por exemplo) e
aperte `H` ou clique em **Furo** no inspetor. `Shift+S` volta a forma para sólido.

> Furos soltos não são exportados. Para recortar, agrupe o furo com pelo menos um sólido.

O resultado de um grupo é calculado como **união dos sólidos menos a união dos furos**, gerando
uma malha fechada — o que o fatiador precisa para imprimir sem erro.

## Desenhar uma forma

O botão **Desenhar** (lápis, na barra de ferramentas) ou a tecla `B` transforma um contorno
feito com o mouse numa peça.

1. Ao entrar no modo, a vista vai sozinha para o **topo, em vista ortográfica** (sem
   perspectiva, o traço sai sem distorção). Dá para aproximar e mover a vista; o giro fica
   desligado enquanto você desenha.
2. **Arraste** para desenhar à mão livre, ou **clique** para pôr pontos retos. Os cliques grudam
   na grade (*Ajustar grade*); a mão livre não. Dá para misturar: clique alguns pontos e arraste
   um trecho curvo.
3. **Feche** com `Enter` ou clicando de novo no primeiro ponto. Um traço à mão livre começado do
   zero fecha sozinho quando você solta o botão, ligando o fim ao começo.
4. O traço é limpo (menos pontos, sem tremida) e vira uma peça de **2 mm de altura**, já
   selecionada. Puxe o quadrado branco de cima para dar a altura que quiser.

`Esc` cancela o desenho. Ao sair do modo, a vista volta exatamente para onde estava.

O contorno não pode se cruzar: se ele se cruzar, ou tiver menos de 3 pontos, ou não tiver área,
o Forgia avisa e não cria a peça. O desenho é uma forma como as outras: salva no projeto, desfaz
com um `Ctrl+Z`, vira furo com `H`, recorta dentro de um grupo e sai no `.STL`. Para um furo
dentro do desenho (como o miolo de um "O"), desenhe o miolo à parte, marque como furo e agrupe.

## Cruzeiro: deslizar uma peça pela superfície de outra

Para pôr uma peça em cima, do lado ou numa face inclinada de outra, selecione a peça e clique em
**Cruzeiro** (ímã, na barra de ferramentas) ou aperte `C`. Aparece uma **bolinha verde** na base
da peça.

- **Arraste pela bolinha**: a peça desliza pela superfície das outras peças, inclusive faces
  laterais e inclinadas e grupos com furos. Ela gira sozinha para ficar **alinhada à face** e
  apoia a base nela. Na mesa, a posição gruda na grade.
- A face sob o cursor fica **realçada em verde**, com o contorno da peça de baixo. Numa face
  curva (esfera, lateral de cilindro), o verde marca uma área em volta do ponto.
- Segure **Shift** enquanto arrasta para **afundar** a peça na face: ela fica do lado de dentro,
  com o topo rente à superfície. É o jeito de posicionar um furo numa parede lateral ou inclinada.
- Soltar a bolinha é **um** passo de desfazer (`Ctrl+Z` volta a peça inteira para onde estava).

A peça só sobe em outra quando você usa o Cruzeiro: o arraste normal continua andando no plano, e
`Shift+D` continua soltando na mesa. `Esc`, `C` ou o botão de novo saem do modo.

Uma **forma nova arrastada da biblioteca** também segue qualquer face sob o cursor, alinhada a
ela, com o mesmo realce verde.

## Medir: a régua

O botão **Medir** (régua, na barra de ferramentas) ou a tecla `R` ligam a régua.

1. **Clique no ponto inicial** e depois **no ponto final**. Cada ponto gruda no que estiver perto
   do cursor: **vértice**, **meio de aresta**, **centro de face circular** (tampa de cilindro,
   tubo e cone, centro de esfera; vale também para o centro de um furo dentro de um grupo),
   **face** ou **grade** da mesa. Um marcador e uma etiqueta mostram onde o ponto vai grudar.
2. Entre os pontos aparece uma **linha tracejada** com a **distância total em mm** e, abaixo, as
   **diferenças em X, Y e Z**.
3. **Clique no valor da distância** e digite outro: a **peça do ponto final anda ao longo da
   linha** até ficar exatamente naquela distância. É **um** passo de desfazer. Se o ponto final
   estiver na mesa, só o ponto anda.
4. Os pontos podem ser **arrastados** depois de colocados. Clicar em outro lugar começa uma
   medida nova.

A régua não é salva no projeto nem entra no desfazer (só o movimento da peça entra). `Esc`, `R`
ou o botão de novo encerram a régua.

**X, Y e Z no Forgia**: medidas em mm, **Z para cima**, **X para a direita**, **Y para o fundo da
mesa**, com a origem no **centro da mesa**. É o mesmo sistema do `.STL` exportado (o fatiador só
recentraliza a peça).

## Marcar parte: pedir à IA uma mudança só "aqui"

O botão **Marcar parte** (alfinete, na barra de ferramentas) ou a tecla `N` servem para mostrar
à IA exatamente a parte que você quer mudar.

1. Passe o mouse sobre a peça: o contorno laranja mostra a **parte** que vai ser marcada. Numa
   peça agrupada, é a forma de dentro (a aba, o pino), não a peça inteira; na parede de um furo, é
   o furo.
2. **Clique** no ponto: aparece um **alfinete numerado** (1, 2, 3…) e, ao lado, um mini-chat com
   o texto de referência, como "Marcação 1: Caixa 'aba' (parte de 'suporte'), ponto (12; −4; 30) mm,
   face virada para +X".
3. Escreva o que mudar ("aumenta essa aba em 2 mm") e aperte **Enter** (ou **Copiar**). O pedido
   completo vai para a área de transferência junto com uma **imagem da vista com os alfinetes**,
   e aparece "Copiado. Cole no seu agente". Cole na conversa do seu agente de IA: ele lê a
   marcação no Forgia e altera só aquela parte.

`Shift+Enter` quebra a linha no mini-chat e `Esc` fecha o mini-chat (outro `Esc` sai da
ferramenta). Clique num alfinete para abrir o mini-chat dele de novo. As marcações não entram no
projeto nem no desfazer: ficam na vista até você clicar em **Limpar marcações** (no mini-chat ou
na barra de status) ou até a IA limpá-las, e somem sozinhas se a parte marcada for excluída.

## Barra de status

No rodapé da janela, com uma peça selecionada, aparecem o **X, Y e Z do centro** dela e as
**medidas** (X × Y × Z, em mm), no mesmo sistema da régua e do `.STL`: Z para cima, X para a
direita, Y para o fundo, origem no centro da mesa. Com várias peças, valem o centro e o tamanho da
caixa que envolve todas. São os mesmos números que a IA lê do Forgia: "sobe 5 mm no Z" quer dizer
a mesma coisa para você e para ela.

## IA no Forgia

Um agente de IA que roda no seu computador (Agent Code, Claude Code, Codex, Cursor…) pode criar e
alterar as peças do Forgia aberto. Não há conta, chave nem custo dentro do Forgia: a conversa
acontece no agente, e o Forgia só recebe os comandos por uma **ponte local**, que não aceita
pedidos da rede nem de páginas abertas no navegador.

- **Conectar**: clique em **Conectar IA** (na barra de status ou em *Configurações > IA*),
  escolha o seu agente (*Agent Code / Claude Code*, *Codex*, *Cursor* ou *Outro*), clique em
  **Copiar** e cole o texto numa conversa com ele. O agente instala o servidor do Forgia (que roda
  pelo próprio Forgia, sem instalar mais nada) e libera as ferramentas dele, para não pedir
  permissão a cada comando; ele vai pedir licença para mudar a configuração dele, o que é
  esperado. Depois, numa conversa nova, peça por exemplo "faça um cubo de 20 mm". Ao atualizar o
  Forgia, faça de novo: o texto sai com os caminhos da versão nova.
- **Manual da IA**: vem dentro do Forgia. O agente lê sozinho, antes de modelar, como o Forgia
  mede as formas, como montar a peça num passo só e as regras de impressão (paredes, folgas,
  furos para parafuso).
- **Indicador** na barra de status: *IA conectada* (um agente usou o Forgia há pouco), *IA pronta*
  (esperando), *IA desligada* ou *IA indisponível*.
- **O que a IA fez**: a cada pedido aparece um aviso no canto da vista, como "IA: criou 2,
  alterou 1 · Desfazer", e as peças mexidas piscam o contorno. Tudo o que a IA faz num pedido é
  **um** passo de desfazer: um `Ctrl+Z` (ou o *Desfazer* do aviso) volta tudo. A sua seleção não
  muda, a não ser que a IA peça para selecionar.
- **Enquanto você arrasta** uma peça ou coloca uma forma, a IA espera: o pedido dela volta como
  "ocupado" e nada muda.
- **Configurações > IA**: *Permitir IA* desliga a ponte (a IA passa a receber "IA desligada");
  *Permitir código livre da IA* desliga o recurso que a IA só deve usar quando nenhum comando
  pronto resolve (código JavaScript, que roda isolado, sem acesso ao disco nem à internet, e é
  interrompido depois de 10 s).

## Manipulando formas

| Alça | Ação |
|---|---|
| Quadrados brancos nos cantos | Redimensiona em 2 eixos |
| Quadrados pretos nas arestas | Redimensiona em 1 eixo |
| Quadrado branco no topo | Altura |
| Cone preto | Eleva a forma (tira da mesa) |
| Setas curvas | Gira (com transferidor) |

- Segure **Shift** nas alças para manter a proporção ou girar de 45° em 45°.
- Segure **Alt** nas alças para redimensionar a partir do centro.
- **Alt + arrastar** uma forma cria uma cópia.
- O **ajuste de grade** (0,1 mm a 10 mm) define o passo de movimento e de medida.

## Atalhos

| Atalho | Ação |
|---|---|
| Arrastar forma da biblioteca | Criar forma na mesa |
| Clique / Shift+clique | Selecionar / somar à seleção |
| Arrastar no vazio | Seleção por área |
| Botão direito + arrastar | Girar a vista |
| Botão do meio / Shift+direito | Mover a vista |
| Roda do mouse | Zoom |
| Setas / Shift+setas | Mover na grade (passo ×10 com Shift) |
| Ctrl + ↑ / ↓ | Subir / descer |
| Ctrl+C / Ctrl+V / Ctrl+D | Copiar / colar / duplicar e repetir |
| Ctrl+Z / Ctrl+Y | Desfazer / refazer |
| Ctrl+G / Ctrl+Shift+G | Agrupar / desagrupar |
| H / Shift+S | Transformar em furo / sólido |
| Shift+D | Soltar na mesa |
| L / M | Alinhar / espelhar |
| B | Desenhar na mesa (`Enter` fecha, `Esc` cancela) |
| C | Cruzeiro: deslizar a peça pela superfície das outras (`Shift` afunda) |
| R | Medir: distância e X/Y/Z entre dois pontos (clique no valor para mover a peça) |
| N | Marcar parte: alfinete num ponto e pedido só daquela parte para a IA (`Enter` copia) |
| F | Ajustar a vista à tela |
| W / A / S / D | Andar com a vista |
| Ctrl+L / Ctrl+H | Bloquear / ocultar |
| Ctrl+Shift+H | Mostrar tudo |
| Delete | Excluir |

A lista também fica no botão **Atalhos** dentro do app. No fim desse diálogo aparecem a placa de
vídeo em uso e o bloco *Sobre o Forgia* (versão, licença e crédito).

## Importar e exportar

**Importar**: botão *Importar* ou arraste o arquivo para a tela.
Formatos: `.STL`, `.OBJ` e `.3MF` — incluindo projetos salvos pelo Bambu Studio e OrcaSlicer.

**Exportar**: botão *Exportar*, escolhendo *Tudo no design* ou *Formas selecionadas*.

| Formato | Quando usar |
|---|---|
| `.STL` | Padrão para fatiadores. Exportado em binário, com Z para cima e medidas em mm |
| `.OBJ` | Outros programas 3D |
| `.GLB` | Visualizadores e web (Y para cima, como o formato exige) |

## Onde o projeto fica salvo

O projeto é salvo **automaticamente no próprio computador** a cada alteração e volta quando você
abre o Forgia de novo. Ele fica na pasta de dados do Forgia no seu usuário do Windows
(`%APPDATA%\Forgia`). Nada é enviado para a internet.

- Existe um projeto salvo por vez: **Novo projeto** começa do zero e apaga o atual deste
  computador. Para não perder uma peça, exporte-a antes.
- Modelos importados muito grandes podem não caber nesse armazenamento; o app avisa quando isso
  acontece. Nesse caso, exporte o projeto antes de fechar.

## Dicas para impressão

- **Apoie a peça na mesa**: use `Shift+D` para soltar a forma no plano antes de exportar.
- **Paredes finas**: evite espessuras menores que ~0,8 mm (duas linhas de um bico de 0,4 mm).
- **Folgas de encaixe**: para peças que se encaixam, deixe de 0,2 a 0,3 mm de folga.
- **Balanços**: inclinações acima de ~45° sem apoio costumam precisar de suporte.
- **Texto**: letras com menos de ~1 mm de relevo ou traço ficam pouco legíveis.
