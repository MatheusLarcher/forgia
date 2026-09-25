# Guia de uso

Este guia mostra o fluxo completo: da primeira forma na mesa até o arquivo pronto para o fatiador.

## A tela

| Área | Para que serve |
|---|---|
| **Barra superior** | Novo projeto, nome do projeto, **Importar**, **Exportar** e **Atalhos** |
| **Barra de ferramentas** | Copiar, colar, duplicar, excluir, desfazer/refazer, mostrar tudo, agrupar, desagrupar, alinhar e espelhar |
| **Mesa (plano de trabalho)** | Onde o projeto é montado. Tem o tamanho da mesa da sua impressora |
| **Cubo de navegação** (canto superior esquerdo) | Clique numa face, aresta ou vértice para girar a vista até ela |
| **Biblioteca** (direita) | Formas prontas, em duas categorias: *Formas básicas* e *Letras e números* |
| **Inspetor** | Aparece ao selecionar algo: cor, sólido/furo e os parâmetros da forma |
| **Canto inferior direito** | Configurações, tamanho da mesa e ajuste de grade |

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

As duas primeiras formas da biblioteca, *Caixa (furo)* e *Cilindro (furo)*, já entram como furo.

> Furos soltos não são exportados. Para recortar, agrupe o furo com pelo menos um sólido.

O resultado de um grupo é calculado como **união dos sólidos menos a união dos furos**, gerando
uma malha fechada — o que o fatiador precisa para imprimir sem erro.

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
| F | Ajustar a vista à tela |
| W / A / S / D | Andar com a vista |
| Ctrl+L / Ctrl+H | Bloquear / ocultar |
| Ctrl+Shift+H | Mostrar tudo |
| Delete | Excluir |

A lista também fica no botão **Atalhos** dentro do app.

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

O projeto é salvo **automaticamente no próprio computador** a cada alteração (armazenamento local do
navegador ou do programa) e volta ao abrir de novo. Nada é enviado para a internet.

- Modelos importados muito grandes podem não caber nesse armazenamento; o app avisa quando isso
  acontece. Nesse caso, exporte o projeto antes de fechar.
- O projeto salvo no navegador e o do programa instalado são independentes.

## Dicas para impressão

- **Apoie a peça na mesa**: use `Shift+D` para soltar a forma no plano antes de exportar.
- **Paredes finas**: evite espessuras menores que ~0,8 mm (duas linhas de um bico de 0,4 mm).
- **Folgas de encaixe**: para peças que se encaixam, deixe de 0,2 a 0,3 mm de folga.
- **Balanços**: inclinações acima de ~45° sem apoio costumam precisar de suporte.
- **Texto**: letras com menos de ~1 mm de relevo ou traço ficam pouco legíveis.
