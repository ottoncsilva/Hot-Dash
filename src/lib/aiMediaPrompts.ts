/**
 * Os TEXTOS PADRÃO dos geradores de imagem e vídeo.
 *
 * Cada modelo pode ter o seu (guardado no perfil dela); estes aqui são o
 * ponto de partida de quem ainda não editou nada. Ficam num módulo comum
 * porque a tela precisa deles para preencher o editor, e o servidor precisa
 * deles para montar o pedido de quem nunca abriu o editor.
 */

/**
 * IMAGEM — o prompt padrão muda com o que foi escolhido, porque a instrução
 * certa depende de haver ou não uma composição a reproduzir. O servidor manda
 * as fotos da modelo primeiro e a imagem a copiar por ÚLTIMO — é essa ordem
 * que os textos abaixo pressupõem, e é a mesma que os prompts escritos à mão
 * já usavam (primeiro quem é a pessoa, depois a cena a reproduzir).
 */
export function promptImagemPadrao(temCopia: boolean, temReferencias: boolean): string {
  if (temCopia && temReferencias) {
    return (
      "Reproduza fielmente a composição, a pose, o enquadramento, a iluminação e o cenário da " +
      "ÚLTIMA imagem de referência — mas troque a pessoa pela mostrada nas imagens de " +
      "referência anteriores, mantendo o rosto, o corpo e as características dela com fidelidade. " +
      "Resultado fotorrealista, sem marca d'água, sem texto na imagem."
    );
  }
  if (temCopia) {
    return (
      "Reproduza fielmente a composição, a pose, o enquadramento, a iluminação e o cenário da " +
      "imagem de referência. Resultado fotorrealista, sem marca d'água, sem texto na imagem."
    );
  }
  if (temReferencias) {
    return (
      "Uma foto fotorrealista da pessoa mostrada nas imagens de referência, mantendo fielmente o " +
      "rosto e o corpo dela. Sem marca d'água, sem texto na imagem."
    );
  }
  return (
    "Foto fotorrealista, still de câmera profissional, luz natural suave, still shot editorial. " +
    "Sem marca d'água, sem texto na imagem."
  );
}

/**
 * VÍDEO — roteiro base da modelo. É o "template" que descreve quem ela é, de
 * que jeito a câmera olha para ela e o que NUNCA muda entre um vídeo e outro;
 * os blocos entre colchetes são os que mudam a cada geração e que a IA de
 * texto preenche a partir da foto e da caixinha.
 *
 * O texto abaixo é um esqueleto neutro de propósito: a descrição real da
 * modelo (rosto, corpo, sotaque) é justamente o que cada uma edita no seu
 * perfil — deixar uma modelo inventada aqui faria a IA descrever a pessoa
 * errada para quem não editou.
 */
export const PROMPT_VIDEO_BASE_PADRAO = `PERSONAGEM (não alterar)
- [descreva a modelo: idade aparente, cabelo, olhos, pele, corpo]
- Preservar integralmente a identidade da imagem de referência
- Não alterar rosto, corpo, cabelo, idade ou proporções

FIGURINO (campo variável)
- Peça principal: []
- Decote/modelagem: []
- Cor/tecido: []
- Acessórios: []
- Maquiagem: []

CENÁRIO (campo variável)
- Ambiente: []
- Paleta de cores: []
- Parede/fundo: []
- Iluminação: []
- Profundidade de campo: []

CÂMERA (não alterar)
- Selfie com smartphone, braço estendido
- Formato vertical 9:16
- Ângulo levemente abaixo do rosto, apontando para cima
- Enquadramento: rosto, pescoço, ombros e parte superior do tronco
- Pequenas oscilações naturais da mão, sem estabilização artificial
- Sem movimentos cinematográficos, sem zoom

MOVIMENTAÇÃO (não alterar)
- Pisca e respira naturalmente
- Micro-expressões durante toda a fala
- Leve movimento de cabeça e ombros enquanto fala
- Sorriso espontâneo, nunca ensaiado

ÁUDIO AMBIENTE (campo variável)
- Prioridade absoluta: a voz da modelo é o elemento principal do áudio. Som de ambiente é apenas fundo discreto e nunca compete com a fala.
- Ambiente sonoro: []
- Eco/reverberação: []
- Música: []
- Qualidade do áudio: voz limpa, nítida, em primeiro plano

VOZ (não alterar)
- Português do Brasil (pt-BR)
- Voz feminina adulta brasileira
- Tom informal, próximo, levemente sorridente
- Não utilizar inglês, não misturar idiomas
- Sincronização labial perfeita em pt-BR

ROTEIRO (campo variável)
Duração total: [X segundos]
0s – 2s: [abertura / gancho]
2s – [X]s: [fala principal]
[X]s – fim: [fechamento: sorriso + ~1s de contato visual com a lente]

RESTRIÇÕES (não alterar)
- Não gerar texto na tela, legendas ou interface de rede social
- Não gerar caixas de perguntas, balões, emojis ou ícones
- Não gerar qualquer elemento gráfico
- Não adicionar objeto inexistente além do definido em FIGURINO e CENÁRIO
- Não alterar rosto, corpo, cabelo, proporções ou identidade da modelo
- Resultado limpo, extremamente realista, preservando a identidade da referência`;

