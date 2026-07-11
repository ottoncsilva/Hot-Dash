import "server-only";
import { createSign } from "node:crypto";
import { getDb } from "./db";
import {
  getGoogleSheetsCredentials,
  getGoogleSheetsShareEmail,
  isGoogleSheetsEnabled,
} from "./settings";
import { listTags } from "./tags";
import type { MediaItem, Tag } from "./types";

/**
 * Cliente do Google Sheets/Drive sem dependências externas: assina o JWT da
 * conta de serviço com node:crypto (RS256) e fala REST puro via fetch. Segue
 * o mesmo princípio do zip.ts — evita os problemas de bundling que o pacote
 * "googleapis" traria no Next.js.
 *
 * Cada perfil tem uma planilha própria (profiles.sheet_id/sheet_gid). Uma
 * coluna oculta "ID interno" guarda o id da mídia para localizar linhas em
 * updates/exclusões — assim a sincronização sobrevive mesmo se o usuário
 * reordenar colunas manualmente na planilha.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";
const SHEET_TITLE = "Mídia";
const ID_HEADER = "ID interno (não editar)";
const FIXED_HEADERS = [
  "Nome arquivo",
  "Data criação",
  "Nome modelo",
  "Tipo",
  "Link público",
];

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const creds = getGoogleSheetsCredentials();
  if (!creds) throw new Error("Credenciais do Google Sheets não configuradas.");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(creds.privateKey).toString("base64url");
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao autenticar com o Google (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apiFetch(url: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Google API (${res.status}): ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function checkboxValidationRequest(sheetGid: number, colIndex: number) {
  return {
    setDataValidation: {
      range: {
        sheetId: sheetGid,
        startRowIndex: 1,
        endRowIndex: 2000,
        startColumnIndex: colIndex,
        endColumnIndex: colIndex + 1,
      },
      rule: { condition: { type: "BOOLEAN" }, strict: true, showCustomUi: true },
    },
  };
}

async function shareSpreadsheet(spreadsheetId: string, email: string): Promise<void> {
  await apiFetch(`${DRIVE_API}/${spreadsheetId}/permissions?sendNotificationEmail=false`, {
    method: "POST",
    body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
  });
}

async function createSpreadsheetForProfile(
  profileName: string,
  tags: Tag[],
): Promise<{ spreadsheetId: string; sheetGid: number }> {
  const headers = [...FIXED_HEADERS, ...tags.map((t) => t.name), ID_HEADER];
  const created = await apiFetch(SHEETS_API, {
    method: "POST",
    body: JSON.stringify({
      properties: { title: `Hot Dash — ${profileName}` },
      sheets: [
        {
          properties: { title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: headers.map((h) => ({
                    userEnteredValue: { stringValue: h },
                    userEnteredFormat: { textFormat: { bold: true } },
                  })),
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  const spreadsheetId = created.spreadsheetId as string;
  const sheetGid = created.sheets[0].properties.sheetId as number;

  const idColIndex = headers.length - 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [
    {
      updateDimensionProperties: {
        range: { sheetId: sheetGid, dimension: "COLUMNS", startIndex: idColIndex, endIndex: idColIndex + 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
  ];
  for (let i = 0; i < tags.length; i++) {
    requests.push(checkboxValidationRequest(sheetGid, FIXED_HEADERS.length + i));
  }
  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  const shareEmail = getGoogleSheetsShareEmail();
  if (shareEmail) {
    await shareSpreadsheet(spreadsheetId, shareEmail);
  }

  return { spreadsheetId, sheetGid };
}

async function getHeaderRow(spreadsheetId: string): Promise<string[]> {
  const data = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${SHEET_TITLE}!1:1`)}`,
  );
  return (data.values?.[0] || []) as string[];
}

async function findMediaRow(
  spreadsheetId: string,
  mediaId: string,
): Promise<{ rowIndex: number; headers: string[] } | null> {
  const headers = await getHeaderRow(spreadsheetId);
  const idCol = headers.indexOf(ID_HEADER);
  if (idCol === -1) return null;
  const letter = columnLetter(idCol);
  const data = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${SHEET_TITLE}!${letter}2:${letter}`)}`,
  );
  const ids: string[] = (data.values || []).map((r: string[]) => r[0]);
  const idx = ids.indexOf(mediaId);
  if (idx === -1) return null;
  return { rowIndex: idx + 2, headers };
}

function getProfileSheetInfo(
  profileId: string,
): { sheetId: string; sheetGid: number | null; profileName: string } | null {
  const row = getDb()
    .prepare("SELECT sheet_id, sheet_gid, name FROM profiles WHERE id = ?")
    .get(profileId) as { sheet_id: string | null; sheet_gid: number | null; name: string } | undefined;
  if (!row || !row.sheet_id) return null;
  return { sheetId: row.sheet_id, sheetGid: row.sheet_gid, profileName: row.name };
}

/** Garante que o perfil tem uma planilha, criando-a na primeira vez. */
async function ensureProfileSheet(profileId: string): Promise<{ sheetId: string; sheetGid: number }> {
  const existing = getProfileSheetInfo(profileId);
  if (existing && existing.sheetGid !== null) {
    return { sheetId: existing.sheetId, sheetGid: existing.sheetGid };
  }

  const profileRow = getDb()
    .prepare("SELECT name FROM profiles WHERE id = ?")
    .get(profileId) as { name: string } | undefined;
  if (!profileRow) throw new Error("Perfil não encontrado.");

  const { spreadsheetId, sheetGid } = await createSpreadsheetForProfile(profileRow.name, listTags());
  getDb()
    .prepare("UPDATE profiles SET sheet_id = ?, sheet_gid = ? WHERE id = ?")
    .run(spreadsheetId, sheetGid, profileId);
  return { sheetId: spreadsheetId, sheetGid };
}

