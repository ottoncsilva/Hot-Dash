/**
 * Cliente de API do frontend. A autenticação é por cookie de sessão
 * (HttpOnly), enviado automaticamente pelo navegador nas chamadas ao backend.
 */
export async function apiGet<T>(path: string): Promise<T> {
  // GET é idempotente: em falha de REDE (fetch rejeita com TypeError — no
  // Safari a mensagem é "Load failed"), tenta de novo algumas vezes com um
  // pequeno intervalo. Isso evita que um blip de rede móvel ou um restart do
  // servidor deixe o painel preso em "Load failed". Erros HTTP (4xx/5xx) NÃO
  // são repetidos — são tratados normalmente em handle().
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      return await handle<T>(res);
    } catch (err) {
      lastErr = err;
      // Só repete se foi falha de rede (TypeError). Erros lançados por handle()
      // (mensagem começando com "Erro" ou vindo do backend) não são de rede.
      const isNetwork = err instanceof TypeError;
      if (!isNetwork || attempt === MAX_ATTEMPTS - 1) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Falha de rede.");
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

/** Envio de arquivo (multipart). */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  if (!onProgress) {
    const res = await fetch(path, { method: "POST", body: form });
    return handle<T>(res);
  }
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          resolve(undefined as unknown as T);
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error || `Erro ${xhr.status}`));
        } catch {
          reject(new Error(`Erro ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Erro de rede"));
    xhr.send(form);
  });
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erro ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
