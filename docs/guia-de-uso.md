# Guia de uso

Este guia mostra o fluxo completo: da primeira forma na mesa até o arquivo pronto para o fatiador.

## A tela

| Área | Para que serve |
|---|---|
| **Barra superior** | Novo projeto, nome do projeto (e, ao lado, o arquivo `.forgia` com "•" se houver alteração não salva), **Arquivo** (abrir, salvar, recentes), **Importar**, **Exportar**, **Atalhos** e o botão **sol/lua** do tema |
| **Barra de ferramentas** | Copiar, colar, duplicar, excluir, desfazer/refazer, mostrar tudo, agrupar, desagrupar, alinhar, espelhar, **Criar encaixe** e as ferramentas **Desenhar**, **Cruzeiro**, **Medir**, **Marcar parte** e **Plano de trabalho** |
| **Mesa (plano de trabalho)** | Onde o projeto é montado. Tem o tamanho da mesa da sua impressora |
| **Cubo de navegação** (canto superior esquerdo) | Clique numa face, aresta ou vértice para girar a vista até ela |
| **Painel lateral** (direita) | Duas abas: **Biblioteca** (formas prontas para arrastar) e **Objetos** (a lista de tudo o que está no projeto) |
| **Inspetor** | Aparece ao selecionar algo: cor, sólido/furo e os parâmetros da forma |
| **Canto inferior direito** | Configurações (aparência, IA e plano de trabalho), tamanho da mesa e ajuste de grade |
| **Barra de status** (rodapé) | X, Y e Z do centro da seleção e as medidas dela, o estado da IA, o botão **Conectar IA** e, na ponta direita, o crédito da LarcherTech |

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

## Biblioteca

No topo da aba **Biblioteca** fica o seletor de categoria (com o ícone de cada uma, desenhado pelo
próprio Forgia). Clique nele e escolha:

| Categoria | O que tem |
|---|---|
| **Suas criações** | Peças suas, salvas para usar de novo em qualquer projeto |
| **Favoritos** | As formas que você marcou com a estrela, de todas as categorias |
| **Formas básicas** | Caixa, cilindro, esfera, telhado, cone, texto, cunha, pirâmide e as demais |
| **Letras e números** | A–Z e 0–9, prontos para arrastar |
| **Iniciantes do projeto** | Projetos prontos para abrir e mudar: chaveiro com nome, suporte de celular, caixa com tampa, boneco de neve e foguete |
| **Hardware** | Porca sextavada, parafuso, furo para parafuso e porca, furo para inserto a quente |
| **Geradores de forma** | Engrenagem, grade (colmeia ou quadrada), mola, dobradiça, texto curvo e caixa com tampa |

A caixa **Pesquisar** filtra a categoria aberta pelo nome.

- **Favoritos**: pare o mouse sobre uma forma e clique na **estrela** do canto. Ela passa a
  aparecer também em *Favoritos*; clique de novo para tirar. A escolha fica salva.
- **Suas criações**: selecione uma peça (ou várias) e, na categoria *Suas criações*, clique em
  **Salvar seleção como criação** e dê um nome. A seleção vira uma forma da biblioteca, guardada
  neste computador (várias peças vão juntas, num grupo). Arraste para usar; o **lápis** do bloco
  renomeia e a **lixeira** exclui (as peças já usadas nos projetos continuam lá).
- **Iniciantes**: arraste para a mesa. Cada um chega como um grupo: desagrupe (`Ctrl+Shift+G`)
  ou abra na aba **Objetos** para mudar as partes, o texto do chaveiro, as cores.

### Hardware

As medidas seguem a rosca métrica (M2 a M8, na lista **Medida (M)** do inspetor); trocar a medida
refaz a peça no tamanho certo. **Rosca** *Real* modela os filetes; *Lisa* deixa o furo ou o corpo
liso (para parafuso autoatarraxante). **Folga** abre a rosca por peça (0 = a folga automática,
que já deixa porca e parafuso do Forgia rosquearem entre si).

- **Porca** e **parafuso** do mesmo M encaixam; a porca casa com a rosca do parafuso quando a base
  dela fica numa altura múltipla do passo (M3: 0,5 mm) acima da base do parafuso.
- **Furo para parafuso e porca** e **Furo para inserto a quente** nascem como **furo**: posicione
  na peça e agrupe. O primeiro traz o rebaixo da cabeça (cilíndrica, sextavada ou sem rebaixo) e,
  se quiser, o bolsão da porca.
