/**
 * Modelo pronto ("Puxar padrão") do Downsell geral e do Downsell de PIX
 * gerado — cronograma completo desenhado com você: escala até 50% de
 * desconto em 48h, com muitos passos curtos no começo (a cada poucos
 * minutos) que vão espaçando conforme o tempo passa, e depois disso segue
 * mandando um lembrete por dia, sempre nos mesmos 4 horários, alternando o
 * texto.
 *
 * Os textos aqui são GENÉRICOS DE PROPÓSITO — cada um é só o ÂNGULO/a piada
 * daquele momento (a demora, a provocação, o desconto, o teaser de
 * conteúdo), sem nome, idade ou característica de nenhuma modelo. Servem de
 * ponto de partida (funcionam sozinhos se ninguém mexer) E de matéria-prima
 * pro botão "Gerar com IA": `telegramDownsellAi.ts` lê o texto que já está
 * no passo como rascunho de referência e reescreve na voz e persona de cada
 * modelo.
 *
 * Este arquivo NÃO é "server-only": os dois cartões de Recuperação
 * (`page.tsx`) importam os arrays direto, no cliente, pro botão "Puxar
 * padrão" funcionar sem round-trip nenhum ao servidor.
 */

/** Só os campos que os passos-modelo usam — estrutural, bate com o
 * `FunnelStep` de verdade (client e servidor) por formato, sem precisar
 * importar o tipo de um módulo `server-only`. */
type PassoPadrao = {
  delayMinutes: number;
  discountPercent: number;
  text: string;
  isLoop?: boolean;
  dailyTime?: string;
  planMode?: "all";
  audience?: "leads";
};

/** Gera os passos "vá de X em X minutos até Y" — o recheio entre dois
 * marcos com texto escrito à mão, girando por um punhado de variações pra
 * não repetir a mesma frase dezenas de vezes. */
function intervalo(
  inicioMin: number,
  fimExclusivoMin: number,
  passoMin: number,
  discountPercent: number,
  textos: string[],
  extra: Partial<PassoPadrao> = {},
): PassoPadrao[] {
  const out: PassoPadrao[] = [];
  let i = 0;
  for (let t = inicioMin; t < fimExclusivoMin; t += passoMin) {
    out.push({ delayMinutes: t, discountPercent, text: textos[i % textos.length], ...extra });
    i++;
  }
  return out;
}

/**
 * `delayMinutes` conta do FATO GERADOR do funil inteiro — o /start no
 * Downsell geral, a criação da cobrança no Downsell de PIX gerado — e NUNCA
 * reinicia a cada mensagem enviada (ver `passoPronto` em telegramCron.ts).
 * Por isso os marcos abaixo são TEMPO ABSOLUTO desde o gatilho: "aos 90
 * minutos do /start", "aos 1440 (24h) do /start" — dá pra ler cada
 * `delayMinutes` direto como "quando isso dispara desde o início".
 */

/** Os 4 lembretes finais, em horário fixo do relógio (repete todo dia). */
function tailDiario(textos: [string, string, string, string]): PassoPadrao[] {
  const horarios: string[] = ["16:00", "19:00", "22:00", "07:30"];
  return horarios.map((dailyTime, i) => ({
    delayMinutes: 0,
    discountPercent: 50,
    isLoop: true,
    dailyTime,
    text: textos[i],
    planMode: "all",
  }));
}

// ---------------------------------------------------------------------------
// A partir de 3h os dois funis seguem o MESMO desenho (você pediu pra
// "seguir semelhante ao outro funil") — marcos e recheio compartilhados.
// ---------------------------------------------------------------------------

const MARCO_3H: PassoPadrao = {
  delayMinutes: 180,
  discountPercent: 20,
  text: "🔥 Já vi que você precisa de um empurrãozinho pra criar coragem.\n\nLá dentro do meu privado tem o que você não acha em outro lugar, e eu não fico esperando pra sempre.\n\nSeparei 20% DE DESCONTO. Ficou barato demais pra você continuar enrolando.\n\n👇🏼 Pega essa chave e vem me ver sem roupa.",
  planMode: "all",
};

const POOL_15 = [
  "{nome}, o desconto de 15% continua valendo — só falta você clicar. 🔥",
  "Ainda te esperando, {nome}... vai deixar por isso mesmo? 😈",
  "Psiu, {nome} 👀 15% off ainda tá na mesa, mas não por muito tempo.",
  "Enquanto você pensa, tem gente aproveitando o meu privado agora mesmo. Vem também, {nome}.",
  "{nome}, cansei de esperar. Os 15% continuam aí, é só decidir. 🍷",
];

