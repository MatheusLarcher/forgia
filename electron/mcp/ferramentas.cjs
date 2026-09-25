'use strict';
// Ferramentas MCP do Forgia (tools/list). Descrição curta e exata, com unidade e exemplo; o manual
// completo fica em manual.cjs (forgia_manual). Cada ferramenta forgia_<cmd> vira POST /comando
// { cmd, args } na ponte do Forgia aberto, exceto forgia_manual, respondida aqui mesmo.
// Sistema: mm, Z para cima, X direita, Y fundo, origem no centro da mesa.

const num = (description) => ({ type: 'number', description });
const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const vec = (description, nullable = false) => ({
  type: 'array',
  items: nullable ? { type: ['number', 'null'] } : { type: 'number' },
  minItems: 3,
  maxItems: 3,
  description,
});
const ids = (description = 'ids dos objetos (no lote, "$ref" também vale)') => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

const TIPOS = 'caixa, cilindro, esfera, telhado, cone, telhado_redondo, texto, cunha, piramide, meia_esfera, poligono, paraboloide, toroide, tubo, estrela, coracao, icosaedro, desenho';
// Hardware e Geradores (src/geradores/): as medidas saem dos params (M, dentes, módulo…)
const GERADORES = 'porca, parafuso, furo_parafuso, furo_inserto, engrenagem, grade, mola, dobradica, texto_curvo, caixa_com_tampa';

// âncoras de posição comuns a criar, alterar e importar
const PLACE = {
  centro: vec('centro do objeto [X, Y, Z] em mm; null mantém o eixo (ex.: [10, 0, null])', true),
  base_z: num('altura da base (Z mínimo da caixa) em mm; 0 = apoiado na mesa'),
  sobre: str('id: apoia a base no topo desse objeto e centra X/Y nele'),
  alinhar_com: str('id: usa o X/Y do centro desse objeto'),
  mover: vec('soma [dX, dY, dZ] em mm depois do resto'),
  rotacao: vec('graus [X, Y, Z] nos eixos da mesa (gira em X, depois Y, depois Z)'),
};

const SHAPE = {
  medidas: vec('[X, Y, Z] em mm nos eixos do objeto; null = padrão/mantém. Cilindro: [diâmetro, diâmetro, altura]', true),
  cor: str('"#rrggbb"'),
  furo: bool('true = furo (recorta os sólidos do mesmo grupo)'),
  nome: str('nome legível'),
  params: { type: 'object', description: 'parâmetros do tipo (forgia_formas lista nomes, limites e unidades), ex.: { "raio": 2 } na caixa, { "texto": "ANA" } no texto, { "pontos": [[X,Y],...] } no desenho' },
};