- Rosca real abaixo de M4 imprime mal em FDM: o inspetor avisa (em destaque) e sugere inserto a
  quente ou rosca lisa.

### Geradores de forma

Cada gerador tem os seus parâmetros no inspetor; as medidas da peça acompanham os parâmetros.

- **Engrenagem**: duas engrenagens do mesmo **módulo** engrenam com os centros a
  m × (z1 + z2) / 2 (m 1,5 com 20 e 12 dentes: 24 mm). Se a segunda tiver número par de dentes,
  gire-a meio dente (180° / z2) em Z para o dente entrar no vão.
- **Grade**: placa com colmeia ou quadrados, para tampas, ventilação e bases leves.
- **Mola**: imprima em pé, com suporte; fio de pelo menos 1,2 mm.
- **Dobradiça**: sai montada, deitada na mesa; folga de pelo menos 0,4 mm.
- **Texto curvo**: o texto num arco; o raio abre o arco e o ângulo espalha as letras.
- **Caixa com tampa**: caixa e tampa lado a lado, prontas para imprimir; a aba da tampa entra na
  caixa com a folga por lado. Em **Peças** dá para gerar só a caixa ou só a tampa.

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

## Plano de trabalho: uma face vira o chão

O botão **Plano de trabalho** (grade, na ponta da barra de ferramentas) ou a tecla `P` servem para
trabalhar sobre uma face de uma peça, até uma face inclinada, como se ela fosse a mesa.

1. Aperte `P` e **clique na face**: ela ganha uma grade laranja, com a origem no ponto clicado e
   os eixos alinhados à aresta da face mais perto do clique. A barra de status mostra
   **Plano de trabalho**.
2. Enquanto o plano está ativo:
   - uma **forma nova** arrastada da biblioteca nasce **alinhada ao plano**, apoiada nele e na grade
     dele;
   - **arrastar** uma peça anda paralelo ao plano, na grade dele; as **setas** andam nos eixos do
     plano e `Ctrl+↑`/`Ctrl+↓` sobem e descem pela normal;
   - o **cone de elevar** sobe pela normal do plano, `Shift+D` solta a peça no plano, e a **cota de
     elevação** mede a altura sobre ele; com várias peças, as **alças** seguem o plano;
   - o **X, Y e Z** da barra de status passam a ser **relativos ao plano** (Z = altura sobre ele). As
     medidas das peças continuam as delas.
3. `P` de novo (ou o botão) **volta para a mesa**. Clicar na mesa durante a escolha também volta.

O plano é **temporário**: não fica salvo no projeto, e o Forgia sempre abre na mesa. `Esc` cancela
a escolha da face.

## Criar encaixe: o negativo de uma peça

Para imprimir um soquete, um suporte ou uma caixinha onde uma peça entra, selecione a peça e
clique em **Criar encaixe** (quebra-cabeça, na barra de ferramentas). No diálogo, escolha a
**folga** (0 a 1 mm; o padrão, 0,25 mm, costuma entrar sem apertar) e a **parede do bloco** (padrão
3 mm) e clique em *Criar encaixe*.

- Ao lado da peça aparece um **grupo** com um bloco e, dentro dele, uma cópia da peça como **furo**,
  já com a folga. O bloco é **aberto em cima** (a peça entra por cima) e fica apoiado na mesa.
- É um grupo como os outros: dá para desagrupar, mudar a parede, a cor ou a cópia. Um `Ctrl+Z`
  desfaz tudo. A folga e a parede escolhidas ficam para a próxima vez.
- A folga é **exata** em caixa (inclusive arredondada), cilindro, polígono, esfera, cone,
  pirâmide, cunha, telhado, tubo e toroide: cada face da cópia fica afastada da folga pedida. Em
  grupos, as partes sólidas crescem e os furos encolhem.
- Em **malha importada**, contorno (desenho, estrela, coração), texto e formas curvas sem conta
  exata, a cópia cresce a folga em cada eixo e o Forgia avisa **"folga aproximada"**: confira com
  **Medir**.

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
caixa que envolve todas, e a barra diz quantas estão selecionadas. São os mesmos números que a IA
lê do Forgia: "sobe 5 mm no Z" quer dizer a mesma coisa para você e para ela. Na ponta direita
fica o crédito **por LarcherTech**, que abre o site no navegador.

## Lista de objetos

