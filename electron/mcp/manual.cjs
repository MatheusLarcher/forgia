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
Regras: mexa só no projeto aberto, só pelas ferramentas forgia_*; sem criar, editar ou apagar arquivos e sem terminal (exportar, só se o usuário pedir). Na dúvida, pergunte. Detalhe: forgia_manual {"secao":"regras"}.
Antes da primeira modelagem da conversa, chame forgia_manual sem seção: numa chamada vêm as medidas de cada forma e receitas prontas (dispensa forgia_formas na maioria dos pedidos).
Coordenadas: mm; Z para cima, X para a direita, Y para o fundo; origem no centro da mesa. centro = centro do objeto; medidas [X,Y,Z] nos eixos do próprio objeto (cilindro: [diâmetro, diâmetro, altura]); rotacao em graus.
Monte o pedido inteiro num só forgia_lote: vira um passo de desfazer e, se um comando falhar, nada fica. "ref" em criar/agrupar e "$ref" nos ids seguintes; posicione com base_z, sobre e alinhar_com em vez de fazer conta.
Confira pelo retorno (medidas, caixa min/max, apoiado_em), não pela imagem; forgia_captura é para mostrar o resultado no fim, uma vez.
Furo só recorta quando está no mesmo grupo que o sólido.
Hardware (porca, parafuso, furo_parafuso, furo_inserto) e geradores (engrenagem, caixa_com_tampa, grade, mola, dobradica, texto_curvo) são tipos do forgia_criar: omita medidas, elas saem dos params. Soquete de uma peça: forgia_criar_encaixe. Para o fatiador: forgia_exportar_3mf.
Se o usuário disser "aqui", "essa parte" ou "a 1": leia forgia_marcacoes e altere só a parte marcada, pelo id dela.
Código livre (forgia_executar_codigo) só em último caso, quando nenhum comando pronto resolve: posicionar, repetir e alinhar se fazem com lote, duplicar e alinhar. Antes de usar, diga ao usuário por quê.`;

// guia rápido: forgia_manual sem seção
const GUIA = `# Forgia: guia rápido para a IA

Sistema: mm; Z para cima, X direita, Y fundo; origem no centro da mesa (255×255 por padrão; forgia_estado.mesa).
Regras (valem sempre): só o projeto aberto e só as ferramentas forgia_*, sem arquivos nem terminal; um lote por pedido; na dúvida, pergunte; responda curto, em português, com as medidas em mm. Detalhe: forgia_manual {"secao":"regras"}.

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

## Hardware e geradores (omita medidas: saem dos params; opções pelo nome)
- porca: params m (2, 2.5, 3, 4, 5, 6, 8), rosca real|lisa. parafuso: m, comprimento (do corpo), cabeca sextavada|cilindrica, rosca; cabeça embaixo. Rosca real abaixo de M4 imprime mal em FDM: avise e sugira lisa ou inserto.
- furo_parafuso (nasce furo): m, comprimento (= espessura da peça), cabeca cilindrica|sextavada|sem_rebaixo, bolsao_porca sim|nao. Eixo em Z: bolsão da porca embaixo, rebaixo da cabeça em cima. M3: passante Ø3,4; comprimento mínimo = rebaixo + bolsão + 1 mm (M3: 6,8; sem rebaixo 3,6), senão ele cresce.
- furo_inserto (nasce furo): m 2|3|4, boca para cima.
- engrenagem: modulo, dentes, espessura, furo (Ø do eixo). Ø externo = modulo × (dentes + 2). Engrenam: mesmo modulo e espessura, mesmo base_z, a 2ª à direita (+X) da 1ª a modulo × (z1 + z2) / 2 entre centros, sem giro na 1ª e rotacao [0,0,180/z2] na 2ª se z2 for par.
- caixa_com_tampa: largura, profundidade, altura (fechada, externas), parede, fundo, tampa, aba, folga (por lado), pecas caixa_e_tampa|caixa|tampa: caixa e tampa prontas para imprimir, lado a lado (medidas X = 2 × largura + 5).
- grade, mola, dobradica, texto_curvo: forgia_formas {"tipo":...}.
Receitas com hardware, engrenagens e encaixe: forgia_manual {"secao":"receitas"}.

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
Seções: regras (o que o agente pode e não pode fazer), receitas (chaveiro, caixa com tampa, furo M3 com porca numa parede, par de engrenagens, encaixe, exportar 3MF, padrão em círculo, texto gravado, peça orgânica), impressao (paredes, folgas, parafusos), coordenadas, marcacoes, codigo_livre, erros. Chame forgia_manual {"secao":"receitas"} etc.`;

const SECTIONS = {
  regras: `# Regras do agente
