'use strict';
// Manual da IA dentro do MCP (dec-manual-no-mcp). Três lugares:
//   1. INSTRUCTIONS, no initialize: o Claude Code corta em ~2 KB e injeta em TODA conversa, então só
//      o essencial (medido em tests/mcp-manual.test.mjs: tem que caber em 2048 bytes UTF-8);
//   2. a descrição de cada ferramenta (ferramentas.cjs);
//   3. forgia_manual: sem seção = guia rápido (o que um pedido comum precisa, numa chamada só);
//      com seção = detalhe sob demanda.
// Escrito com o método das skills de criação de skill (writing-skills, skill-creator): linha de
// base com os pedidos de teste 1–4 sem manual, falhas de FORMA (manual lido em 2 chamadas, formas
// consultadas uma a uma, texto criado fora do lote para medir) -> receitas positivas; a regra do
// código livre é de DISCIPLINA -> regra explícita + o que não justifica. Regras de impressão
// reaproveitadas da skill 3d-print-modeling (fdm-design-rules, mechanisms-and-fits).

const INSTRUCTIONS = `Forgia: editor 3D de peças para impressão 3D aberto no computador do usuário. As ferramentas forgia_* criam e alteram as peças nele (modele por elas, não por arquivo ou script).
Antes da primeira modelagem da conversa, chame forgia_manual sem seção: numa chamada vêm as medidas de cada forma e receitas prontas (dispensa forgia_formas na maioria dos pedidos).
Coordenadas: mm; Z para cima, X para a direita, Y para o fundo; origem no centro da mesa. centro = centro do objeto; medidas [X,Y,Z] nos eixos do próprio objeto (cilindro: [diâmetro, diâmetro, altura]); rotacao em graus.
Monte o pedido inteiro num só forgia_lote: vira um passo de desfazer e, se um comando falhar, nada fica. "ref" em criar/agrupar e "$ref" nos ids seguintes; posicione com base_z, sobre e alinhar_com em vez de fazer conta.
Confira pelo retorno (medidas, caixa min/max, apoiado_em), não pela imagem; forgia_captura é para mostrar o resultado no fim, uma vez.
Furo só recorta quando está no mesmo grupo que o sólido.
Se o usuário disser "aqui", "essa parte" ou "a 1": leia forgia_marcacoes e altere só a parte marcada, pelo id dela.
Código livre (forgia_executar_codigo) só em último caso, quando nenhum comando pronto resolve: posicionar, repetir e alinhar se fazem com lote, duplicar e alinhar. Antes de usar, diga ao usuário por quê.`;

