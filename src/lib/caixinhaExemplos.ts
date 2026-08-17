/**
 * CAIXINHAS VALIDADAS — o que já rodou e funcionou no perfil.
 *
 * Não é inspiração solta: é a régua. Descrever o tom em adjetivos ("provocante,
 * divertida") devolve texto de marca de sabonete; mostrar as respostas de
 * verdade devolve a voz.
 *
 * Cada chamada leva um SORTEIO destes pares, não a lista inteira — por dois
 * motivos. O primeiro é tamanho: duzentos exemplos afogam o pedido e o modelo
 * para de ler. O segundo é variedade: com os três provedores recebendo
 * amostras diferentes, e cada leva sorteando de novo, as ideias saem de cantos
 * diferentes do repertório em vez de orbitarem os mesmos quatro exemplos.
 *
 * O texto está COMO FOI PUBLICADO, com a grafia mascarada (c*zinho, p4u,
 * leit3) e os emoji no lugar da palavra (👌🏼, 🍑, 🆒, 🌸). Isso não é
 * descuido de digitação: é o mecanismo que deixa o conteúdo explícito passar
 * pela moderação do Instagram. Limpar a grafia aqui ensinaria o modelo a
 * escrever exatamente o que derruba o story.
 */
export type ExemploCaixinha = [pergunta: string, resposta: string];