function cellValueFor(
  header: string,
  item: MediaItem,
  publicUrl: string,
  profileName: string,
): unknown {
  if (header === "Nome arquivo") return item.filename;
  if (header === "Data criação") return new Date(item.createdAt).toISOString().slice(0, 10);
  if (header === "Nome modelo") return profileName;
  if (header === "Tipo") return item.kind === "video" ? "Vídeo" : "Foto";
  if (header === "Link público") return publicUrl;
  if (header === ID_HEADER) return item.id;
  return item.tags.some((t) => t.name === header);
}

/** Adiciona uma linha para a mídia recém-enviada — cria a planilha do perfil se ainda não existir. */
export async function appendMediaRow(
  profileId: string,
  item: MediaItem,
  publicUrl: string,
): Promise<void> {
  if (!isGoogleSheetsEnabled()) return;
  try {
    const { sheetId } = await ensureProfileSheet(profileId);
    const info = getProfileSheetInfo(profileId)!;
    const headers = await getHeaderRow(sheetId);
    const values = headers.map((h) => cellValueFor(h, item, publicUrl, info.profileName));
    await apiFetch(
      `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(`${SHEET_TITLE}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: [values] }) },
    );
  } catch (err) {
    console.error("[google-sheets] falha ao adicionar linha:", err);
  }
}

/** Remove a linha da mídia excluída (se a planilha do perfil existir). */
export async function deleteMediaRow(profileId: string, mediaId: string): Promise<void> {
  if (!isGoogleSheetsEnabled()) return;
  try {
    const info = getProfileSheetInfo(profileId);
    if (!info || info.sheetGid === null) return;
    const found = await findMediaRow(info.sheetId, mediaId);
    if (!found) return;
    await apiFetch(`${SHEETS_API}/${info.sheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: info.sheetGid,
                dimension: "ROWS",
                startIndex: found.rowIndex - 1,
                endIndex: found.rowIndex,
              },
            },
          },
        ],
      }),
    });
  } catch (err) {
    console.error("[google-sheets] falha ao remover linha:", err);
  }
}

/** Marca/desmarca o checkbox de uma etiqueta para a mídia informada. */
export async function updateMediaTagCell(
  profileId: string,
  mediaId: string,
  tagName: string,
  checked: boolean,
): Promise<void> {
  if (!isGoogleSheetsEnabled()) return;
  try {
    const info = getProfileSheetInfo(profileId);
    if (!info) return;
    const found = await findMediaRow(info.sheetId, mediaId);
    if (!found) return;
    const colIndex = found.headers.indexOf(tagName);
    if (colIndex === -1) return;
    const letter = columnLetter(colIndex);
    await apiFetch(
      `${SHEETS_API}/${info.sheetId}/values/${encodeURIComponent(`${SHEET_TITLE}!${letter}${found.rowIndex}`)}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values: [[checked]] }) },
    );
  } catch (err) {
    console.error("[google-sheets] falha ao atualizar etiqueta:", err);
  }
}

