'use strict';
// Gravador do modo gravação das dicas animadas (scripts/gravar/principal.cjs). Roda numa janela
// oculta, sem Node, chamado pelo main por executeJavaScript:
// - recebe a janela INTEIRA do Forgia por getDisplayMedia (o main responde com a fonte do
//   desktopCapturer), então entram a vista 3D e as sobreposições HTML: cotas, bolinhas de alinhar,
//   régua, alfinetes e o cursor falso;
// - a cada 1/fps s desenha o quadro mais recente, recortado na região da demonstração e escalado
//   para o tamanho do vídeo, num OffscreenCanvas; por cima, a imagem congelada do fim, que se
//   dissolve na pose inicial (assim o vídeo termina onde começou e o loop não pula);
// - cada quadro composto vira um VideoFrame num MediaStreamTrackGenerator, gravado pelo
//   MediaRecorder em WebM (VP9, sem som), com a taxa de bits pedida.
// Tudo o que é usado já vem no Chromium do Electron: nenhuma dependência.
(() => {
  let stream = null;
  let reader = null;
  let latest = null; // quadro mais recente da janela (VideoFrame)
  let timer = 0;
  let rec = null;
  let chunks = [];
  let writer = null;
  let out = null;
  let ctx = null;
  let frozen = null; // imagem congelada (OffscreenCanvas) que se dissolve no fim
  let alpha = 0;
  let crop = null; // { x, y, w, h, janela } em px CSS da janela do Forgia
  let size = null; // { w, h } do vídeo
  let frames = 0;
  let t0 = 0;

  async function readLoop() {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (latest) latest.close();
      latest = value;
    }
  }

  // quadro do Forgia recortado e escalado (sem a imagem congelada)
  function drawLive(c, w, h) {
    const s = latest.displayWidth / crop.janela; // px do quadro por px CSS da janela
    c.drawImage(latest, crop.x * s, crop.y * s, crop.w * s, crop.h * s, 0, 0, w, h);
  }

  function compose() {
    if (!latest || !writer) return;
    ctx.globalAlpha = 1;
    drawLive(ctx, size.w, size.h);
    if (frozen && alpha > 0) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(frozen, 0, 0);
      ctx.globalAlpha = 1;
    }
    const vf = new VideoFrame(out, { timestamp: Math.round((performance.now() - t0) * 1000) });
    writer.write(vf).catch(() => {});
    frames++;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  window.gravador = {
    // opts: { recorte: { x, y, w, h, janela }, saida: { w, h }, fps, bitrate }
    async iniciar(opts) {
      crop = opts.recorte;
      size = opts.saida;
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: false });
      const [track] = stream.getVideoTracks();
      reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      readLoop();
      for (let i = 0; i < 100 && !latest; i++) await wait(30);
      if (!latest) throw new Error('a captura da janela não entregou quadros');
      out = new OffscreenCanvas(size.w, size.h);
      ctx = out.getContext('2d', { alpha: false });
      ctx.imageSmoothingQuality = 'high';
      const gen = new MediaStreamTrackGenerator({ kind: 'video' });
      writer = gen.writable.getWriter();
      rec = new MediaRecorder(new MediaStream([gen]), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: opts.bitrate });
      chunks = [];
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
      frozen = null;
      alpha = 0;
      frames = 0;
      t0 = performance.now();
      rec.start();
      compose();
      timer = setInterval(compose, 1000 / opts.fps);
      return { quadro: { w: latest.displayWidth, h: latest.displayHeight } };
    },

    // guarda a imagem atual por cima de tudo (o main arruma a cena por baixo, sem aparecer)
    congelar() {
      frozen = new OffscreenCanvas(size.w, size.h);
      const f = frozen.getContext('2d', { alpha: false });
      drawLive(f, size.w, size.h);
      alpha = 1;
      return true;
    },

    // a imagem congelada some aos poucos (suave, sem salto) e revela a cena de baixo
    async dissolver(ms) {
      const start = performance.now();
      for (;;) {
        const k = Math.min(1, (performance.now() - start) / ms);
        alpha = 1 - (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
        if (k >= 1) break;
        await wait(10);
      }
      alpha = 0;
      frozen = null;
      return true;
    },

    // miniatura 64x48 em cinza da cena ao vivo: o main compara o início e o fim (loop sem pulo)
    amostra() {
      const c = new OffscreenCanvas(64, 48).getContext('2d', { willReadFrequently: true });
      drawLive(c, 64, 48);
      const d = c.getImageData(0, 0, 64, 48).data;
      const g = [];
      for (let i = 0; i < d.length; i += 4) g.push(Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]));
      return g;
    },

    // PNG do quadro composto agora (evidência e conferência do enquadramento)
    async foto() {
      compose();
      return toBase64(await out.convertToBlob({ type: 'image/png' }));
    },

    // encerra e devolve o WebM em base64 (o main grava o arquivo)
    async parar() {
      clearInterval(timer);
      compose();
      const done = new Promise((r) => (rec.onstop = r));
      rec.stop();
      await done;
      await writer.close().catch(() => {});
      writer = null;
      for (const t of stream.getTracks()) t.stop();
      if (latest) latest.close();
      latest = null;
      return { base64: await toBase64(new Blob(chunks, { type: 'video/webm' })), quadros: frames, ms: Math.round(performance.now() - t0) };
    },
  };

  function toBase64(blob) {
    return new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(',')[1]);
      fr.readAsDataURL(blob);
    });
  }
})();