const MARCO_6H: PassoPadrao = {
  delayMinutes: 360,
  discountPercent: 25,
  text: "{saudacao}, pra quem ainda tá de fora perdendo o melhor de mim. 🍷\n\nJá tô arrepiada e pronta pra outra rodada — só falta você destrancar o acesso.\n\nCortei 25% OFF em tudo. Foi um corte generoso pra você não pensar duas vezes.\n\n👇🏼 Escolhe seu VIP com desconto e vem ficar comigo.",
  planMode: "all",
};

const POOL_20 = [
  "20% off ainda de pé, {nome}. Não vou segurar isso pra sempre. 🔥",
  "{nome}, tô aqui pensando em você... vem aproveitar os 20% enquanto dá tempo.",
  "Ainda esperando você criar coragem, {nome}. Os 20% continuam valendo. 😏",
  "{nome}, não deixa esse desconto de 20% escapar por bobeira.",
];

const MARCO_12H: PassoPadrao = {
  delayMinutes: 720,
  discountPercent: 30,
  text: "🔥 Meio dia rolando e você ainda de fora... e eu aqui te dando mole.\n\nQuando a noite chega o tesão fala mais alto, e eu quero você vendo tudo isso ao vivo, sem censura.\n\nJoguei o passe na lama: 30% DE DESCONTO EM TUDO. Não tem mais desculpa que segure.\n\n👇🏼 Entra agora e me pega no flagra.",
  planMode: "all",
};

const POOL_25 = [
  "{nome}, 25% de desconto ainda rolando. Vem ver o que você tá perdendo. 🥵",
  "Ainda por aqui esperando você, {nome}. Os 25% continuam de pé.",
  "{nome}, esse é o tipo de desconto que não aparece toda hora. 25% OFF, corre.",
  "Cadê você, {nome}? Os 25% ainda tão valendo, não deixa passar.",
];

const MARCO_24H: PassoPadrao = {
  delayMinutes: 1440,
  discountPercent: 40,
  text: "Achou que eu ia ficar implorando pela sua atenção? 🥵\n\nEu tô no ápice da vontade, gravando tudo, falando as putarias que você queria ouvir de mim.\n\nReduzi quase a metade do valor: 40% DE DESCONTO. É a sua penúltima chance de me ter.\n\n👇🏼 Pega essa chave e entra logo.",
  planMode: "all",
};

const POOL_30 = [
  "{nome}, 30% de desconto continua na mesa. Não deixa esfriar. 🔥",
  "Ainda de olho em você, {nome}. Os 30% off seguem valendo.",
  "{nome}, tô te dando mais uma chance com 30% de desconto. Aproveita.",
  "30% OFF ainda ativo, {nome}. Não vai ser hoje que eu desisto de você. 😈",
];

const MARCO_48H: PassoPadrao = {
  delayMinutes: 2880,
  discountPercent: 50,
  text: "Acabou a enrolação. Hoje você vai me ver sem roupa e sem frescura. 😈\n\n🔥 Centenas de vídeos exclusivos VIP\n🔥 Eu mostrando tudo o que nenhum outro homem tem acesso\n🔥 Sem censura, sem pressa, direto com você\n\nZerei todas as suas desculpas: 50% DE DESCONTO EM TODOS OS PLANOS. É pegar ou largar.\n\n👇🏼 Pega essa chave agora antes que eu mude de ideia e tranque a porta.",
  planMode: "all",
};

const POOL_40 = [
  "{nome}, 40% de desconto ainda de pé. Já é quase de graça. 🥵",
  "Ainda esperando você, {nome}. Os 40% continuam valendo, não perde essa.",
  "{nome}, 40% OFF é osso duro de recusar. Vem logo.",
  "Tô cansando de esperar, {nome}... mas os 40% ainda tão aqui pra você.",
];

/** 3h → 48h, idêntico nos dois funis. */
function caudaComum(): PassoPadrao[] {
  return [
    MARCO_3H,
    ...intervalo(210, 360, 30, 20, POOL_20, { planMode: "all" }), // 210..330, de 30 em 30 até 6h
    MARCO_6H,
    ...intervalo(420, 720, 60, 25, POOL_25, { planMode: "all" }), // 420..660, de 1h em 1h até 12h
    MARCO_12H,
    ...intervalo(840, 1440, 120, 30, POOL_30, { planMode: "all" }), // 840..1320, de 2h em 2h até 24h
    MARCO_24H,
    ...intervalo(1620, 2880, 180, 40, POOL_40, { planMode: "all" }), // 1620..2700, de 3h em 3h até 48h
    MARCO_48H,
  ];
}

// ---------------------------------------------------------------------------
// DOWNSELL GERAL — quem deu /start e nunca comprou. Conta do último contato.
// ---------------------------------------------------------------------------