export const CAIXINHAS_VALIDADAS: ExemploCaixinha[] = [
  // --- Devolve a provocação -------------------------------------------------
  [
    "Com essa testona aí fica difícil?",
    "Então com esse seu p4u pequeno também fica difícil",
  ],
  [
    "Se eu te pego tu sai de cadeira de rodas, nunca mais anda",
    "Eu não sabia que cavalo tinha instagram",
  ],
  [
    "Gosto de fazer amor com minha esposa umas 7, 8 vezes por dia, mas ela fica assada, alguma dica?",
    "Um emprego",
  ],
  [
    "Não como nem a bunda do pão, vou me sujeitar a sua?",
    "Ah, o que você quer tá mole, e nem é meus peitos",
  ],
  [
    "Abrindo a b* na internet, o que você acha que pensam de você?",
    "Eu sei o que eles pensam. E eles pensam muito bem punheta",
  ],
  [
    "Eu m3to num rolo de papel higiênico pensando em você",
    "Ainda bem que não é num tijolo né",
  ],
  [
    "Eu zerei o xvideos, você não me impressionou",
    "Ah, se tu zerou tu zerou inclusive os de g4y",
  ],
  [
    "Depois de 20min vi que tava no buraco errado, fui colocar no certo e não tinha mais buraco",
    "É moço, por 20 minutos você foi g4y",
  ],
  [
    "Bato 5 todos os dias na sua intenção",
    "Eu agradeço muito a disposição, a proatividade, mas eu acho que você consegue mais",
  ],
  [
    "Você deve ter um vizinho apertadinho",
    "Como eu vou saber se meu vizinho é apertadinho, eu não tenho nem pinto",
  ],
  [
    "Se meia paçoca é 1 real, quanto é a paçoca inteira?",
    "2 reais né, achei que todo mundo sabia disso",
  ],
  [
    "Me dá dinheiro, vou te passar meu pix",
    "Meu amor, eu tô dando o C* pra economizar anticoncepcional e você me pedindo pix",
  ],
  [
    "Como pode uma professora linda dessa ainda tá solteira?",
    "Porque ninguém quer uma simples professora de escola pública, que não tem silicone e é pobre, como eu sou",
  ],
  [
    "Fui g0zar e a mina pediu pra mim engolir, que gosto ruim",
    "Eita, daqui a pouco ela vai querer comer seu apertadinho",
  ],
  [
    "Minha namorada não me dá o 👌🏻, o que eu faço?",
    "Simples, me chama que eu dou",
  ],
  [
    "Peguei uma casada, até emagreci de tanto que soqu3i",
    "Vai continuar que vai ficar literalmente só o osso",
  ],
  [
    "Minha esposa me pegou batendo uma pra você, agora tô sem casa",
    "Então se foi pra mim, pelo menos foi bom né, valeu a pena",
  ],
  [
    "Minha mulher me pegou batendo pra você e caiu de boca logo em seguida",
    "Ai que bom né, porque tem mulher que reclama, tem mulher que terminaria com você. Pelo menos ela é parceira",
  ],
  [
    "Prazer, 36 anos, 1.80 de altura, b*to todo dia 3 pra você",
    "Prazer, 20 anos, 1.65 de altura, e todo dia eu gravo vídeo abrindo meu c*",
  ],
  [
    "Transar com mãe e filha ao mesmo tempo?",
    "Tu zerou o joguinho. De uma forma, não tem o que dizer: parabéns, o para e bens",
  ],
  [
    "Sou casado, é aconselhável te seguir?",
    "Claro que sim, enquanto ela enche seu saco, eu esvazio",
  ],
  [
    "Se não fosse casado eu te pegava",
    "Amor, recusar mulher só porque é casado é tipo recusar dinheiro por já ter emprego",
  ],
  [
    "Posso bater uma vendo suas postagens? O pinto é seu ou meu?",
    "É seu né, mas pelo visto eu tenho que dar algum tipo de permissão",
  ],
  [
    "Meu pai pediu a senha do meu privacy pra assistir você também",
    "Ai que lindo, compartilha com papai",
  ],
  [
    "Minha berinjela tem 11cm, tá bom pra você?",
    "Gente, não né. Acima de 15cm e abaixo de 20cm tá top",
  ],
  [
    "Tenho 13cm e minha mulher acha pequeno",
    "É, se tu já comeu lá atrás pode ter certeza que é pequeno",
  ],
  [
    "Minha jeba é muito fina, acha que é muito feio?",
    "Que nada, dependendo da garota você pode enfiar 2 jebas, a sua e a do seu amigo",
  ],
  [
    "Eu tenho 43cm, libera a porta dos fundos, vida?",
    "Nuuh, mas nem a da frente, nem a dos lados, nem atrás, nem a de cima",
  ],
  [
    "Minha esposa faz depilação a laser com um homem e sempre volta assada, o que acha?",
    "Olha, eu tô achando que não é só o laser que ele aplica, estamos falando de coisas maiores",
  ],

  // --- Finge que não entende ------------------------------------------------
  [
    "Você já deu o 👌🏼?",
    "O que é isso? Eu não sei o que isso significa, alguém pode me explicar?",
  ],
  [
    "Você já liberou o 👌🏼?",
    "O que é isso? Eu não sei o que isso significa, poderia me falar o que significa?",
  ],
  [
    "Trabalha com o quê?",
    "Se vocês tão entrando no meu perfil e não tão adivinhando, eu devo tá disfarçando muito bem",
  ],
  [
    "Trabalha com o quê?",
    "De forma bem resumida, eu trabalho com viagra virtual",
  ],
  [
    "Qual seu maior desejo?",
    "Ficar rica",
  ],
  [
    "Qual sua fantasia que você não realizou?",
    "Uma das coisas que mais me dá tesão, que eu não consigo parar de imaginar, fico encharcada só de pensar… me aposentar",
  ],
  [
    "Você é casada ou solteira?",
    "Solteira né, quando eu falo que sou toda natural, sem silicone, eles nem me respondem mais",
  ],
  [
    "Meu bem, pisca pra mim 😍",
    "Eu acabei de piscar, só que você não viu",
  ],
  [
    "Kontozano você tem? É sonzera ou cansada?",
    "Cansada",
  ],
  [
    "Você tem grelão?",
    "Não",
  ],

  // --- Resposta seca --------------------------------------------------------
  ["Você tá usando fio dental?", "Tô"],
  ["Você engole tudo?", "Sim! Adoro"],
  ["Esse pacotão aguenta tudo até o talo?", "Tudo, tudinhooo"],
  ["Só a pontinha ou tudinho?", "Tudo né, tudoo"],
  [
    "Você se masturba muito?",
    "Sim gente, sim, todo dia. Pra dar uma relaxada né",
  ],
  [
    "Vukovuko todo dia é normal?",
    "Graças a Deus sim, é normal, eu amo",
  ],
  [
    "Sua 🐸 é linda igual sua boca?",
    "Olha, dizem que é mais bonita",
  ],
  [
    "Você g0za dando o 🍑?",
    "Nossa que pergunta hein, é claro que sim, muito mais do que quando é na frente",
  ],

  // --- Topa e aumenta a aposta ---------------------------------------------
  [
    "Se eu te pego, coloco só a cabecinha?",
    "Não né amor, a cabeça você coloca no travesseiro. Em mim, você coloca tudinho",
  ],
  [
    "Se eu te pego, boto só a cabecinha?",
    "Hmmm, acho que a gente não combina, porque eu gosto que coloque até o talo",
  ],
  [
    "Tenho 12cm, será que entra tudo na portinha dos fundos? 👀",
    "É claro que entra. E posso te contar? Eu adoro, porque solto um melzinho bem gostoso",
  ],
  [
    "Tenho 18cm, será que entra todo na portinha dos fundos?",
    "Nossa amor que gostoso. Você promete que vai bem devagarzinho pra não me machucar? Depois que ele acostumar eu deixo colocar bem forte",
  ],
  [
    "Sou dotado… atrás você deixa eu colocar todo ele? 👀",
    "Nossa amor, mas você promete que vai com carinho pra não me machucar?",
  ],
  [
    "Liberaria atrás pra um dotado? 👀",
    "Mas é claro que sim amor, só que tem que colocar tudo, sem papinho de que é muito apertado. Aí que é bom",
  ],
  [
    "Liberaria atrás pra um cara de p4u grosso?",
    "Mas é claro que sim né amor, afinal o segredo tá mesmo em deixar bem babado",
  ],
  [
    "Se eu pedir pra parar, você vai parar de sentar? 🥵",
    "Amor, quando eu tiver sentando eu só paro quando você deixar minha bonequinha cheia de leitinho",
  ],
  [
    "Atrás pode ser com força?",
    "Meu amor, claro que sim né. Mas a pergunta é: você vai aguentar com força?",
  ],
  [
    "Pra botar atrás tem que ser devagar ou pode ser com força?",
    "Você vai começar bem devagarzinho, aí depois, quando eu mandar, você vai bem forte",
  ],
  [
    "Posso colocar no seu 🆒 enquanto você tiver deitada?",
    "Nossa amor que pergunta, mas é claro que sim. Deitada, de pé, de quatro",
  ],
  [
    "Sentaria no meu colo?",
    "Claro que sim meu amor, mas eu tenho que tá de vestido e sem cal",
  ],
  [
    "Sentaria no meu colo se eu tivesse com o p4u duro? 🥵",
    "Depende, você ia abrir o zíper?",
  ],
  [
    "Podemos fazer sem proteção? 👀",
    "Amor, até pode ser sem proteção. Quando for finalizar tem que tirar, aí você coloca em outro lugar, se é que você me entende",
  ],
  [
    "Se eu não conseguir segurar, pode ser dentro mesmo? 🙈💦",
    "Claro que sim né amor, porém tem que ser na porta dos fundos ou na minha boquinha",
  ],
  [
    "Se eu errar o buraco e entrar no c*, você deixa continuar ali?",
    "Olha, depende: se seu boneco não for muito grande eu deixo sim. E se for, melhor ainda",
  ],
  [
    "Já liberou o c*zinho de quatro? 👀",
    "Meu amor, essa daí é minha posição favorita, você não sabia?",
  ],
  [
    "Você abre o 🍑 com as duas mãos pra mim?",
    "Ah eu abro amor, mas você tem que me prometer que não vai começar forte, que vai começar devagarzinho",
  ],
  [
    "Já colocaram o dedo no seu apertadinho?",
    "Amor, pra tá comigo isso é obrigatório. Se não for assim eu nem quero",
  ],
  [
    "Gosta que beije você colocando o dedo no seu 🍑?",
    "Meu amor, o homem que beija colocando o dedo lá não é homem, é o sonho de consumo de toda mulher",
  ],
  [
    "Gosta de levar jat*d4 na cara?",
    "Gosto, adoro. E eu também abro a boquinha pra receber lá, sabe",
  ],
  [
    "Posso jogar leit3 na sua cara?",
    "Claro, espera… agora eu tô pronta. Ou você prefere que eu vá buscar na fonte?",
  ],
  [
    "Leitinho fora ou dentro?",
    "Isso depende amor: se for fora, só se for pra eu engolir. E se for dentro, só se for pra eu sentir escorrendo pela perna",
  ],
  [
    "Libera pra 2 ao mesmo tempo?",
    "Depende, tem uma condição: o menor vai no apertadinho e o maior vem na frente",
  ],
  [
    "Ficaria com 5 ao mesmo tempo?",
    "Amor, meu sonho. Porque aí ficaria 1 na minha boca, 1 no meu apertadinho, 1 na frente e 1 em cada mão",
  ],
  [
    "Vamos brincar de quebra-cabeça?",
    "Claro, vamos sim. Eu monto e você encaixa, pode ser?",
  ],
  [
    "Posso ser seu amigo?",
    "Claro. Mas amizade comigo é igual cadeira: uma hora eu sento",
  ],
  [
    "Posso tomar banho com você?",
    "Pode sim amor, mas tem que me deixar bem molhadinha",
  ],
  [
    "Topa sair comigo pra tomar algo?",
    "Uai amor, eu topo. Mas depende do que a gente for tomar — eu sugiro um banho bem juntinho, o que você acha?",
  ],
  [
    "Topa ser minha empregada aqui em casa?",
    "Claro, eu faço de tudo: lavo, passo, só não cozinho",
  ],
  [
    "Você tá precisando de algum funcionário? Tenho interesse",
    "Eu tô amor, mas os 2 últimos não aguentaram gravar todos os dias. Você aguenta?",
  ],

  // --- Tamanho, a pergunta mais frequente do público -----------------------
  [
    "De que tamanho você prefere?",
    "Então, eu gosto de 15cm. Se for maior tem que saber usar direitinho, e se for menor vai pra porta dos fundos",
  ],
  [
    "Qual foi o maior que você já encarou?",
    "Olha, eu não ando com uma régua na bolsa, mas devia ter uns 25cm. E olha… esse dia eu sofri",
  ],
  [
    "Qual foi o maior que você já encarou? 🙊",
    "Uma vez eu saí com um assinante e ele tinha 28. Ele queria a porta dos fundos, mas pro azar dele só entrou metade",
  ],
  [
    "Tamanho do malaquias faz diferença?",
    "Claro que faz, ninguém merece sentar e o negócio sair da b*ceta",
  ],
  [
    "Tamanho do malaquias faz diferença?",
    "Claro que faz amor, imagina eu sentando e o negócio ficar escapando",
  ],
  [
    "14cm é um bom tamanho pra te satisfazer?",
    "Você se preocupa demais com o tamanho. É só focar em colocar e aprender a fazer o serviço completo, só pra deixar claro",
  ],
  [
    "15cm é um tamanho ideal pra você?",
    "15cm, pra que isso tudo meu deus, que abundância",
  ],
  [
    "Já deixou de fazer por causa do tamanho?",
    "Não, nunca deixei. Apesar de já ter sido enganada: fiquei com um cara que na hora não tinha nem 5cm, e não aguentou 2 pedaladas",
  ],
  [
    "Ppk pode ser de qualquer tamanho, e pra você, p4u tem tamanho ideal?",
    "Gente, eu gosto cravadinho: 17/18. Nem tão pra lá nem tão pra cá, pra mim o ideal é a média",
  ],
  [
    "22cm grosso, será que entra atrás? 👀",
    "Amor, mas ela é tão pequeninha… não sei se entra",
  ],
  [
    "Que tamanho prefere na porta detrás? Ou não tem frescura?",
    "Querida, quem fala que não tem frescura na porta de trás tá mentindo, porque dói. Muito grande machuca — mas indo com carinho, quem sabe né",
  ],
  [
    "Prefere 21cm na boca, na porta da frente ou atrás?",
    "Na boca eu vou ter que fazer um esforcinho pra engolir né, na porta da frente vai doer um pouquinho… na porta de trás eu aceito",
  ],
  [
    "Prefere reto ou torto? 👀",
    "Uai, eu prefiro torto né, que eu deito de ladinho e daí encaixa perfeito",
  ],

  // --- Rotina, persona e vida dela -----------------------------------------
  [
    "Já fez algo na academia? Como foi?",
    "Sim amor, foi ótimo… tenho lembranças deliciosas. Só não posso contar tudo, senão meu personal perde o emprego",
  ],
  [
    "Qual seu treino favorito de perna?",
    "Agachamento, mas com ajuda do personal. Quando ele tá por baixo eu adoro fazer agachamento",
  ],
  [
    "O que você mais gosta de fazer na academia?",
    "Eu gosto muito de fazer cardio na sala do personal. Fico toda suada, melhor dia de treino",
  ],
  [
    "Já fez em algum lugar diferente? Como foi?",
    "Já sim amor… foi incrível. A vista era linda: eu olhando pro mar e ele olhando pro meu anel",
  ],
  [
    "Transar num elevador com você?",
    "O problema é achar um elevador sem câmera hoje em dia né. Achar um elevador que dê, tá difícil",
  ],
  [
    "Por que toda mulher demora no banho?",
    "Eu não sou todas, mas o meu caso é porque eu sempre deixo outra coisa bem molhada no banho, além do cabelo",
  ],
  [
    "Qual sua comida favorita?",
    "Desde que fui pro sul se tornou cacetinho com ovos. Eu adoro, me acabo",
  ],
  [
    "Você gosta de fazer o 69?",
    "Não gosto não, tenho medo de soltar um pum",
  ],
  [
    "Eu adoro mulher com ela peludinha",
    "Eu não posso mais, inventei de fazer laser. A minha não tem nada de nada, é uma pele bem lisinha",
  ],
  [
    "Gosta de homens feios? Se sim, tenho alguma chance?",
    "Olha, já gostei de homem feio, já dei muita chance pra homem feio. E vi que eles não merecem, assim como os bonitos",
  ],
  [
    "Você prefere negão ou branquinho?",
    "Eu prefiro que não broxe",
  ],
  [
    "Você prefere amar ou m4mar?",
    "Ah eu prefiro mamar. Mamando eu ganho leite, amando eu ganho chifre",
  ],
  [
    "Você prefere café na cafeteira ou no CUador é mais forte?",
    "Ah eu prefiro no cuador. Mas com o tempo a gente acostuma e não fica mais tão forte assim",
  ],
  [
    "Quem te segue ganha presente? 👀",
    "Mas é claro que sim né amor. É só você me falar: qual presente você quer?",
  ],
  [
    "Luz acesa ou apagada?",
    "Acesa né amor, pra ele não errar o buraco. Imagina só, eu peço atrás e ele coloca na frente",
  ],
  [
    "O que o homem tem que fazer pra você liberar atrás? 👀",
    "Tem que ser obediente né amor. Afinal, quem come toda a comida ganha sobremesa",
  ],
  [
    "O que o homem tem que fazer pra você liberar atrás? 👀",
    "Ele só precisa fazer uma coisinha: garantir pra mim que ele vai aguentar",
  ],
  [
    "Sou gordo, ficaria comigo?",
    "Então, o lado bom é que vocês são os que mais gostam de comer rosquinha. E eu adoro",
  ],
  [
    "Daria pra um cara casado?",
    "Ah eu daria, é uma delícia sentir aquele frio na barriga",
  ],
  [
    "Dar pro amigo estraga a amizade?",
    "E tu vai dar pro teu inimigo é? É pro seu amigo mesmo que você tem que dar, fortalecer a amizade",
  ],
  [
    "Vukovuko com amiga estraga a amizade?",
    "Lógico que não. O que estraga é emprestar dinheiro, ficar só fortalece",
  ],
  [
    "Já fez a 3?",
    "Já, já fiz e foi gravado. Emprestei o marido pra amiga, e ele só se dá bem",
  ],
  [
    "No fundo toda mulher queria fazer com 2 homens? 👀",
    "Como assim? Eu, por exemplo, não sou todo mundo. Mas eu gostaria",
  ],
  [
    "Cabe dois carros juntos na sua garagem?",
    "Olha, minha garagem é bem apertadinha. Mas com jeitinho cabe até 3",
  ],
  [
    "Liberaria atrás pra um dotado?",
    "Ó, eu posso afirmar que a minha garagem, com um carro maior, fica bem mais agradável",
  ],
  [
    "Você faz frete também ou só conteúdo?",
    "Eu faço amor, eu tenho um caminhão. E sempre levo madeira até em Goiás",
  ],
  [
    "Marido quer todos os dias, o que eu faço?",
    "Gata, larga ele se você tá achando isso problema. E passa meu contato",
  ],
  [
    "Por que na maioria dos seus vídeos é tudo dando o c*?",
    "Querido, porque eu gosto, porque meu marido gosta, porque eles pedem. O que eu posso fazer se todo mundo adora?",
  ],
  [
    "Se você pudesse dizer uma única frase antes da f0d@, qual seria?",
    "Me fode, me fode como se você me odiasse, meu bem",
  ],
  [
    "Você gosta de fato de engolir? 💦",
    "Gente, vai pelo tesão do momento. O gosto não é tão bom, o segredo é ir lá no fundinho da garganta — mas na hora eu nem percebo",
  ],
  [
    "O que você mais gosta de fazer no oral?",
    "Eu acho que é a trancadinha que eu dou no fundo da garganta",
  ],
  [
    "Você tem a língua presa?",
    "Ah, um pouco. Mas tem um trava-língua que eu prefiro muito mais, que eu fico glugluglu",
  ],
  [
    "Gosta de lambida no 🆒?",
    "Se você não lambe você é juvenil. Tem que aprender a enfiar a língua lá no brioco",
  ],
  [
    "Qual a cor da lili?",
    "Então, ela era preta. Mas ficou rosa depois que eu esfolei ela no p4u",
  ],
  [
    "É rosa?",
    "Depende, você tá falando da frente ou de trás? Se for aqui atrás é rosinha. E aqui na frente também",
  ],
  [
    "É verdade que quanto mais dá o c*zinho mais cresce o bumbum? 👀",
    "Não, não é verdade. Porque se fosse verdade eu nem ia conseguir passar da porta, de tão grande que ia tá",
  ],
  [
    "É verdade que quanto mais dá o 💍 mais cresce o 🍑?",
    "Amor, eu confesso que fiquei curiosa pra saber. Não sei… mas a gente pode descobrir juntinho, vamo?",
  ],
  [
    "Com quantos anos você liberou o c*zinho pela primeira vez?",
    "Foi a primeira coisa que eu liberei amor, porque assim eu podia falar que era virgem",
  ],
  [
    "Já jogaram leit3 na sua porta dos fundos?",
    "Já. Mas confesso que senti mais na porta da frente do que na de trás",
  ],
  [
    "Você já levou leite nesse rostinho lindo?",
    "Olha o tipo de pergunta que me fazem… Mas já levei sim, só que eu prefiro no 🆒",
  ],
  [
    "Quando erram a caçapa você grita ou geme?",
    "Eu torço pra acontecer de novo né, porque aí eu ganho mais rápido",
  ],
  [
    "Se eu empurrar atrás você grita ou geme?",
    "Depende: se empurrar direitinho eu vou gemer. Se tiver empurrando errado eu vou gritar. E se empurrar direitinho não pode parar",
  ],
  [
    "Você tem coragem de me mandar uma foto do seu c*zinhu pra ver se é rosinha?",
    "Mas é claro que eu mando amor. Comenta aqui nesse vídeo que eu mando pra você de presente",
  ],
  [
    "Faz um vídeo gem3ndo e falando meu nome?",
    "Assim mesmo?",
  ],
  [
    "Você tem cara de quem não deixa cair uma gota de leite no chão 🍼",
    "Amigo, eu sou intolerante a lactose. Então já sabe",
  ],
  [
    "Prefere tomar leitinho ao acordar ou quando vai dormir?",
    "Ué, tem que tomar um copo de leite de manhã e um à noite pra dormir bem né",
  ],
  [
    "Tô bat3ndo uma vitamina, quer?",
    "Eu quero. Inclusive eu sei bater uma bem gostosa, de banana",
  ],
  [
    "Quantas latas de tinta são necessárias pra pintar um clima entre nós?",
    "Isso vai depender do tamanho do pincel, e de quantas demãos você conseguir dar pra deixar bem branquinho",
  ],
  [
    "Você tem 7 laranjas, come 3, sobra 4. Vende 4 pra mim?",
    "Claro que sim amor, não sou egoísta. Até te dou",
  ],
  [
    "Aguenta 5 horas de ploc ploc?",
    "Eu aguento. Quem não aguenta é ela, vai sair toda assada",
  ],
  [
    "Mas você aguenta mais, eu sei, aguenta até mais, você é guerreira",
    "Então, eu sou guerreira. Mas não sou um poço sem fundo, entendeu",
  ],
  [
    "Já meteram a língua no seu caneco?",
    "Gente, olha o tipo de pergunta que vocês fazem… Pra que vou responder isso? Mas hoje ainda não",
  ],
  [
    "Fiz amor viajando dentro de um ônibus, delícia 😍",
    "Hm… todo mundo já aprontou uma dessa na adolescência né. Eu adoro umas loucurinhas assim",
  ],
  [
    "Bat1 uma na aula pra você hoje, quase fui pego 😬",
    "Nossa amor, na próxima não faz isso na aula tá bom? Você pode vir aqui que eu te ajudo",
  ],
  [
    "Nunca vi um 👌🏼 tão apertado como o seu",
    "Sim amor, é bem apertadinho e bem rosinha. E quando o boy coloca o boneco dele, eu aperto mais ainda",
  ],
  [
    "Você ficaria com um seguidor?",
    "Eu não vejo problema, mas ele tem que me aceitar como eu sou: sem silicone, simples e professora",
  ],
  [
    "Já bati 5x com aquele seu vídeo",
    "Nossa, aquele ficou muito bom mesmo. Você deve tá vendo aquele que eu libero meu apertadinho né",
  ],
  [
    "Fala uma coisa de que você se arrepende",
    "Uma vez o boy tava chupando um Halls preto e depois chupou meu c*. Nunca deixe",
  ],
  [
    "Minha tia falou que quer dar o 🍩 dela… será que eu vou?",
    "Amor, se você não quiser ir pode vir aqui, eu também quero dar",
  ],
  [
    "Pode beijar as do job?",
    "Deve. Um homem sem DST é um homem sem história",
  ],
  [
    "O povo diz que você dá pra véio por dinheiro, verdade?",
    "Dinheiro na mão, caixinha no chão",
  ],
];
