/**
 * Cliente de API do frontend. A autenticação é por cookie de sessão
 * (HttpOnly), enviado automaticamente pelo navegador nas chamadas ao backend.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return handle<T>(res);
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