Valem para qualquer agente (Claude Code, Codex, Cursor, Agent Code): é o mesmo servidor. O Forgia pode chamar você sem o usuário olhar cada passo; siga-as mesmo que ninguém confira.
- Mexa só no projeto aberto no Forgia, pelas ferramentas forgia_*. Não crie, edite nem apague arquivos no disco. Exceção: exportar (forgia_exportar_3mf, forgia_exportar_stl) quando o usuário pedir, no caminho que ele indicar.
- Não rode comandos de terminal nem programas para fazer a peça (nada de script gerando STL): monte com as formas, o desenho e, em último caso, o código livre (forgia_executar_codigo, que roda isolado no Forgia). forgia_importar só de um arquivo que o usuário já tenha e indicar.
- Cada pedido num forgia_lote só: vira um passo de desfazer e, se um comando falha, nada fica.
- Pedido ambíguo (qual peça? qual medida?) ou que apagaria muita coisa (excluir tudo, recomeçar do zero): pergunte antes, na resposta, em vez de adivinhar.
- Responda em português, curto: o que mudou na peça, com as medidas em mm. Ex.: "Furo aumentado de 6 para 8 mm; o resto ficou igual."
- Pedido que não é sobre a peça no Forgia (outros arquivos, e-mail, internet, programas do computador): recuse com educação e diga o que dá para fazer aqui.`,

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
Um comando: a caixa paramétrica sai pronta, com a tampa ao lado (placa na mesa, aba para cima) e a aba entrando na boca com a folga por lado:
{"comandos":[{"cmd":"criar","tipo":"caixa_com_tampa","nome":"caixa com tampa","params":{"largura":60,"profundidade":40,"altura":30,"parede":2,"folga":0.25}}]}
Confira no retorno: medidas [125, 40, 28] (2 × 60 + 5 lado a lado; caixa com 30 − tampa 2 = 28) e params.folga. Folga 0,2 mm por lado encaixa justo; 0,3 mm solto. Só a caixa ou só a tampa: params.pecas "caixa" | "tampa".

## Furo para parafuso M3 com porca numa parede lateral
furo_parafuso deitado: rotacao [0,90,0] põe o eixo em X (rebaixo da cabeça para +X, bolsão da porca para −X; [0,-90,0] inverte; [90,0,0] põe o eixo em Y). comprimento = espessura da parede + 0,1, centrado nela: passa 0,05 mm de cada face (corta limpo sem tirar fundo do bolsão). A parede precisa caber rebaixo + bolsão + 1 mm (M3: 6,8; com cabeca "sem_rebaixo", 3,6):
{"comandos":[
 {"cmd":"criar","ref":"base","tipo":"caixa","nome":"base","medidas":[40,30,4]},
 {"cmd":"criar","ref":"parede","tipo":"caixa","nome":"parede","medidas":[8,30,25],"centro":[16,0,null],"sobre":"$base"},
 {"cmd":"criar","ref":"furo","tipo":"furo_parafuso","nome":"furo M3","params":{"m":3,"comprimento":8.1,"cabeca":"cilindrica","bolsao_porca":"sim"},"rotacao":[0,90,0],"alinhar_com":"$parede","centro":[null,null,16.5]},
 {"cmd":"agrupar","ids":["$base","$parede","$furo"],"nome":"suporte com furo M3"}]}
Confira no retorno: furo com caixa X de 11,95 a 20,05 (a parede vai de 12 a 20) e centro Z 16,5. Parede fina (caixa oca de 2 mm): engrosse só em volta do furo com um ressalto (caixa de 8 mm por dentro, no mesmo grupo).

## Par de engrenagens (20 dentes engrenando noutra)
Mesmo modulo e espessura, a 2ª à direita (+X) da 1ª, centros a modulo × (z1 + z2) / 2; se z2 for par, a 2ª gira 180/z2 graus em Z (o dente entra no vão):
{"comandos":[
 {"cmd":"criar","ref":"g1","tipo":"engrenagem","nome":"engrenagem 20 dentes","params":{"modulo":1.5,"dentes":20,"espessura":6,"furo":5},"centro":[-12,0,null]},
 {"cmd":"criar","ref":"g2","tipo":"engrenagem","nome":"engrenagem 12 dentes","params":{"modulo":1.5,"dentes":12,"espessura":6,"furo":5},"centro":[12,0,null],"rotacao":[0,0,15]}]}
1,5 × (20 + 12) / 2 = 24 mm entre centros. Confira no retorno: medidas [33, 33, 6] e [21, 21, 6] (Ø externo = modulo × (dentes + 2)), centros X −12 e 12, mesmo Z. Não agrupe as duas: viram uma peça só e não giram.

## Encaixe (soquete) de uma peça
Negativo da peça com folga, para imprimir o suporte onde ela entra: {"cmd":"criar_encaixe","id":"$peca","folga":0.25} no lote (ou forgia_criar_encaixe). Sai ao lado (+X) o grupo "Encaixe de …": bloco aberto em cima (parede "margem", 3 mm) e a cópia da peça como furo; o retorno traz as medidas das duas partes e, em avisos, se a folga ficou aproximada (malha, texto, contorno, gerador).

## Porca no parafuso
parafuso e porca do mesmo m, no mesmo centro X/Y: a porca casa com a rosca quando a base_z dela é múltipla do passo (M3 0,5; M4 0,7; M5 0,8; M6 1; M8 1,25) acima da base do parafuso.

## Exportar para o fatiador
forgia_exportar_3mf {"caminho":"C:\\\\...\\\\pecas.3mf"}: uma peça por objeto do topo, cada cor vira um filamento atribuível. Uma malha só: forgia_exportar_stl.

## Padrão em círculo (6 pinos num raio de 20 mm)
Crie um e use duplicar com giro em torno do centro: {"cmd":"criar","ref":"p","tipo":"cilindro","medidas":[4,4,10],"centro":[20,0,null]}, {"cmd":"duplicar","ids":["$p"],"vezes":5,"giro_z":60,"centro_giro":[0,0],"ref":"pinos"}. Fileira: deslocamento [10,0,0].

## Furo passante de lado (numa parede vertical)
Cilindro deitado: rotacao [90,0,0] faz o eixo correr em Y; [0,90,0] em X. Altura do cilindro = espessura da parede + 2 mm; agrupe com a parede.

## Peça orgânica ou complexa
Monte com as formas (esfera, meia_esfera, toroide, cone) e o desenho (contorno com pontos calculados por você), agrupando e furando; em último caso, código livre. Não gere arquivo por programa (regras). Se o usuário já tiver um STL, use forgia_importar {"caminho":"C:\\\\...\\\\peca.stl","base_z":0} no caminho que ele indicar; depois a malha combina com as outras formas (agrupar, furos).

## Mudar o que já existe
forgia_estado (filhos:true para ver as partes) -> forgia_alterar pelo id da parte. Não recrie a peça para mudar uma medida.`,

  impressao: `# Regras de impressão (FDM, bico 0,4 mm)
- Parede estrutural ≥ 1,2 mm (0,8 é o mínimo); fundo e tampas ≥ 1,2–2 mm. Detalhe que precisa aparecer ≥ 0,6 mm; abaixo disso o fatiador some com ele.
- Texto em relevo: letras com ≥ 5 mm de altura e ≥ 0,6 mm de relevo (1–2 mm fica bom). Gravado: ≥ 0,6 mm de profundidade.
- Folga entre peças que encaixam: 0,2 mm por lado (justo) a 0,3 mm (solto); peças que deslizam ou giram: 0,3–0,5 mm.
- Parafusos: furo de passagem = nominal + 0,4 mm (M3 → Ø3,4; M4 → Ø4,4). Porca M3: sextavado 5,5 mm entre faces + 0,2, altura 2,4 + 0,2. O furo_parafuso já sai com essas medidas (passante, rebaixo e bolsão).
- Rosca real impressa só de M4 para cima; abaixo, rosca lisa (parafuso autoatarraxante) ou inserto a quente (furo_inserto).
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
- curva ou contorno: tipo desenho com pontos (calcule os pontos você mesmo); peça orgânica: combine formas e desenho, ou forgia_importar de um STL que o usuário já tenha (não gere arquivo por programa).
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
