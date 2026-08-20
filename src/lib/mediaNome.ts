import "server-only";
import { getDb } from "./db";
import { getAppTimeZone } from "./settings";
import { partsInTimeZone } from "./timezone";

/**
 * NOME DOS ARQUIVOS DA GALERIA — `modelo-AAAAMMDD-HHMMSS-0001.jpg`.
 *
 * O arquivo que entra na Galeria não guarda mais o nome que tinha no
 * aparelho. Dois motivos: o nome original costuma ser inútil
 * (`IMG_4821.HEIC`, `WhatsApp Image 2026-08-19 at 22.14.03.jpeg`) e, pior,
 * pode vazar de onde a foto veio — a mesma razão de a rota de upload já
 * limpar os metadados antes de gravar.
 *
 * A data/hora sai no FUSO DA OPERAÇÃO, não em UTC: o container roda em UTC e
 * um arquivo salvo às 22h de Brasília apareceria com a data do dia seguinte.
 *
 * A numeração é por MODELO e só cresce — apagar uma foto não devolve o
 * número, senão dois arquivos diferentes acabariam com o mesmo nome.
 */

/** Reduz o nome da modelo a um pedaço seguro de nome de arquivo. */
export function apelidoDeArquivo(nome: string): string {
  const limpo = (nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira o acento, mantém a letra
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return limpo || "modelo";
}

/** Dois dígitos, para a data/hora não sair torta. */
function dd(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Próximo número desta modelo, guardado em `settings`.
 *
 * Na primeira vez começa de onde a Galeria já está (quantas mídias ela tem),
 * para quem já usa o painel não recomeçar do 1 com trezentas fotos salvas.
 */
function proximaSequencia(profileId: string): number {
  const d = getDb();
  const chave = `media_seq:${profileId}`;
  const row = d.prepare("SELECT value FROM settings WHERE key = ?").get(chave) as
    | { value: string }
    | undefined;

  let atual: number;
  if (row) {
    const n = Number(JSON.parse(row.value));
    atual = Number.isFinite(n) && n > 0 ? n : 0;
  } else {
    const c = d
      .prepare("SELECT COUNT(*) AS n FROM media WHERE profile_id = ?")
      .get(profileId) as { n: number } | undefined;
    atual = c?.n || 0;
  }

  const proximo = atual + 1;
  d.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(chave, JSON.stringify(proximo));
  return proximo;
}

/**
 * Monta o nome do arquivo e CONSOME um número da modelo — chamar duas vezes
 * devolve nomes diferentes, então chame uma vez por arquivo gravado.
 */
export function nomeDeMidia(input: {
  profileId: string;
  nomeModelo: string;
  /** Extensão com o ponto, em minúsculas (ex.: ".jpg"). */
  ext: string;
  /** Instante da gravação; padrão agora. */
  agora?: number;
}): string {
  const p = partsInTimeZone(input.agora ?? Date.now(), getAppTimeZone());
  const data = `${p.year}${dd(p.month)}${dd(p.day)}`;
  const hora = `${dd(p.hour)}${dd(p.minute)}${dd(p.second)}`;
  const n = String(proximaSequencia(input.profileId)).padStart(4, "0");
  return `${apelidoDeArquivo(input.nomeModelo)}-${data}-${hora}-${n}${input.ext.toLowerCase()}`;
}
