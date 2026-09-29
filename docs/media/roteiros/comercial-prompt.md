# Prompt — comercial completo do Forgia (v2)

## Prompt

Crie um comercial de **~54 segundos**, 1920×1080, 30 fps, MP4 (H.264 + AAC), para o **Forgia**: editor 3D
grátis para Windows, em português, para quem está começando na impressão 3D. Promessa: **"Da ideia à peça."**

**Público:** iniciante e maker que acha modelagem 3D difícil. **Um estranho, depois de ver uma vez, tem
que saber:** o que é (editor 3D para impressão 3D), para quem é (quem nunca modelou), como consegue
(grátis, Windows 10 e 11).

**Ângulo:** o app trabalhando, não slides sobre o app. O vídeo é quase todo **tela real em tela cheia**,
gravada em alta resolução do próprio Forgia (tema escuro), com a câmera do vídeo se aproximando da ação
(zoom e deslocamento suaves até onde o cursor clica). Letreiros curtos e grandes entram no ritmo da
música. Nada de GIF pequeno dentro de moldura; nada de mockup inventado.

**Identidade (a do app, `src/style.css`):** grafite `#16181b`, painel `#202327`, laranja `#f58220`
(realce `#ff9b37`), texto `#f2f3f4`; Segoe UI Black nos letreiros, Segoe UI no apoio; logo
`public/branding/forgia-forge-v1.svg`.

**Roteiro (letreiro principal → o que a tela mostra):**

| # | Tempo | Letreiro | Tela |
|---|-------|----------|------|
| 1 | 0–3,4 s | "Você tem uma ideia." → "E uma **impressora 3D**." | tipografia sobre grafite |
| 2 | 3,4–5,5 s | "Falta a **peça**." | tipografia, impacto |
| 3 | 5,5–7,6 s | **Forgia** — "Da ideia à peça." | logo acendendo |
| 4 | 7,6–13,9 s | "Peça para a **IA**." / "Em português. Ela monta a peça no Forgia." | o pedido "faça um chaveiro com o nome ANA" sendo digitado e o chaveiro aparecendo na mesa |
| 5 | 13,9–21,2 s | "Marque. Peça. **Pronto**." / "Clique na parte e diga o que quer mudar." | Pedir à IA → Marcar → alfinete na tampa lisa da caixa do ESP32 → "faz uma ventilação em colmeia aqui" → a tampa ganha **61 furos sextavados** alinhados (clarão + contador "61 furos em colmeia, num pedido só") |
| 6 | 21,2–27,5 s | "Ou arraste e **monte**." / "Medidas em milímetros: é só digitar." | caixa e cilindro arrastados, altura digitada |
| 7 | 27,5–32,7 s | "Encaixe com **folga**." / "O parafuso M8 vira um furo do tamanho certo." | Criar encaixe no parafuso M8 |
| 8 | 32,7–39,0 s | "Baixou um modelo? **Adapte**." | triceratops.3mf arrastado para a janela + texto DINO |
| 9 | 39,0–44,2 s | "Exporte STL ou **3MF**." / "Com as cores, pronto para o fatiador." | diálogo Exportar, foguete colorido |
| 10 | 44,2–48,4 s | "Feito para quem está **começando**." | selos: Grátis · Funciona offline · Sem conta · Em português |
| 11 | 48,4–53,6 s | **Forgia** — "Da ideia à peça." + "Baixe grátis para Windows 10 e 11" | logo, fim parado |

A cena 5 é a que mostra o que seria difícil à mão: 61 furos posicionados e alinhados num pedido só. O
pôster (quadro 0) é o fim dela: a tampa em colmeia com o "61".
**Ritmo:** cortes na batida (trilha de ~115 BPM); cada letreiro fica parado o tempo de ler (~0,3 s por
palavra); entre as telas, uma cortina laranja diagonal esconde o corte; nunca dissolve entre duas telas cheias.

**Som:** trilha instrumental animada (sem voz), com efeitos discretos no mesmo espaço da música (teclas no
pedido para a IA, impacto suave nas cortinas e no logo, cliques nos selos); mixagem limpa (~−16 LUFS),
fade-in 0,4 s e fade-out 2,6 s.

**Não fazer:** prometer o que o app não tem; números ou depoimentos inventados; jargão (fatiador =
"programa que prepara a impressão"); marcas além de Claude, GPT e os fatiadores citados no README.

**Entrega:** `docs/media/forgia-comercial-full.mp4` (+ `forgia-comercial-full.gif` de prévia para o README).
