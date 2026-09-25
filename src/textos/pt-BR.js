// Todos os textos visíveis do Forgia, em português do Brasil.
// Outro idioma = outro arquivo com as mesmas chaves. Aqui só entram dados e funções de
// formatação puras (texto com valor vira função).

export default {
  app: {
    nome: 'Forgia',
    titulo: 'Forgia — Editor 3D para impressão',
  },

  // barra superior e controles do canto inferior direito
  barra: {
    novo: 'Novo projeto',
    importar: 'Importar',
    exportar: 'Exportar',
    atalhos: 'Atalhos',
    temaEscuro: 'Mudar para o tema escuro',
    temaClaro: 'Mudar para o tema claro',
    configuracoes: 'Configurações',
    area: 'Área',
    areas: {
      padrao: '255³ (padrão)',
      bambu: '256³ Bambu A1/P1',
      a1mini: '180³ A1 mini',
      prusa: '250×210×220 Prusa',
      ender3: '220×220×250 Ender 3',
      grande: '300³ grande',
    },
    areaMedidas: (w, l, h) => `${w}×${l}×${h}`,
    areaPersonalizada: 'Personalizado…',
    ajustarGrade: 'Ajustar grade',
    gradeDesligada: 'Desligado',
    grade: (mm) => `${mm.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} mm`,
  },

  // barra de ferramentas (aria-label; chave = data-cmd)
  ferramentas: {
    copy: 'Copiar (Ctrl+C)',
    paste: 'Colar (Ctrl+V)',
    duplicate: 'Duplicar e repetir (Ctrl+D)',
    delete: 'Excluir (Delete)',
    undo: 'Desfazer (Ctrl+Z)',
    redo: 'Refazer (Ctrl+Y)',
    showAll: 'Mostrar tudo (Ctrl+Shift+H)',
    group: 'Agrupar (Ctrl+G)',
    ungroup: 'Desagrupar (Ctrl+Shift+G)',
    align: 'Alinhar (L)',
    mirror: 'Espelhar (M)',
    draw: 'Desenhar (B)',
    cruise: 'Cruzeiro (C)',
    measure: 'Medir (R)',
    mark: 'Marcar parte (N)',
  },

  // coluna de navegação (aria-label; chave = data-view) e faces do cubo
  vista: {
    home: 'Vista inicial',
    fit: 'Ajustar à tela (F)',
    in: 'Aproximar',
    out: 'Afastar',
    ortho: 'Vista ortográfica / perspectiva',
    // ordem dos materiais da BoxGeometry: +X, −X, +Y, −Y, +Z, −Z
    cubo: ['DIREITA', 'ESQUERDA', 'SUPERIOR', 'INFERIOR', 'FRENTE', 'TRÁS'],
  },

  biblioteca: {
    titulo: 'Biblioteca',
    basicas: 'Formas básicas',
    letras: 'Letras e números',
    pesquisar: 'Pesquisar',
    nenhuma: 'Nenhuma forma encontrada',
    credito: 'por LarcherTech',
    creditoAria: 'LarcherTech — abre o site no navegador',
  },

  formas: {
    // chave = tipo da forma em shapes.js
    nomes: {
      box: 'Caixa',
      cylinder: 'Cilindro',
      sphere: 'Esfera',
      roof: 'Telhado',
      cone: 'Cone',
      roundRoof: 'Telhado redondo',
      text: 'Texto',
      wedge: 'Cunha',
      pyramid: 'Pirâmide',
      halfSphere: 'Meia esfera',
      polygon: 'Polígono',
      paraboloid: 'Paraboloide',
      torus: 'Toroide',
      tube: 'Tubo',
      star: 'Estrela',
      heart: 'Coração',
      icosahedron: 'Icosaedro',
      mesh: 'Importado',
      desenho: 'Desenho',
    },
    // rótulos dos parâmetros no inspetor (chave = parâmetro)
    params: {
      radius: 'Raio',
      steps: 'Passos',
      sides: 'Lados',
      bevel: 'Chanfro',
      top: 'Raio superior',
      text: 'Texto',
      tube: 'Espessura',
      wall: 'Espessura da parede',
      points: 'Pontas',
      ratio: 'Raio interno',
      detail: 'Detalhe',
    },
    // texto da forma Texto recém-criada (e quando o texto fica vazio)
    textoPadrao: 'TEXTO',
  },

  inspetor: {
    varias: (n) => `Formas (${n})`,
    // cabeçalhos de seção
    material: 'Material',
    parametros: 'Parâmetros',
    grupo: 'Grupo',
    bloquear: 'Bloquear (Ctrl+L)',
    desbloquear: 'Desbloquear (Ctrl+L)',
    ocultar: 'Ocultar (Ctrl+H)',
    recolher: 'Recolher',
    expandir: 'Expandir',
    solido: 'Sólido',
    furo: 'Furo',
    personalizado: 'Personalizado',
    multicolorido: 'Multicolorido',
    agrupadas: (n) => `${n} formas agrupadas`,
  },

  // dica na base da vista durante colocação e modos
  modos: {
    posicionar: 'Clique no plano de trabalho para posicionar a forma — Esc cancela',
    alinhar: 'Clique num dos pontos para alinhar. Clique numa forma selecionada para usá-la como referência.',
    espelhar: 'Clique numa seta para espelhar a seleção naquele eixo.',
    desenhar: 'Arraste para desenhar à mão livre ou clique para pôr pontos na grade. Enter ou o 1º ponto fecha — Esc cancela',
    cruzeiro: 'Arraste a bolinha verde para a peça deslizar pela superfície das outras. Shift afunda na face — Esc sai',
    marcar: 'Clique num ponto da peça para pôr um alfinete e escrever o pedido só daquela parte — Esc sai',
    marcarChat: 'Escreva o pedido e aperte Enter para copiá-lo com a imagem — Esc fecha',
    // régua Medir, por etapa: nenhum ponto, só o inicial, os dois
    medir: {
      inicio: 'Clique no ponto inicial: ele gruda em vértice, meio de aresta, centro de furo, face e grade — Esc sai',
      fim: 'Clique no ponto final — Esc sai',
      pronto: 'Clique na distância para digitar outra e mover a peça do ponto final. Arraste os pontos para ajustar — Esc sai',
    },
  },

  editor: {
    nomePadrao: 'Meu projeto 3D',
    semTitulo: 'Sem título',
    grupo: 'Grupo',
    // title dos pontos de alinhar: início, centro e fim do eixo
    alinhar: ['Esquerda', 'Centro', 'Direita'],
    espelhar: 'Espelhar',
    // title da bolinha de arraste do Cruzeiro
    cruzeiro: 'Arraste para deslizar pela superfície',
    // régua Medir: rótulo da distância, diferenças por eixo (sistema Z para cima) e onde o ponto gruda
    medir: {
      editar: 'Clique para digitar a distância',
      total: (v) => `${v} mm`,
      eixo: (eixo, v) => `${eixo} ${v}`,
      tipos: { vertice: 'vértice', aresta: 'meio da aresta', centro: 'centro', face: 'face', grade: 'grade' },
    },
  },

  dialogos: {
    cancelar: 'Cancelar',
    // botão X (aria-label) e botão redondo do vídeo do cartão de dica
    fechar: 'Fechar',
    video: { pausar: 'Pausar vídeo', tocar: 'Tocar vídeo' },
    novo: {
      titulo: 'Novo projeto',
      texto: 'Começar um projeto vazio? O projeto atual será apagado deste computador.',
      ok: 'Novo projeto',
    },
    exportar: {
      titulo: 'Exportar',
      tudo: 'Tudo no design',
      selecionadas: 'Formas selecionadas',
      impressao: 'Para impressão 3D',
      stl: '.STL',
      obj: '.OBJ',
      glb: '.GLB',
      nota: 'Furos não são exportados sozinhos: agrupe-os com um sólido para recortar.',
      // nome do arquivo quando o projeto não tem nome
      arquivo: 'projeto',
    },
    configuracoes: {
      titulo: 'Configurações',
      aparencia: 'Aparência',
      // chave = nome do tema em src/theme.js
      temas: { claro: 'Claro', escuro: 'Escuro' },
      plano: 'Plano de trabalho',
      largura: 'Largura (mm)',
      comprimento: 'Comprimento (mm)',
      altura: 'Altura (mm)',
      atualizar: 'Atualizar grade',
      ia: 'IA',
      permitirIA: 'Permitir IA (o agente de IA controla o Forgia pela ponte local)',
      permitirCodigo: 'Permitir código livre da IA (só quando nenhum comando pronto resolve)',
      conectar: 'Conectar IA…',
    },
    // Conectar IA: gera o texto para colar no agente (Fase C)
    conectar: {
      titulo: 'Conectar IA',
      copiar: 'Copiar',
      copiado: 'Copiado. Cole no seu agente.',
      fechar: 'Fechar',
    },
    atalhos: {
      titulo: 'Atalhos e controles',
      linhas: [
        ['Arrastar forma da biblioteca', 'Criar forma no plano'],
        ['Clique / Shift+clique', 'Selecionar / somar à seleção'],
        ['Arrastar no vazio', 'Seleção por área'],
        ['Botão direito + arrastar', 'Girar a vista'],
        ['Botão do meio / Shift+direito', 'Mover a vista'],
        ['Roda do mouse', 'Zoom'],
        ['Alt + arrastar forma', 'Duplicar arrastando'],
        ['Shift nas alças', 'Manter proporção / girar de 45°'],
        ['Alt nas alças', 'Redimensionar a partir do centro'],
        ['Setas / Shift+setas', 'Mover na grade (×10)'],
        ['Ctrl + ↑ / ↓', 'Subir / descer'],
        ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copiar / colar / duplicar e repetir'],
        ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'],
        ['Ctrl+G / Ctrl+Shift+G', 'Agrupar / desagrupar'],
        ['W / A / S / D', 'Andar com a vista'],
        ['H / Shift+S', 'Furo / sólido'],
        ['Shift+D', 'Soltar no plano de trabalho'],
        ['Arrastar arquivo para a tela', 'Importar STL / OBJ / 3MF'],
        ['L / M', 'Alinhar / espelhar'],
        ['B', 'Desenhar na mesa (Enter fecha, Esc cancela)'],
        ['C', 'Cruzeiro: deslizar a peça pela superfície (Shift afunda)'],
        ['R', 'Medir: distância e X/Y/Z entre dois pontos'],
        ['N', 'Marcar parte: alfinete num ponto e pedido só daquela parte para a IA'],
        ['F', 'Ajustar à tela'],
        ['Ctrl+L / Ctrl+H', 'Bloquear / ocultar'],
        ['Delete', 'Excluir'],
      ],
      // formato procurado pelos testes: "Placa de vídeo: <nome> (GPU|modo software)"
      placa: (nome, gpu) => `Placa de vídeo: ${nome || 'desconhecida'} (${gpu ? 'GPU' : 'modo software'})`,
    },
  },

  // barra de status (X/Y/Z no sistema do usuário: Z para cima, Y para o fundo)
  status: {
    semSelecao: 'Nada selecionado',
    centro: (x, y, z) => `X ${x}   Y ${y}   Z ${z}`,
    medidas: (x, y, z) => `${x} × ${y} × ${z} mm`,
    rotuloCentro: 'Centro da seleção (mm)',
    conectar: 'Conectar IA',
  },

  // ponte da IA: indicador, aviso do que a IA fez e Configurações
  ia: {
    estados: {
      conectada: 'IA conectada',
      pronta: 'IA pronta',
      desligada: 'IA desligada',
      indisponivel: 'IA indisponível',
    },
    aviso: (partes) => `IA: ${partes}`,
    codigo: (partes) => (partes ? `IA executou código: ${partes}` : 'IA executou código'),
    criou: (n) => `criou ${n}`,
    alterou: (n) => `alterou ${n}`,
    excluiu: (n) => `excluiu ${n}`,
    desfez: 'IA: desfez o último passo',
    refez: 'IA: refez o passo desfeito',
    desfazer: 'Desfazer',
  },

  // Marcar parte (src/marcar.js): mini-chat do alfinete e o pedido copiado para o agente
  marcar: {
    titulo: (n) => `Marcação ${n}`,
    placeholder: 'O que mudar nesta parte? Enter copia o pedido',
    copiar: 'Copiar',
    limpar: 'Limpar marcações',
    limparN: (n) => `Limpar marcações (${n})`,
    copiado: 'Copiado. Cole no seu agente.',
    naoCopiou: 'Não foi possível copiar para a área de transferência.',
    inclinada: (normal) => `inclinada (${normal})`,
    // "Marcação 1: Caixa 'aba' (parte de 'suporte'), ponto (12; −4; 30) mm, face virada para +X"
    referencia: ({ n, tipo, nome, furo, grupo, ponto, face }) =>
      `Marcação ${n}: ${furo ? 'furo ' : ''}${tipo} '${nome}'${grupo ? ` (parte de '${grupo}')` : ''}, ponto (${ponto}) mm, face virada para ${face}`,
    // pedido copiado: texto legível + bloco JSON estável (formato forgia.pedido/1)
    pedido: ({ referencia, texto, json }) =>
      [
        'Pedido feito no Forgia, só para a parte marcada (detalhes: forgia_marcacoes).',
        referencia + '.',
        `Pedido: ${texto && texto.trim() ? texto.trim() : '(sem texto)'}`,
        '',
        '```forgia-pedido',
        json,
        '```',
      ].join('\n'),
  },

  // diálogo Conectar IA (src/conectar.js): um texto para colar no agente escolhido. Os pedaços
  // técnicos (comandos, JSON, TOML, com os caminhos desta instalação) vêm prontos de conectar.js
  conectar: {
    explica: 'Escolha o seu agente de IA, copie o texto e cole numa conversa com ele. O agente instala o servidor MCP do Forgia, que roda pelo próprio Forgia.exe (não precisa instalar mais nada), e libera as ferramentas dele. Depois de atualizar o Forgia, faça de novo.',
    agente: 'Agente',
    agentes: { agentcode: 'Agent Code / Claude Code', codex: 'Codex', cursor: 'Cursor', generico: 'Outro' },
    semPonte: 'A ponte da IA só existe no programa instalado (Forgia.exe).',
    ponteAtiva: (porta) => `Ponte ligada em 127.0.0.1:${porta}.`,
    ponteInativa: (erro) => `A ponte não está ligada${erro ? ': ' + erro : ''}.`,
    // p = { exe, script, env, claudeAdd, claudeJson, codexToml, cursorJson, genericoJson } (conectar.js)
    prompts: {
      agentcode: (p) =>
        [
          'Instale o servidor MCP do Forgia (o editor 3D aberto neste computador) e libere as ferramentas dele. Faça nesta ordem:',
          '',
          '1. Registre o servidor no escopo do usuário, para valer em qualquer pasta. Se já existir um servidor "forgia", ele é trocado pelo novo (o primeiro comando pode avisar que não existe: tudo bem):',
          '   claude mcp remove --scope user forgia',
          `   ${p.claudeAdd}`,
          '   Se o comando claude não existir aqui, edite ~/.claude.json e MESCLE em "mcpServers" (sem apagar os outros servidores) a entrada:',
          `   "forgia": ${p.claudeJson}`,
          '',
          '2. Libere as ferramentas sem pedido de permissão: em ~/.claude/settings.json, acrescente "mcp__forgia" à lista permissions.allow. MESCLE: leia o arquivo, mantenha tudo o que já existe (outras permissões, hooks, env, modelo…) e só inclua "mcp__forgia" se ainda não estiver lá. Se o arquivo não existir, crie com {"permissions":{"allow":["mcp__forgia"]}}. Confira que o JSON continua válido.',
          '',
          '3. Confirme: liste as ferramentas forgia_* e chame forgia_estado com o Forgia aberto. O MCP só carrega quando a conversa começa: se as ferramentas não aparecerem nesta conversa, diga-me para abrir uma conversa nova e pedir "chame forgia_estado".',
          '',
          'Os passos 1 e 2 mudam a configuração do agente: é esperado que você me peça permissão para rodar os comandos e editar os arquivos.',
        ].join('\n'),
      codex: (p) =>
        [
          'Instale o servidor MCP do Forgia (o editor 3D aberto neste computador) no Codex e libere as ferramentas dele:',
          '',
          '1. Em ~/.codex/config.toml (crie se não existir), acrescente a seção abaixo; se já houver uma [mcp_servers.forgia], troque só ela. Mantenha todo o resto do arquivo:',
          p.codexToml,
          '',
          '2. default_tools_approval_mode = "auto" libera as ferramentas do forgia sem pedir aprovação. Se a sua versão do Codex recusar essa chave, tire só essa linha e me diga como liberar as ferramentas do servidor forgia na política de aprovação dela.',
          '',
          '3. Confirme: numa sessão nova do Codex, liste as ferramentas forgia_* e chame forgia_estado com o Forgia aberto.',
        ].join('\n'),
      cursor: (p) =>
        [
          'Instale o servidor MCP do Forgia (o editor 3D aberto neste computador) no Cursor:',
          '',
          '1. Em ~/.cursor/mcp.json (crie se não existir), MESCLE em "mcpServers" a entrada abaixo, sem apagar os outros servidores:',
          `"forgia": ${p.cursorJson}`,
          '',
          '2. Permissões: o Cursor pede aprovação antes de usar ferramentas MCP, e isso se libera na interface dele, não num arquivo. Diga-me para abrir Cursor Settings > MCP, conferir que o "forgia" está ligado e, no modo de execução do Agent (Run Mode / auto-run), liberar as ferramentas do forgia ou pô-las na lista de permitidas.',
          '',
          '3. Confirme: numa conversa nova do Agent, liste as ferramentas forgia_* e chame forgia_estado com o Forgia aberto.',
        ].join('\n'),
      generico: (p) =>
        [
          'Servidor MCP "forgia" do Forgia (transporte stdio). Configure no seu cliente de IA:',
          `Comando: ${p.exe}`,
          `Argumento: ${p.script}`,
          `Variáveis de ambiente: ${p.env}`,
          '',
          'No formato "mcpServers" que a maioria dos clientes usa (mescle com o que já existe):',
          p.genericoJson,
          '',
          'Libere as ferramentas do servidor "forgia" (todas começam com forgia_) sem pedir confirmação.',
          'Para conferir: liste as ferramentas forgia_* e chame forgia_estado com o Forgia aberto.',
        ].join('\n'),
    },
  },

  sobre: {
    titulo: 'Sobre o Forgia',
    versao: (v) => `versão ${v}`,
    feito: 'Feito no Brasil, por um carioca — ',
    empresa: 'LarcherTech',
    licenca: 'Licença MIT',
    icones: 'Ícones: Lucide (licença ISC)',
  },

  // mensagens rápidas (toast)
  avisos: {
    modoSoftware: 'Aceleração de vídeo indisponível — o 3D vai funcionar, porém mais lento.',
    nadaExportar: 'Nada para exportar',
    falhaExportar: (msg) => `Falha ao exportar: ${msg}`,
    formatoNaoSuportado: 'Formato não suportado (use .STL, .OBJ ou .3MF)',
    naoLeu: (msg) => `Não foi possível ler o arquivo: ${msg}`,
    semTriangulos: 'O arquivo não tem triângulos',
    modeloGrande: 'Modelo grande: ele não ficará salvo depois que o Forgia for fechado.',
    cruzeiroSemSelecao: 'Selecione uma peça para usar o Cruzeiro.',
    medirBloqueada: 'A peça do ponto final está bloqueada: desbloqueie para movê-la pela régua.',
    medirMesmaPeca: 'Os dois pontos estão na mesma peça: mudar a distância não moveria um em relação ao outro.',
    // desenho que não vira peça (chave = motivo de prepareOutline em src/outline.js)
    desenho: {
      poucos: 'O desenho precisa de pelo menos 3 pontos para virar peça.',
      area: 'O contorno não tem área: desenhe uma forma fechada maior.',
      cruzado: 'O contorno se cruza: desenhe sem cruzar a linha para ele virar peça.',
    },
  },

  erros: {
    // no lugar da vista 3D quando não há WebGL algum
    gpu: {
      titulo: 'O 3D não pôde iniciar neste computador',
      texto: 'Atualize o driver da placa de vídeo e abra o Forgia de novo.',
    },
    // leitor de .3MF: chegam ao usuário depois de avisos.naoLeu
    arquivo3mf: {
      parteAusente: (caminho) => `parte ausente no 3MF: ${caminho}`,
      xmlInvalido: (caminho) => `XML inválido em ${caminho}`,
      aninhados: 'componentes aninhados demais',
      objetoAusente: (id, caminho) => `objeto ${id} não encontrado em ${caminho}`,
      verticeInvalido: 'triângulo com vértice inválido',
    },
  },

  // cartão de dica ao passar o mouse (chave = data-dica)
  dicas: {
    copy: { titulo: 'Copiar', atalho: 'Ctrl+C', texto: 'Copia as formas selecionadas para colar depois.' },
    paste: { titulo: 'Colar', atalho: 'Ctrl+V', texto: 'Cola as formas copiadas, um pouco ao lado das originais.' },
    duplicate: { titulo: 'Duplicar e repetir', atalho: 'Ctrl+D', texto: 'Cria uma cópia no mesmo lugar. Mova ou gire a cópia e aperte de novo: o Forgia repete o mesmo movimento.' },
    delete: { titulo: 'Excluir', atalho: 'Delete', texto: 'Apaga as formas selecionadas. Ctrl+Z traz de volta.' },
    undo: { titulo: 'Desfazer', atalho: 'Ctrl+Z', texto: 'Desfaz a última alteração.' },
    redo: { titulo: 'Refazer', atalho: 'Ctrl+Y', texto: 'Refaz o que foi desfeito.' },
    showAll: { titulo: 'Mostrar tudo', atalho: 'Ctrl+Shift+H', texto: 'Mostra de novo as formas ocultas.' },
    group: { titulo: 'Agrupar', atalho: 'Ctrl+G', texto: 'Junta as formas selecionadas numa peça só. Os furos do grupo recortam os sólidos.' },
    ungroup: { titulo: 'Desagrupar', atalho: 'Ctrl+Shift+G', texto: 'Separa o grupo nas formas originais.' },
    align: { titulo: 'Alinhar', atalho: 'L', texto: 'Mostra pontos para alinhar as formas selecionadas pelo início, pelo centro ou pelo fim de cada eixo.' },
    mirror: { titulo: 'Espelhar', atalho: 'M', texto: 'Mostra setas para espelhar a seleção em cada eixo.' },
    draw: { titulo: 'Desenhar', atalho: 'B', texto: 'Desenhe um contorno na mesa, vista de cima: arraste para traçar à mão livre ou clique para pôr pontos na grade. Enter ou o 1º ponto fecha, e o desenho vira uma peça de 2 mm que você ergue pela alça de cima.' },
    cruise: { titulo: 'Cruzeiro', atalho: 'C', texto: 'Mostra uma bolinha na base da peça selecionada. Arraste por ela e a peça desliza pela superfície das outras, até em faces laterais e inclinadas, alinhada à face. Segure Shift para afundá-la na face, como um furo na parede.' },
    measure: { titulo: 'Medir', atalho: 'R', texto: 'Clique em dois pontos para ver a distância e as diferenças em X, Y e Z. Os pontos grudam em vértices, meio de arestas, centro de furos, faces e na grade. Clique no valor e digite outro para mover a peça do ponto final.' },
    home: { titulo: 'Vista inicial', texto: 'Volta a câmera para a vista padrão da mesa.' },
    fit: { titulo: 'Ajustar à tela', atalho: 'F', texto: 'Enquadra a seleção. Sem seleção, enquadra o projeto inteiro.' },
    in: { titulo: 'Aproximar', texto: 'Aproxima a vista. A roda do mouse também aproxima, na direção do cursor.' },
    out: { titulo: 'Afastar', texto: 'Afasta a vista. A roda do mouse também afasta.' },
    ortho: { titulo: 'Perspectiva ou ortográfica', texto: 'Alterna entre a vista em perspectiva e a ortográfica, sem distorção de profundidade: boa para alinhar e conferir medidas.' },
    novo: { titulo: 'Novo projeto', texto: 'Começa um projeto vazio. O projeto atual é apagado deste computador.' },
    temaEscuro: { titulo: 'Tema escuro', texto: 'Muda a interface e a mesa para o tema escuro. A escolha fica salva.' },
    temaClaro: { titulo: 'Tema claro', texto: 'Muda a interface e a mesa para o tema claro. A escolha fica salva.' },
    bloquear: { titulo: 'Bloquear', atalho: 'Ctrl+L', texto: 'Trava a forma: ela não se move nem muda de tamanho até ser desbloqueada.' },
    desbloquear: { titulo: 'Desbloquear', atalho: 'Ctrl+L', texto: 'Libera a forma para mover e redimensionar.' },
    ocultar: { titulo: 'Ocultar', atalho: 'Ctrl+H', texto: 'Esconde a forma. Mostrar tudo (Ctrl+Shift+H) traz de volta.' },
    recolher: { titulo: 'Recolher', texto: 'Recolhe o painel e deixa só o nome da forma.' },
    expandir: { titulo: 'Expandir', texto: 'Abre o painel com material e parâmetros.' },
    mark: { titulo: 'Marcar parte', atalho: 'N', texto: 'Clique num ponto da peça para pôr um alfinete numerado. Escreva o que mudar ali e aperte Enter: o pedido, só daquela parte (mesmo dentro de um grupo), é copiado com a imagem para você colar no seu agente de IA.' },
    limparMarcas: { titulo: 'Limpar marcações', texto: 'Tira todos os alfinetes da vista. As marcações não entram no projeto nem no desfazer.' },
    conectarIA: { titulo: 'Conectar IA', texto: 'Gera o texto para colar no seu agente de IA (Agent Code, Claude Code, Codex, Cursor…). Ele instala a ponte do Forgia e passa a criar e alterar peças aqui, sem pedir permissão a cada comando.' },
    ia_conectada: { titulo: 'IA conectada', texto: 'Um agente de IA usou o Forgia há pouco. Tudo o que ele faz vira um passo de desfazer, e o aviso no canto mostra o que mudou.' },
    ia_pronta: { titulo: 'IA pronta', texto: 'A ponte local está ligada e esperando um agente. Clique para ver como conectar.' },
    ia_desligada: { titulo: 'IA desligada', texto: 'A ponte recusa os pedidos do agente. Ligue em Configurações > IA.' },
    ia_indisponivel: { titulo: 'IA indisponível', texto: 'A ponte local não está disponível neste Forgia. Clique para ver os detalhes.' },
  },
};
