// Iniciantes do projeto: cenas prontas (chaveiro, suporte de celular, caixa com tampa, boneco de
// neve e foguete) montadas só com formas do Forgia, em public/iniciantes/*.json (arquivo de
// projeto, formato forgia.projeto v1, um grupo no topo). O Vite embute os JSON no build: nada é
// lido do disco nem da rede ao abrir. São as mesmas cenas das dicas animadas da Fase E.
// Gerados por tests/gerar-iniciantes.mjs.
import chaveiro from '../public/iniciantes/chaveiro.json';
import suporte from '../public/iniciantes/suporte-celular.json';
import caixa from '../public/iniciantes/caixa-com-tampa.json';
import boneco from '../public/iniciantes/boneco-de-neve.json';
import foguete from '../public/iniciantes/foguete.json';

// chave (favoritos, texto) -> grupo do topo da cena
export const INICIANTES = [
  ['chaveiro', chaveiro],
  ['suporteCelular', suporte],
  ['caixaComTampa', caixa],
  ['bonecoDeNeve', boneco],
  ['foguete', foguete],
].map(([key, json]) => ({ key, object: json.projeto.objects[0] }));