const TOOLS = [
  {
    name: 'forgia_estado',
    description: 'Lê o projeto aberto: cada objeto com id, tipo, medidas [X,Y,Z], centro, caixa {min,max}, rotacao, params, apoiado_em (mesa | id | no_ar), grupo e filhos; seleção, marcações e desfazer. mm, Z para cima.',
    inputSchema: obj({ ids: ids('só estes objetos (partes de grupo também)'), filhos: bool('true = inclui as partes de todos os grupos') }),
  },
  {
    name: 'forgia_formas',
    description: `Catálogo dos tipos (${TIPOS}; hardware e geradores: ${GERADORES}): o que são as medidas, parâmetros com unidade, limites, opções e padrão. Sem tipo = todos numa chamada (o guia do forgia_manual já resume as medidas).`,
    inputSchema: obj({ tipo: str('um tipo só (opcional)') }),
  },
  {
    name: 'forgia_criar',
    description: 'Cria uma forma. Sem posição: centro da mesa, apoiada nela. Devolve o id e a caixa final. Hardware e geradores: omita medidas (saem dos params). Ex.: {"tipo":"cilindro","medidas":[8,8,20],"centro":[0,0,null],"furo":true}; {"tipo":"porca","params":{"m":3}}',
    inputSchema: obj({ tipo: str(`um de: ${TIPOS}; ${GERADORES}`), ...SHAPE, ...PLACE, ref: str('apelido para usar como "$ref" no mesmo lote') }, ['tipo']),
  },
  {
    name: 'forgia_alterar',
    description: 'Altera um objeto ou uma parte de grupo. medidas/rotacao/params mantêm o centro X/Y e a base. esticar cresce um lado e deixa o oposto parado. Ex.: {"id":"a1b2","esticar":{"lado":"+Z","mm":2}}',
    inputSchema: obj(
      {
        id: str('id (ou "$ref" no lote)'),
        ...SHAPE,
        esticar: obj({ lado: str('+X, -X, +Y, -Y, +Z ou -Z (eixos do objeto)'), mm: num('quanto cresce (negativo encolhe)') }, ['lado', 'mm']),
        ...PLACE,
      },
      ['id'],
    ),
  },
  {
    name: 'forgia_excluir',
    description: 'Exclui objetos ou partes de grupo.',
    inputSchema: obj({ ids: ids() }, ['ids']),
  },
  {
    name: 'forgia_agrupar',
    description: 'Agrupa objetos soltos numa peça: sólidos se unem e os furos recortam. As partes mantêm os ids. Devolve o id do grupo.',
    inputSchema: obj({ ids: ids('pelo menos 2 objetos do topo'), nome: str('nome do grupo'), ref: str('apelido no lote') }, ['ids']),
  },
  {
    name: 'forgia_desagrupar',
    description: 'Desfaz grupos: as partes voltam a ser objetos soltos, com os mesmos ids.',
    inputSchema: obj({ ids: ids('ids dos grupos') }, ['ids']),
  },
  {
    name: 'forgia_alinhar',
    description: 'Alinha objetos num eixo pela caixa (min, centro ou max). Com referencia, ela fica parada.',
    inputSchema: obj({ ids: ids('2 ou mais'), eixo: { type: 'string', enum: ['X', 'Y', 'Z'] }, onde: { type: 'string', enum: ['min', 'centro', 'max'] }, referencia: str('id que não se mexe') }, ['ids', 'eixo', 'onde']),
  },
  {
    name: 'forgia_espelhar',
    description: 'Espelha objetos em torno do centro deles, no eixo dado.',
    inputSchema: obj({ ids: ids(), eixo: { type: 'string', enum: ['X', 'Y', 'Z'] } }, ['ids', 'eixo']),
  },
  {
    name: 'forgia_soltar_na_mesa',
    description: 'Desce (ou sobe) os objetos até a base encostar na mesa (Z = 0).',
    inputSchema: obj({ ids: ids() }, ['ids']),
  },
  {
    name: 'forgia_selecionar',
    description: 'Seleciona objetos na tela do usuário ([] limpa). É o único comando que mexe na seleção.',
    inputSchema: obj({ ids: ids() }, ['ids']),
  },
  {
    name: 'forgia_duplicar',
    description: 'Copia objetos N vezes, cada cópia deslocada (e girada em Z) em relação à anterior. Ex.: 5 pinos a cada 10 mm: {"ids":["p"],"vezes":4,"deslocamento":[10,0,0]}',
    inputSchema: obj({ ids: ids(), vezes: num('quantas cópias (1–500)'), deslocamento: vec('[dX, dY, dZ] mm por cópia'), giro_z: num('graus em Z por cópia'), centro_giro: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[X, Y] do eixo do giro (padrão: o centro do objeto)' }, ref: str('apelido da lista de cópias no lote') }, ['ids']),
  },
  {
    name: 'forgia_lote',
    description: 'Vários comandos como UM passo de desfazer; se um falha, nada fica. Itens {"cmd":"criar", ...args}; "ref" em criar/agrupar/duplicar/importar e "$ref" nos ids seguintes. Comandos: criar, alterar, excluir, agrupar, desagrupar, alinhar, espelhar, soltar_na_mesa, selecionar, duplicar, importar, criar_encaixe.',
    inputSchema: obj({ comandos: { type: 'array', items: { type: 'object' }, description: 'ex.: [{"cmd":"criar","ref":"base","tipo":"caixa","medidas":[80,60,5]},{"cmd":"criar","ref":"f","tipo":"cilindro","medidas":[8,8,5],"furo":true},{"cmd":"agrupar","ids":["$base","$f"]}]' } }, ['comandos']),
  },
  {
    name: 'forgia_captura',
    description: 'Imagem PNG da vista (para conferir no fim; as medidas vêm do retorno dos comandos). vista: iso, frente, topo, direita, esquerda, tras ou atual.',
    inputSchema: obj({ vista: { type: 'string', enum: ['iso', 'frente', 'topo', 'direita', 'esquerda', 'tras', 'atual'] }, ids: ids('enquadra só estes (padrão: tudo)'), largura: num('px, 64–1600 (padrão 800)'), altura: num('px, 64–1600 (padrão 600)'), marcacoes: bool('mostra os alfinetes (padrão true)') }),
  },
  {
    name: 'forgia_medir',
    description: 'Distância e diferença [dX,dY,dZ] entre centros (ids) ou pontos [X,Y,Z]; entre dois objetos também a folga por eixo entre as caixas (<0 sobrepostas).',
    inputSchema: obj({ a: { description: 'id ou [X,Y,Z]' }, b: { description: 'id ou [X,Y,Z]' } }, ['a', 'b']),
  },
  {
    name: 'forgia_marcacoes',
    description: 'Marcações que o usuário pôs (Marcar parte, tecla N): número, peça, parte (id, tipo, medidas), ponto e face. Use quando ele disser "aqui", "essa parte" ou "a 1".',
    inputSchema: obj({ limpar: bool('true = apaga todas depois de ler') }),
  },
  {
    name: 'forgia_exportar_stl',
    description: 'Grava um STL binário (Z para cima, mm) num caminho absoluto .stl. Furos soltos não saem.',
    inputSchema: obj({ caminho: str('ex.: C:\\\\Users\\\\voce\\\\peca.stl'), ids: ids('só estes (padrão: tudo)') }, ['caminho']),
  },
  {
    name: 'forgia_exportar_3mf',
    description: 'Grava um .3mf num caminho absoluto: uma peça por objeto do topo, com a cor dela (o fatiador atribui um filamento por cor). mm, Z para cima. Furos soltos não saem.',
    inputSchema: obj({ caminho: str('ex.: C:\\\\Users\\\\voce\\\\pecas.3mf'), ids: ids('só estes objetos do topo (padrão: tudo)') }, ['caminho']),
  },
  {
    name: 'forgia_criar_encaixe',
    description: 'Negativo de uma peça, para imprimir o soquete/suporte onde ela entra: ao lado dela (+X), um grupo com um bloco aberto em cima e a cópia da peça como furo, com a folga por lado. A peça não muda. Devolve o grupo, o bloco e a cópia com medidas e caixa; avisos diz se a folga é aproximada. Ex.: {"id":"a1b2","folga":0.25}',
    inputSchema: obj({ id: str('peça (objeto do topo; no lote, "$ref")'), folga: num('mm por lado, 0–1 (padrão 0,25)'), margem: num('parede do bloco nos lados e embaixo, mm (padrão 3)'), nome: str('nome do grupo'), ref: str('apelido do grupo no lote') }, ['id']),
  },
  {
    name: 'forgia_importar',
    description: 'Importa STL/OBJ/3MF de um caminho absoluto (peças orgânicas: gere o STL em Python e importe). Aceita as mesmas âncoras de posição do criar.',
    inputSchema: obj({ caminho: str('arquivo .stl, .obj ou .3mf'), nome: str('nome'), medidas: vec('reescala para [X, Y, Z] mm; null mantém', true), cor: str('"#rrggbb"'), ...PLACE, ref: str('apelido no lote') }, ['caminho']),
  },
  {
    name: 'forgia_desfazer',
    description: 'Desfaz o último passo (da IA ou do usuário: a pilha é uma só).',
    inputSchema: obj({}),
  },
  {
    name: 'forgia_refazer',
    description: 'Refaz o passo desfeito.',
    inputSchema: obj({}),
  },
  {
    name: 'forgia_executar_codigo',
    description: 'ÚLTIMO CASO: JavaScript num Worker (10 s) com a fachada forgia.criar/alterar/agrupar/duplicar/objetos… e THREE (matemática). Os comandos viram um lote. Antes de usar, diga ao usuário por quê.',
    inputSchema: obj({ codigo: str('corpo de função JS; pode usar return') }, ['codigo']),
  },
  {
    name: 'forgia_manual',
    description: 'Manual do Forgia para a IA. Sem seção: guia rápido com as medidas de cada forma, posição, furos e um exemplo de lote (leia uma vez antes da primeira modelagem). Seções: receitas, impressao, coordenadas, marcacoes, codigo_livre, erros.',
    inputSchema: obj({ secao: str('vazio = guia rápido; ou receitas, impressao, coordenadas, marcacoes, codigo_livre, erros') }),
  },
];

module.exports = { TOOLS };
