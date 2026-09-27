// Tema da interface (claro/escuro): estado, escolha salva, evento de troca e cores da vista 3D.
// O <html> recebe data-tema; as cores da interface são variáveis de CSS de cada tema (style.css).
// O script inline do index.html aplica o mesmo tema antes da primeira pintura (sem clarão).

export const THEMES = ['claro', 'escuro'];

// Cores da vista 3D. Na troca de tema só .color/.opacity de materiais e texturas mudam:
// nada de geometria nem de furos (CSG) recalculados.
export const PALETTES = {
  claro: {
    plate: '#d8e2ec', plateOpacity: 0.9, // mesa
    gridMinor: '#aebfd0', gridMinorOpacity: 0.5, // 1 mm
    gridMajor: '#7f97b0', gridMajorOpacity: 0.9, // a cada 10 mm
    border: '#56708a', volume: '#56708a', volumeOpacity: 0.3,
    groundLight: '#9aa3ad', shadowOpacity: 0.22,
    rulerOpacity: 0.85, rulerBandOpacity: 0.6, // régua da mesa: tracinhos (cor da borda) e faixa da seleção (cor do contorno)
    outline: '#f58220', outlineHover: '#ff9b37',
    hole: '#aab2ba', holeOpacity: 0.55, holeThumb: '#b3bac1',
    handleCorner: { fill: '#ffffff', stroke: '#2b2b2b' },
    handleEdge: { fill: '#2b2b2b', stroke: '#ffffff' },
    handleHover: { fill: '#f23d3d', stroke: '#ffffff' },
    handleSolid: '#2b2b2b', handleSolidHover: '#f23d3d', // cone de elevar e setas de giro
    protractor: { ring: '#ffffff', ringOpacity: 0.55, ticks: '#333333', sector: '#f58220', sectorOpacity: 0.35 },
    cube: { face: '#f4f5f6', faceHover: '#fde4cf', border: '#b9bec4', text: '#5b6168', edges: '#9aa1a8', ring: '#c9ced3', ringOpacity: 0.7 },
    // Cruzeiro e forma nova sobre outra peça: face realçada e contorno da peça-alvo (src/surface.js)
    cruise: { face: '#2bd14a', faceOpacity: 0.68, edge: '#16912e', edgeOpacity: 0.95 },
  },
  escuro: {
    plate: '#262c33', plateOpacity: 0.94,
    gridMinor: '#38414b', gridMinorOpacity: 0.7,
    gridMajor: '#52606f', gridMajorOpacity: 0.9,
    border: '#7d8b9a', volume: '#7d8b9a', volumeOpacity: 0.25,
    groundLight: '#8a939d', shadowOpacity: 0.42,
    rulerOpacity: 0.8, rulerBandOpacity: 0.6,
    outline: '#f58220', outlineHover: '#ff9b37',
    hole: '#c3cad2', holeOpacity: 0.5, holeThumb: '#b3bac1',
    handleCorner: { fill: '#ffffff', stroke: '#16181b' },
    handleEdge: { fill: '#16181b', stroke: '#e8ebee' },
    handleHover: { fill: '#f23d3d', stroke: '#ffffff' },
    handleSolid: '#e3e7eb', handleSolidHover: '#f23d3d',
    protractor: { ring: '#16181b', ringOpacity: 0.6, ticks: '#c9d0d8', sector: '#f58220', sectorOpacity: 0.4 },
    cube: { face: '#353a41', faceHover: '#5b4029', border: '#4a5058', text: '#c5cbd2', edges: '#5d656f', ring: '#4a5058', ringOpacity: 0.8 },
    cruise: { face: '#3ddc5f', faceOpacity: 0.62, edge: '#5fe67d', edgeOpacity: 0.95 },
  },
};

const STORAGE = 'forgia.tema';
const systemDark = matchMedia('(prefers-color-scheme: dark)');

// escolha feita pelo usuário (botão sol/lua ou Configurações); null = segue o Windows
function savedTheme() {
  try {
    const name = localStorage.getItem(STORAGE);
    return THEMES.includes(name) ? name : null;
  } catch {
    return null;
  }
}

const systemTheme = () => (systemDark.matches ? 'escuro' : 'claro');

class Theme extends EventTarget {
  constructor() {
    super();
    this.name = savedTheme() || systemTheme();
    document.documentElement.setAttribute('data-tema', this.name);
    // sem escolha salva, acompanha o Windows ao vivo
    systemDark.addEventListener('change', () => {
      if (!savedTheme()) this.set(systemTheme(), { save: false });
    });
  }

  get colors() {
    return PALETTES[this.name];
  }

  // aplica data-tema no <html>, salva a escolha e emite 'change' ({ name, colors }). O mesmo tema
  // de agora não grava nada: clicar no botão já ativo não fixa o tema (sem escolha salva, segue o Windows)
  set(name, { save = true } = {}) {
    if (!THEMES.includes(name) || name === this.name) return;
    if (save) {
      try {
        localStorage.setItem(STORAGE, name);
      } catch {
        // sem armazenamento: o tema vale só até fechar
      }
    }
    this.name = name;
    document.documentElement.setAttribute('data-tema', name);
    this.dispatchEvent(new CustomEvent('change', { detail: { name, colors: this.colors } }));
  }

  toggle() {
    this.set(this.name === 'claro' ? 'escuro' : 'claro');
  }

  // chama fn(colors, name) agora e a cada troca; devolve a função que cancela
  watch(fn) {
    const run = () => fn(this.colors, this.name);
    run();
    this.addEventListener('change', run);
    return () => this.removeEventListener('change', run);
  }
}

export const theme = new Theme();