export const DOWNSELL_GERAL_PADRAO: PassoPadrao[] = [
  {
    delayMinutes: 5,
    discountPercent: 0,
    text: "Vai ficar aí só olhando ou vai vir se divertir de verdade? 🍷\n\nEu tô aqui prontinha, só imaginando o que a gente ainda pode aprontar. Poucas pessoas aguentam o pique que eu tenho de portas fechadas. 😈\n\nTá pronto pra provar que aguenta?\n\n👇🏼 Entra logo e vem ver com os próprios olhos.",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 10,
    discountPercent: 5,
    text: "Sério que vai me deixar esperando? Tô perdendo a paciência com a demora. 🥵\n\nSe você soubesse o que eu tenho guardado pra você lá dentro, já tinha entrado. Pra te dar um empurrãozinho, liberei 5% DE DESCONTO em todos os acessos.\n\n⚡️ Rápido, discreto, sem enrolação.\n👇🏼 Pega essa chance e vem me ver.",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 15,
    discountPercent: 5,
    text: "15 minutos e você ainda pensando, é sério? 😈\n\nLá dentro tem conteúdo novo todo dia, sem frescura e sem censura — tudo que você não acha de graça em lugar nenhum. Mantive os 5% OFF porque eu quero muito te ver por aqui hoje.\n\nNão me faz mudar de ideia.\n👇🏼 Clica no botão e vem aproveitar.",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 20,
    discountPercent: 5,
    text: "Você gosta de testar a paciência de uma mulher com tesão, né? 🔥\n\nO que eu guardo no meu VIP você não acha de graça em lugar nenhum — sou eu, real, sem nenhum pudor. O desconto de 5% continua na mesa. É o seu passe livre.\n\n👇🏼 Pega a chave aqui embaixo.",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 30,
    discountPercent: 10,
    text: "Meia hora rolando? Acabou a brincadeira. 🍷\n\nTô aqui doida pra te mostrar o que rola quando ninguém tá olhando. Dei a louca e joguei 10% DE DESCONTO em todos os planos.\n\nFicou barato demais pra você continuar de fora.\n👇🏼 Entra logo antes que a porta tranque.",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 40,
    discountPercent: 10,
    text: "{nome}, os 10% de desconto continuam valendo — só falta você entrar. Não deixa esfriar. 👇🏼",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 50,
    discountPercent: 10,
    text: "Cadê você, {nome}? Os 10% off ainda tão de pé, mas o tempo tá passando. 😏",
    planMode: "all",
    audience: "leads",
  },
  {
    delayMinutes: 60,
    discountPercent: 15,
    text: "Tá com medo de não dar conta? 😈 Porque é a única explicação pra você ainda estar de fora.\n\nZerei mais uma desculpa sua: 15% DE DESCONTO. Vai ser corajoso ou vai continuar enrolando?\n\n👇🏼 Destranca esse acesso e vem aproveitar.",
    planMode: "all",
    audience: "leads",
  },
  ...intervalo(70, 180, 10, 15, POOL_15, { planMode: "all", audience: "leads" }), // 70..170, de 10 em 10 até 3h
  ...caudaComum().map((p) => ({ ...p, audience: "leads" as const })),
  ...tailDiario([
    "{nome}, boa tarde 🍷 os 50% de desconto continuam valendo em todos os meus planos. Só clicar aqui embaixo e aproveitar o resto do dia comigo. 👇🏼",
    "{nome}, começando a noite e os 50% off ainda de pé. Não deixa passar. 👇🏼 🔥",
    "Já é de noite, {nome}, e os 50% continuam aqui te esperando. Última call do dia. 👇🏼 😈",
    "Bom dia, {nome} ☕ os 50% de desconto seguem valendo. Começa o dia comigo. 👇🏼",
  ]).map((p) => ({ ...p, audience: "leads" as const })),
];

// ---------------------------------------------------------------------------
// DOWNSELL DE PIX GERADO — já escolheu o plano e viu a tela de pagamento.
// Conta da criação do PIX; direto, sem reapresentar a oferta do zero.
// ---------------------------------------------------------------------------