A aba **Objetos**, ao lado da **Biblioteca** no painel da direita, mostra tudo o que está no
projeto, com o número de peças ao lado do nome da aba. Grupos aparecem com uma setinha: clique
nela para ver as partes. Peças ocultas ficam esmaecidas e continuam na lista; o que a IA cria
aparece ali como o resto.

- **Clique** numa linha para selecionar a peça (`Shift` ou `Ctrl` somam à seleção). Numa parte de
  grupo, o clique seleciona o grupo inteiro.
- **Olho**: oculta ou mostra. Numa parte de grupo, esconde só aquela parte (e ela sai do recorte).
- **Cadeado**: bloqueia ou desbloqueia (peça bloqueada não se move, nem pela IA).
- **Duplo clique no nome**: renomeia (`Enter` confirma, `Esc` cancela).

Cada ação é um passo de desfazer (`Ctrl+Z`).

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
- **O que a IA sabe fazer**, além das formas básicas: usar o **Hardware** e os **Geradores de
  forma** da biblioteca (porca, parafuso, furo para parafuso e porca, engrenagens que engrenam,
  caixa com tampa…), **Criar encaixe** de uma peça e **exportar em 3MF** para o fatiador, num
  arquivo que você indicar. Peça, por exemplo, "faça uma engrenagem de 20 dentes encaixando
  noutra" ou "exporte em 3MF para C:\Users\voce\pecas.3mf".
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
| Ctrl+S / Ctrl+Shift+S | Salvar / salvar como (`.forgia`) |
| Ctrl+O | Abrir um projeto `.forgia` |
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
| P | Plano de trabalho: clique numa face para ela virar o chão (`P` de novo volta à mesa) |
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
| `.3MF (cores e peças separadas)` | Impressão em várias cores (AMS) no Bambu Studio ou no OrcaSlicer: cada peça do projeto vai separada e com a sua cor; os grupos já saem recortados. As cores seguem a ordem do projeto, e o fatiador liga cada cor a um filamento nessa ordem |
| `.OBJ` | Outros programas 3D |
| `.GLB` | Visualizadores e web (Y para cima, como o formato exige) |

## Salvar e abrir projetos (.forgia)

O projeto vive num arquivo **`.forgia`**, como um documento do Word. O arquivo leva tudo: as
peças, os grupos, as malhas importadas (mesmo as grandes) e uma miniatura.

- **Salvar**: `Ctrl+S` ou *Arquivo > Salvar*. Na primeira vez, o Windows pergunta onde gravar.
  **Salvar como** (`Ctrl+Shift+S`) grava uma cópia com outro nome.
- **Abrir**: `Ctrl+O`, *Arquivo > Abrir…*, um dos **Recentes** (os últimos 5, no mesmo menu) ou um
  duplo clique no arquivo `.forgia` no Explorador de Arquivos.
- O **arquivo só muda quando você salva**. Enquanto houver alteração não salva, o título da
  janela e o nome ao lado do projeto mostram um **"•"**. Ao fechar, abrir outro projeto ou começar
  um novo com alterações não salvas, o Forgia pergunta: *Salvar*, *Não salvar* ou *Cancelar*.
- **Cópia de segurança**: a cada alteração o Forgia grava sozinho uma cópia na pasta de dados dele
  (`%APPDATA%\Forgia\recuperacao`). Se o computador travar ou o Forgia fechar sem salvar, na próxima
  abertura ele pergunta: "Há alterações não salvas de *projeto* (*data e hora*). Recuperar?".
- **Projeto que nunca foi salvo** continua voltando sozinho quando você abre o Forgia, como antes
  (pela cópia de segurança). Para guardar de vez ou levar para outro computador, salve num
  `.forgia`. *Não salvar* num projeto assim não apaga nada: ele volta na próxima abertura; *Novo
  projeto* é que o descarta (depois de perguntar).
- Quem vinha de uma versão anterior do Forgia não perde nada: na primeira abertura o projeto
  antigo, com os modelos importados, vira o projeto atual.

Nada é enviado para a internet.

## Dicas para impressão

- **Apoie a peça na mesa**: use `Shift+D` para soltar a forma no plano antes de exportar.
- **Paredes finas**: evite espessuras menores que ~0,8 mm (duas linhas de um bico de 0,4 mm).
- **Folgas de encaixe**: para peças que se encaixam, deixe de 0,2 a 0,3 mm de folga.
- **Balanços**: inclinações acima de ~45° sem apoio costumam precisar de suporte.
- **Texto**: letras com menos de ~1 mm de relevo ou traço ficam pouco legíveis.
