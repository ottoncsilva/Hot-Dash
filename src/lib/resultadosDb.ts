/**
 * MEMÓRIA DOS RESULTADOS gerados (imagem e vídeo).
 *
 * Antes o que saía dos geradores vivia só em estado do React: recarregar a
 * página, trocar de menu ou fechar a aba jogava fora imagem e vídeo que ainda
 * não tinham sido salvos — e cada um deles custou dinheiro de verdade.
 *
 * Guarda em IndexedDB porque o conteúdo é BLOB (um vídeo de 8s passa fácil de
 * 1 MB) — localStorage só guarda texto e estoura em poucos megabytes. O item
 * sai daqui quando é salvo na Galeria (aí já tem lugar definitivo) ou quando
 * o operador descarta.
 */

const DB_NOME = "hotdash-geradores";
const DB_VERSAO = 1;
const STORE = "resultados";

export type TipoResultado = "imagem" | "video";

export type ResultadoGerado = {
  id: string;
  tipo: TipoResultado;
  blob: Blob;
  mediaType: string;
  /** Custo real da geração, quando o provedor informou. */
  costUsd?: number;
  /** Resumo dos parâmetros, ex.: "2K · 9:16" ou "8s · 720p · 9:16". */
  legenda: string;
  createdAt: number;
};

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível neste navegador."));
      return;
    }
    const req = indexedDB.open(DB_NOME, DB_VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("tipo", "tipo", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Falha ao abrir o banco local."));
  });
}

function transacao<T>(
  modo: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, modo);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Falha no banco local."));
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Os resultados de um gerador, do mais novo para o mais velho. */
export async function listarResultados(tipo: TipoResultado): Promise<ResultadoGerado[]> {
  try {
    const todos = await transacao<ResultadoGerado[]>("readonly", (s) => s.getAll());
    return todos.filter((r) => r.tipo === tipo).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    // Navegador sem IndexedDB (ou modo privado bloqueando): o gerador segue
    // funcionando, só sem memória entre recarregamentos.
    return [];
  }
}

export async function salvarResultado(item: ResultadoGerado): Promise<void> {
  try {
    await transacao("readwrite", (s) => s.put(item));
  } catch {
    // Sem memória local, o item continua na tela pela sessão atual.
  }
}

export async function removerResultado(id: string): Promise<void> {
  try {
    await transacao("readwrite", (s) => s.delete(id));
  } catch {
    /* nada a fazer: a remoção da tela já aconteceu */
  }
}