// guia rápido: forgia_manual sem seção
const GUIA = `# Forgia: guia rápido para a IA

Sistema: mm; Z para cima, X direita, Y fundo; origem no centro da mesa (255×255 por padrão; forgia_estado.mesa).

## Fluxo de um pedido
1. Pense a peça inteira e escreva UM forgia_lote com todos os comandos (criar… e agrupar no fim).
2. Leia o retorno: cada objeto volta com medidas, centro, caixa {min,max} e apoiado_em. Se algo ficou errado, corrija com outro lote ou forgia_alterar pelo id.
3. No fim, se quiser mostrar, uma forgia_captura (vista iso). Não use captura para descobrir medidas.
Projeto já existente: forgia_estado (partes dos grupos com filhos:true).

## Formas (tipo: o que as medidas [X, Y, Z] são; params)
- caixa: largura, profundidade, altura. params raio (arredonda arestas, mm, 0–10)
- cilindro: [diâmetro, diâmetro, altura]. params lados (use 48–64 para furo redondo), chanfro (mm)
- tubo: [diâmetro externo, diâmetro externo, altura]. params parede (mm): furo interno = diâmetro − 2×parede
- cone: [diâmetro da base, idem, altura]. params raio_topo (mm, 0 = ponta)
- esfera, meia_esfera (cúpula para cima), toroide ([diâmetro externo, idem, espessura]; params espessura do anel)
- cunha: rampa que sobe da frente (−Y, altura 0) para o fundo (+Y, altura Z)
- telhado: prisma triangular com a cumeeira ao longo de Y; telhado_redondo: meio cilindro deitado ao longo de Y
- piramide (base quadrada), poligono (prisma de N lados: params lados), estrela (params pontas, raio_interno), coracao, icosaedro
- texto: deitado na mesa, lido de cima. params texto. medidas [comprimento, altura das letras, espessura]; com X null o comprimento sai do texto; com X definido as letras esticam para caber exatamente em X
- desenho: contorno livre extrudado. params pontos [[X,Y],…] em mm (fechado, sem repetir o 1º, sem cruzar); medidas Z = altura (padrão 2)
Limites e padrões exatos: forgia_formas (só se precisar).

## Posição (criar, alterar, importar)
Sem posição: centro da mesa, apoiado nela. centro [X,Y,Z] (null mantém o eixo); base_z = altura da base (Z mín); sobre:id = base no topo dele e X/Y no centro dele; alinhar_com:id = mesmo X/Y; mover [dX,dY,dZ] soma no fim. rotacao [X,Y,Z] graus nos eixos da mesa.
Em alterar, medidas/rotacao/params mantêm o centro X/Y e a base. esticar {lado:"+Z", mm:2} cresce um lado e deixa o oposto parado.

## Furos e grupos
Furo (furo:true) só recorta dentro de um grupo com o sólido: agrupe no mesmo lote. Faça o furo passar 1 mm além de cada face do sólido (ex.: placa de 5 mm → furo com altura 7 e base_z −1): face coincidente deixa película.
As partes mantêm o id dentro do grupo: forgia_alterar e forgia_excluir funcionam nelas (o grupo se ajusta sozinho).

## Exemplo: suporte de celular com base de 80 mm e furo de 8 mm no centro (um lote)
{"comandos":[
 {"cmd":"criar","ref":"base","tipo":"caixa","nome":"base","medidas":[80,70,5],"params":{"raio":2}},
 {"cmd":"criar","ref":"encosto","tipo":"caixa","nome":"encosto","medidas":[80,6,70],"centro":[0,22,null],"base_z":0,"rotacao":[-15,0,0]},
 {"cmd":"criar","ref":"batente","tipo":"caixa","nome":"batente","medidas":[80,6,12],"centro":[0,-26,null],"sobre":"$base"},
 {"cmd":"criar","ref":"furo","tipo":"cilindro","nome":"furo 8 mm","medidas":[8,8,7],"params":{"lados":64},"centro":[0,0,null],"base_z":-1,"furo":true},
 {"cmd":"agrupar","ids":["$base","$encosto","$batente","$furo"],"nome":"suporte de celular"}]}
Confira no retorno: grupo com caixa X de −40 a 40; o furo com medidas [8,8,7] e centro X 0, Y 0.

## Mais
Seções: receitas (chaveiro, caixa com tampa, padrão em círculo, texto gravado, peça orgânica), impressao (paredes, folgas, parafusos), coordenadas, marcacoes, codigo_livre, erros. Chame forgia_manual {"secao":"receitas"} etc.`;