function allProfileSheets(): { id: string; sheetId: string; sheetGid: number }[] {
  return getDb()
    .prepare(
      "SELECT id, sheet_id AS sheetId, sheet_gid AS sheetGid FROM profiles WHERE sheet_id IS NOT NULL AND sheet_gid IS NOT NULL",
    )
    .all() as { id: string; sheetId: string; sheetGid: number }[];
}

/** Adiciona a coluna (com checkbox) da nova etiqueta em todas as planilhas já criadas. */
export async function onTagCreated(tag: Tag): Promise<void> {
  if (!isGoogleSheetsEnabled()) return;
  for (const p of allProfileSheets()) {
    try {
      await addOrRenameTagColumn(p.sheetId, p.sheetGid, null, tag.name);
    } catch (err) {
      console.error("[google-sheets] falha ao criar coluna de etiqueta:", err);
    }
  }
}

/** Renomeia o cabeçalho da coluna da etiqueta em todas as planilhas. */
export async function onTagRenamed(oldName: string, newName: string): Promise<void> {
  if (!isGoogleSheetsEnabled() || oldName === newName) return;
  for (const p of allProfileSheets()) {
    try {
      await addOrRenameTagColumn(p.sheetId, p.sheetGid, oldName, newName);
    } catch (err) {
      console.error("[google-sheets] falha ao renomear coluna de etiqueta:", err);
    }
  }
}

/** Remove a coluna da etiqueta excluída em todas as planilhas. */
export async function onTagDeleted(tagName: string): Promise<void> {
  if (!isGoogleSheetsEnabled()) return;
  for (const p of allProfileSheets()) {
    try {
      const headers = await getHeaderRow(p.sheetId);
      const colIndex = headers.indexOf(tagName);
      if (colIndex === -1) continue;
      await apiFetch(`${SHEETS_API}/${p.sheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              deleteDimension: {
                range: { sheetId: p.sheetGid, dimension: "COLUMNS", startIndex: colIndex, endIndex: colIndex + 1 },
              },
            },
          ],
        }),
      });
    } catch (err) {
      console.error("[google-sheets] falha ao remover coluna de etiqueta:", err);
    }
  }
}

async function addOrRenameTagColumn(
  spreadsheetId: string,
  sheetGid: number,
  oldName: string | null,
  newName: string,
): Promise<void> {
  const headers = await getHeaderRow(spreadsheetId);

  if (oldName) {
    const idx = headers.indexOf(oldName);
    if (idx !== -1) {
      await apiFetch(
        `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${SHEET_TITLE}!${columnLetter(idx)}1`)}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: [[newName]] }) },
      );
      return;
    }
  }

  if (headers.includes(newName)) return;
  const idCol = headers.indexOf(ID_HEADER);
  const insertAt = idCol === -1 ? headers.length : idCol;

  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: { sheetId: sheetGid, dimension: "COLUMNS", startIndex: insertAt, endIndex: insertAt + 1 },
            inheritFromBefore: false,
          },
        },
      ],
    }),
  });
  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${SHEET_TITLE}!${columnLetter(insertAt)}1`)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [[newName]] }) },
  );
  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [checkboxValidationRequest(sheetGid, insertAt)] }),
  });
}
