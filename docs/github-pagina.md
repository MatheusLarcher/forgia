# Página do repositório no GitHub (preparado, NÃO aplicado)

Nada daqui foi aplicado: o repositório local ainda não tem `remote`, e publicar exige o OK do dono.
Com o repositório criado, aplique pela interface (engrenagem ao lado de **About**, e
**Settings → Social preview** para a imagem) ou, autorizado, pelo `gh` (comandos no fim).

## About

- **Descrição**: Editor 3D grátis para Windows, em português, para criar peças para impressão 3D — com IA (Claude e GPT).
- **Site**: https://larchertech.com/ *(confirmar com o dono antes de aplicar)*
- **Tópicos**: `impressao-3d`, `3d-printing`, `3d-modeling`, `stl`, `3mf`, `cad`, `windows`, `portugues`, `mcp`, `claude`, `gpt`, `electron`
- Marcar **Releases** (e desmarcar Packages e Deployments, que o projeto não usa) em "Include in the home page".

## Imagem de prévia social

- Arquivo: [`docs/media/previa-social.png`](media/previa-social.png), 1280×640, PNG de ~630 KB (o GitHub pede até 1 MB).
- Marca, "Da ideia à peça.", a descrição e uma captura do app (o chaveiro "ANA" feito pela IA), em fundo grafite próprio: legível tanto no tema claro quanto no escuro de onde o link for colado.
- Só entra pela interface: **Settings → General → Social preview → Edit → Upload an image**.
- Regerar: `npx electron scripts/previa-social.cjs` (veja [build.md](build.md#mídias-do-readme)).

## Formulários de issue

Já no repositório, em `.github/ISSUE_TEMPLATE/`:

- `problema.yml` — **Relatar um problema**: versão do Forgia (em Configurações), versão do Windows, o que fez, o que esperava, o que aconteceu, print ou `.forgia`.
- `duvida.yml` — **Tirar uma dúvida**: o que quer fazer, onde travou, versão (opcional).
- `config.yml` — issue em branco continua permitida.

Os formulários pedem os rótulos `problema` e `dúvida`: crie os dois em **Issues → Labels** (sem eles o GitHub só não aplica o rótulo).
O botão **Ajuda** do README aponta para `../../issues/new/choose`, a página que lista esses formulários.

## Antes de divulgar (checklist)

1. Primeira release publicada como **versão normal** (não *pre-release*), com o arquivo `Forgia-Setup.exe` anexado com esse nome exato. Sem isso, o botão **Baixar para Windows** do README dá 404 (o `releases/latest` ignora pre-release).
2. Abrir o README no GitHub e conferir: âncoras (**Como instalar**, **Como usar a IA**, **Comece em 1 minuto**), links relativos (`../../releases/...`, `../../issues/new/choose`), GIFs e selos carregando, `<details>` da FAQ recolhidos, no computador e no celular.
3. **Bloqueio de publicação**: as frases sobre o Agent Code receber os pedidos direto do Forgia (seção "Peça para a IA" e "Como usar a IA", marcadas com comentário `BLOQUEIO DE PUBLICAÇÃO` no README) só ficam se já houver uma release do Agent Code com a integração (0.1.36 ou mais nova, com os recursos `modelo` e `imagens`). A integração foi testada de ponta a ponta com o Agent Code 0.1.36 local e os GIFs dela já são gravados com ele. Sem essa release, tire as duas frases e o item do Agent Code.
4. Commit do `package.json` com a versão da release (o `gerar_setup.bat` sobe a versão sozinho).

## Comandos `gh` (só com autorização)

```bash
gh repo edit --description "Editor 3D grátis para Windows, em português, para criar peças para impressão 3D — com IA (Claude e GPT)." \
  --homepage "https://larchertech.com/" \
  --add-topic impressao-3d,3d-printing,3d-modeling,stl,3mf,cad,windows,portugues,mcp,claude,gpt,electron
gh label create "problema" --color d73a4a --description "Algo não funciona como deveria"
gh label create "dúvida" --color 0e8a16 --description "Pergunta de uso"
```

A imagem de prévia social não tem comando no `gh`: é pela interface.