const SECTIONS = {
  coordenadas: `# Coordenadas
- mm; Z para cima, X para a direita, Y para o fundo da mesa; origem no centro da mesa. É o mesmo sistema do STL exportado e da barra de status do Forgia: o usuário vê os mesmos números.
- centro = centro do objeto (da caixa das medidas, girada com ele). caixa = {min, max} do objeto no mundo, já com giro: use caixa.min[2] para a base e caixa.max[2] para o topo.
- medidas [X, Y, Z] = tamanho nos eixos do PRÓPRIO objeto, antes do giro. Uma caixa [80, 5, 40] girada 90° em Z continua com medidas [80, 5, 40]; a caixa (min/max) é que muda.
- rotacao [X, Y, Z] em graus, nos eixos fixos da mesa: gira em X, depois em Y, depois em Z (regra da mão direita). rotacao [-15, 0, 0] inclina o topo de uma placa em pé para o fundo (+Y); [90, 0, 0] deita um cilindro com o eixo ao longo de Y.
- apoiado_em: "mesa", o id do objeto logo abaixo (mesmo nível), "no_ar" ou "abaixo_da_mesa".
- Partes de grupo: centro, caixa e rotacao vêm no mundo, como os objetos soltos; "grupo" diz a qual grupo pertencem.`,

  receitas: `# Receitas (todas num lote; troque as medidas)

## Chaveiro com nome
Texto com X definido (as letras esticam para caber), base um pouco maior, argola de tubo na ponta:
{"comandos":[
 {"cmd":"criar","ref":"base","tipo":"caixa","nome":"base","medidas":[50,18,3],"params":{"raio":3}},
 {"cmd":"criar","ref":"nome","tipo":"texto","nome":"ANA","medidas":[38,11,2],"params":{"texto":"ANA"},"centro":[3,0,null],"sobre":"$base"},
 {"cmd":"criar","ref":"argola","tipo":"tubo","nome":"argola","medidas":[10,10,3],"params":{"parede":2.5,"lados":48},"centro":[-29,0,null]},
 {"cmd":"agrupar","ids":["$base","$nome","$argola"],"nome":"chaveiro ANA"}]}
A argola encosta 1 mm na base (une) e o furo dela (Ø5) fica livre. Texto gravado em vez de relevo: o mesmo texto com espessura 2, "furo":true e base_z = topo da base − 1, agrupado com a base.

## Caixa 60×40×30 com tampa e folga
Corpo oco (parede 2) e tampa com aba que entra na boca, folga 0,2 mm por lado; tampa ao lado, de cabeça para cima para imprimir:
{"comandos":[
 {"cmd":"criar","ref":"corpo","tipo":"caixa","nome":"corpo","medidas":[60,40,30],"centro":[-35,0,null]},
 {"cmd":"criar","ref":"oco","tipo":"caixa","nome":"oco","medidas":[56,36,29],"alinhar_com":"$corpo","base_z":2,"furo":true},
 {"cmd":"agrupar","ref":"caixa","ids":["$corpo","$oco"],"nome":"caixa"},
 {"cmd":"criar","ref":"tampo","tipo":"caixa","nome":"tampo","medidas":[60,40,2],"centro":[35,0,null]},
 {"cmd":"criar","ref":"aba","tipo":"caixa","nome":"aba","medidas":[55.6,35.6,4],"sobre":"$tampo"},
 {"cmd":"agrupar","ids":["$tampo","$aba"],"nome":"tampa"}]}
(56 − 2×0,2 = 55,6). Folga: 0,2 mm por lado encaixa justo; 0,3 mm solto.

## Padrão em círculo (6 pinos num raio de 20 mm)
Crie um e use duplicar com giro em torno do centro: {"cmd":"criar","ref":"p","tipo":"cilindro","medidas":[4,4,10],"centro":[20,0,null]}, {"cmd":"duplicar","ids":["$p"],"vezes":5,"giro_z":60,"centro_giro":[0,0],"ref":"pinos"}. Fileira: deslocamento [10,0,0].

## Furo passante de lado (numa parede vertical)
Cilindro deitado: rotacao [90,0,0] faz o eixo correr em Y; [0,90,0] em X. Altura do cilindro = espessura da parede + 2 mm; agrupe com a parede.

## Peça orgânica ou complexa
Gere um STL com Python (trimesh/manifold3d), salve num caminho absoluto e use forgia_importar {"caminho":"C:\\\\...\\\\peca.stl","base_z":0}. Depois ela combina com as outras formas (agrupar, furos).

## Mudar o que já existe
forgia_estado (filhos:true para ver as partes) -> forgia_alterar pelo id da parte. Não recrie a peça para mudar uma medida.`,

  impressao: `# Regras de impressão (FDM, bico 0,4 mm)
- Parede estrutural ≥ 1,2 mm (0,8 é o mínimo); fundo e tampas ≥ 1,2–2 mm. Detalhe que precisa aparecer ≥ 0,6 mm; abaixo disso o fatiador some com ele.
- Texto em relevo: letras com ≥ 5 mm de altura e ≥ 0,6 mm de relevo (1–2 mm fica bom). Gravado: ≥ 0,6 mm de profundidade.
- Folga entre peças que encaixam: 0,2 mm por lado (justo) a 0,3 mm (solto); peças que deslizam ou giram: 0,3–0,5 mm.
- Parafusos: furo de passagem = nominal + 0,4 mm (M3 → Ø3,4; M4 → Ø4,4). Porca M3: sextavado 5,5 mm entre faces + 0,2, altura 2,4 + 0,2.
- Balanço: até ~45° sem suporte. Teto plano no ar precisa de suporte; prefira chanfro ou arco.
- Tudo apoiado na mesa (apoiado_em "mesa" ou em outra parte). Caixas e copos: abertura para cima. Tampas: a face grande para baixo.
- A peça tem que caber na mesa (forgia_estado.mesa, 255×255×255 por padrão).
- Furo que corta uma peça: passe 1 mm além de cada face (evita película).`,

  marcacoes: `# Marcações (Marcar parte, tecla N)
O usuário clica num ponto da peça e escreve o pedido; o Forgia copia um texto com "Marcação 1: ..." e um bloco \`\`\`forgia-pedido\`\`\` (JSON formato forgia.pedido/1).
- Quando o pedido falar de "aqui", "essa parte", "a 1" ou trouxer esse bloco: use o que veio no bloco ou chame forgia_marcacoes. Cada marcação traz peca (o objeto da mesa), parte (id, tipo, medidas, centro, caixa, params), ponto, normal, face (para onde a face aponta no mundo) e lado_da_parte (a mesma face nos eixos da parte).
- Altere só a parte marcada, pelo id dela (forgia_alterar). Não mexa nas outras partes nem recrie o grupo.
- "Aumenta/diminui X mm" numa face marcada: forgia_alterar {"id": parte.id, "esticar": {"lado": lado_da_parte, "mm": X}} (negativo diminui). O lado oposto fica parado e o grupo se ajusta sozinho.
- "Aumenta o furo": mude as medidas do furo (parte.furo = true) mantendo o centro.
- Depois de atender, confira pelo retorno. forgia_marcacoes {"limpar": true} tira os alfinetes, se o usuário pedir.`,

  codigo_livre: `# Código livre (forgia_executar_codigo): só em último caso
Use sempre os comandos prontos. Use executar_codigo SÓ quando nenhum comando pronto resolver o pedido, e antes diga ao usuário por quê.
NÃO justificam código livre (resolva com comandos):
- posicionar e apoiar: centro, base_z, sobre, alinhar_com, mover, forgia_alinhar;
- repetir em fileira, grade ou círculo: forgia_duplicar (deslocamento, giro_z, centro_giro) dentro do lote;
- espelhar, agrupar, furar: forgia_espelhar, forgia_agrupar, furo:true;
- curva ou contorno: tipo desenho com pontos (calcule os pontos você mesmo); peça orgânica: forgia_importar de STL gerado em Python.
Justifica: dezenas de peças com posições que dependem de uma fórmula que duplicar não faz (espiral, espaçamento variável).
Como funciona: JavaScript num Worker isolado (sem disco, rede nem Node), limite de 10 s. A fachada forgia.* enfileira os mesmos comandos do lote e tudo vira UM passo de desfazer; erro ou projeto inválido não aplicam nada.
- forgia.criar({...}) devolve "$ref"; forgia.alterar(id, {...}); forgia.excluir(ids); forgia.agrupar(ids, {nome}) devolve "$ref"; forgia.duplicar(ids, {...}); forgia.alinhar(ids, eixo, onde); forgia.espelhar(ids, eixo); forgia.soltar_na_mesa(ids); forgia.selecionar(ids)
- forgia.objetos() = projeto do início do código (não vê o que o próprio código criou); forgia.formas(); forgia.util.rad/graus/circulo(raio, lados, [cx,cy])/arredondar; THREE = classes de matemática e curvas (Vector3, Shape, CatmullRomCurve3…); console.log volta em "saida"; return volta em "retorno".
Exemplo (espiral): const ids = []; for (let i = 0; i < 24; i++) { const a = i * 0.5, r = 5 + i * 1.5; ids.push(forgia.criar({tipo:'cilindro', medidas:[3,3,4], centro:[r*Math.cos(a), r*Math.sin(a), null]})); } forgia.agrupar(ids, {nome:'espiral'});`,

  erros: `# Erros e o que fazer
- "Abra o Forgia": o programa está fechado; peça ao usuário para abrir e tente de novo.
- "IA desligada" / "código livre desligado": o usuário desligou em Configurações > IA; avise-o, não tente contornar.
- "Ocupado": o usuário está arrastando uma peça; espere alguns segundos e repita o mesmo pedido.
- "bloqueado": a peça está travada pelo usuário (Ctrl+L); peça para ele desbloquear.
- Erro em lote: "comando N (...)" diz qual falhou; nada foi aplicado; corrija aquele comando e mande o lote inteiro de novo.
- Parâmetro errado: a resposta traz "validos" e "exemplo"; use-os.`,
};

function manual(secao) {
  const key = String(secao || '').trim().toLowerCase().replace(/[\s-]+/g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!key || key === 'guia' || key === 'inicio') return GUIA;
  if (SECTIONS[key]) return SECTIONS[key];
  return `Seção "${secao}" não existe. Seções: ${Object.keys(SECTIONS).join(', ')} (sem seção = guia rápido).`;
}

module.exports = { INSTRUCTIONS, GUIA, SECTIONS, manual };