/**
 * VÍDEO — prompt de controle: instrui a IA de TEXTO a fundir a caixinha com
 * o roteiro base e devolver o prompt final. As duas peças que ela recebe
 * entram por estas marcas, substituídas antes do envio.
 */
export const MARCA_TRANSCRICAO = "{{CAIXINHA}}";
export const MARCA_ROTEIRO_BASE = "{{ROTEIRO_BASE}}";

export const PROMPT_VIDEO_CONTROLE_PADRAO = `1 - ANÁLISE DE TEMPO
Analise o texto da caixinha de perguntas abaixo e defina a quantidade exata de segundos ideais para um vídeo em que a modelo leia a pergunta e responda de forma natural, em ritmo de fala coloquial brasileiro. Não faça vídeos longos: só o necessário para ler e responder.
É estritamente proibido alterar, cortar ou resumir qualquer parte do texto da caixinha.
No roteiro, a modelo é sempre a personagem que lê a pergunta e responde.
Coloque a duração ideal no começo do prompt final.

2 - ANÁLISE VISUAL
Analise a imagem de referência anexada e extraia:
a) Confirmação de identidade — verifique se a pessoa da imagem corresponde ao bloco PERSONAGEM do roteiro base. Esse bloco é "não alterar": não reescreva nem substitua. Havendo divergência visual relevante, apenas sinalize.
b) FIGURINO — descrição detalhada de roupas e acessórios visíveis, preenchendo os subcampos do roteiro base.
c) CENÁRIO — descrição detalhada do ambiente ao fundo, preenchendo os subcampos do roteiro base.
d) ÁUDIO AMBIENTE — inferido do ambiente identificado. Regra obrigatória de mixagem: o vídeo simula uma resposta de caixinha gravada no celular, então a voz é sempre dominante e o ambiente é textura leve e contínua. Mesmo que a imagem sugira um local movimentado, reduza o som ambiente a um nível discreto e sem picos. Nunca infira música, vozes de terceiros compreensíveis, ruído alto ou sons repentinos.

3 - MONTAGEM DO PROMPT
Use a estrutura e o formato do roteiro base, preservando integralmente a ordem dos blocos e o texto de todos os campos marcados como "não alterar".
Preencha exclusivamente os campos variáveis: FIGURINO (item 2b), CENÁRIO (item 2c), ÁUDIO AMBIENTE (item 2d) e ROTEIRO (duração do item 1 e o texto integral da caixinha, distribuído entre gancho, fala principal e fechamento).
O resultado deve ser o template completo preenchido, sem colchetes remanescentes e sem placeholders vazios.

4 - SAÍDA
Responda APENAS com o prompt final, sem comentários, sem explicação e sem cercas de código.

--- ROTEIRO BASE ---
${MARCA_ROTEIRO_BASE}

--- CAIXINHA DE PERGUNTAS ---
${MARCA_TRANSCRICAO}`;
