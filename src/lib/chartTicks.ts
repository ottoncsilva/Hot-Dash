/**
 * Marcas "redondas" pro eixo Y de um gráfico, a partir do valor máximo real
 * dos dados — nunca fixas, sempre adaptadas ao range de cada gráfico (ex.:
 * 50/100/150/200 num dia fraco, 5.000/10.000/15.000/20.000 num dia forte).
 *
 * Algoritmo clássico de "nice numbers": arredonda o passo pra 1, 2, 5 ou 10
 * vezes uma potência de 10 — o que deixa as marcas em valores fáceis de ler
 * em vez de frações estranhas tipo "137,33". Fica sempre dentro de [0, max]
 * (nunca ultrapassa o topo do gráfico), então dá pra usar o MESMO `max` que
 * já escala os pontos/barras, sem precisar re-escalar nada.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const passoBruto = max / count;
  const potencia = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  const fracao = passoBruto / potencia;
  const passoNice = fracao < 1.5 ? 1 : fracao < 3 ? 2 : fracao < 7 ? 5 : 10;
  const passo = passoNice * potencia;
  const ticks: number[] = [0];
  for (let v = passo; v <= max + 1e-9; v += passo) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