export const PIX_DOWNSELL_PADRAO: PassoPadrao[] = [
  {
    delayMinutes: 3,
    discountPercent: 0,
    text: "Já se passaram 3 minutos. Tá com algum problema no aplicativo do banco, amor? 🍷\n\nEu já tô aqui de pernas cruzadas só esperando o apito do pagamento pra te dar as boas-vindas no VIP. Não me deixa esperando.\n\n👇🏼 Copia o código e finaliza isso logo.",
    planMode: "all",
  },
  {
    delayMinutes: 5,
    discountPercent: 0,
    text: "5 minutos rolando... a vontade continua alta, mas a paciência já não tanto. 😈\n\nGerar o código e ficar só olhando pra tela não leva a lugar nenhum. Clica, baixa a guarda e vem ver o que te espera aqui dentro.\n\n👇🏼 Paga isso agora antes que eu solte sua vaga.",
    planMode: "all",
  },
  {
    delayMinutes: 7,
    discountPercent: 0,
    text: "7 minutos rolando... você não faz ideia do que já podia estar vendo aqui dentro. 💦\n\nEnquanto você ainda tá decidindo, tem gente aproveitando o conteúdo novo que acabei de soltar no privado. Vai ficar só imaginando?\n\n👇🏼 Destranca esse acesso logo.",
    planMode: "all",
  },
  {
    delayMinutes: 10,
    discountPercent: 0,
    text: "10 minutos, amor. Vai mesmo desistir bem na porta? 🥵\n\nTô aqui pronta pra te mostrar tudo que mais ninguém oferece. É só um clique de distância.\n\n👇🏼 Copia esse código e entra agora.",
    planMode: "all",
  },
  {
    delayMinutes: 15,
    discountPercent: 5,
    text: "15 minutos e você ainda pensando... 😈\n\nLá no meu privado tem conteúdo novo todo dia, sem frescura e sem censura — tudo que você não acha de graça em lugar nenhum. Mantive os 5% OFF porque eu quero muito te ver lá dentro hoje.\n\nNão me faz mudar de ideia.\n👇🏼 Clica no botão e vem aproveitar.",
    planMode: "all",
  },
  {
    delayMinutes: 20,
    discountPercent: 5,
    text: "Você gosta de testar a paciência de uma mulher com tesão, né? 🔥\n\nO que eu guardo no meu VIP você não acha de graça em lugar nenhum da internet — sou eu, real, sem nenhum pudor. O desconto de 5% continua na mesa. É o seu passe livre.\n\n👇🏼 Pega a chave aqui embaixo.",
    planMode: "all",
  },
  {
    delayMinutes: 25,
    discountPercent: 5,
    text: "25 minutos e o desconto de 5% ainda tá valendo, {nome}. Não deixa esfriar — o que eu tenho separado pra você não vai esperar pra sempre.\n\n👇🏼 Copia o código e entra logo.",
    planMode: "all",
  },
  {
    delayMinutes: 30,
    discountPercent: 10,
    text: "Meia hora rolando? Acabou a brincadeira. 🍷\n\nTô aqui doida pra te mostrar o que rola quando ninguém tá olhando. Dei a louca e joguei 10% DE DESCONTO em todos os planos.\n\nFicou barato demais pra você continuar de fora.\n👇🏼 Entra logo antes que a porta tranque.",
    planMode: "all",
  },
  {
    delayMinutes: 35,
    discountPercent: 10,
    text: "{nome}, os 10% de desconto continuam valendo — só falta você fechar. Não deixa essa chance esfriar. 👇🏼",
    planMode: "all",
  },
  {
    delayMinutes: 40,
    discountPercent: 10,
    text: "Ainda por aqui te esperando, {nome}. Os 10% off seguem de pé, mas não por muito tempo. 😏",
    planMode: "all",
  },
  {
    delayMinutes: 45,
    discountPercent: 10,
    text: "{nome}, será que você vai mesmo deixar por isso mesmo? Os 10% ainda tão na mesa. 🔥",
    planMode: "all",
  },
  {
    delayMinutes: 50,
    discountPercent: 10,
    text: "Cadê você, {nome}? Já fiz até desconto e nada de você aparecer. 10% OFF ainda valendo. 👇🏼",
    planMode: "all",
  },
  {
    delayMinutes: 60,
    discountPercent: 15,
    text: "Tá com medo de não dar conta? 😈 Porque é a única explicação pra você ainda estar de fora.\n\nZerei mais uma desculpa sua: 15% DE DESCONTO. Vai ser corajoso ou vai continuar enrolando?\n\n👇🏼 Destranca esse acesso e vem aproveitar.",
    planMode: "all",
  },
  ...intervalo(70, 180, 10, 15, POOL_15, { planMode: "all" }), // 70..170, de 10 em 10 até 3h
  ...caudaComum(),
  ...tailDiario([
    "{nome}, boa tarde 🍷 os 50% de desconto continuam valendo pro {plano} que você escolheu — {valor}. Só clicar aqui embaixo e finalizar. 👇🏼",
    "{nome}, começando a noite e os 50% off ainda de pé no seu {plano}, por {valor}. Não deixa passar. 👇🏼 🔥",
    "Já é de noite, {nome}, e os 50% continuam aqui — {plano} por {valor}. Última call do dia. 👇🏼 😈",
    "Bom dia, {nome} ☕ os 50% no seu {plano} ({valor}) seguem valendo. Fecha isso e começa o dia comigo. 👇🏼",
  ]),
];
