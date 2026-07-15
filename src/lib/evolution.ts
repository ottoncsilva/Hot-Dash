import { getEvolutionCredentials } from "./settings";

function getHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
  };
}

export async function createEvolutionInstance(instanceName: string) {
  const creds = getEvolutionCredentials();
  if (!creds) throw new Error("Evolution API não configurada");

  const res = await fetch(`${creds.url}/instance/create`, {
    method: "POST",
    headers: getHeaders(creds.apiKey),
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      // Evolution flags to sync history
      syncFullHistory: true,
      readMessages: false,
      readStatus: false
    })
  });
  if (!res.ok) throw new Error(`Falha ao criar instância: ${await res.text()}`);
  return res.json();
}

export async function connectEvolutionInstance(instanceName: string) {
  const creds = getEvolutionCredentials();
  if (!creds) throw new Error("Evolution API não configurada");

  const res = await fetch(`${creds.url}/instance/connect/${instanceName}`, {
    method: "GET",
    headers: getHeaders(creds.apiKey)
  });
  if (!res.ok) throw new Error(`Falha ao conectar instância: ${await res.text()}`);
  return res.json();
}

export async function logoutEvolutionInstance(instanceName: string) {
  const creds = getEvolutionCredentials();
  if (!creds) throw new Error("Evolution API não configurada");

  const res = await fetch(`${creds.url}/instance/logout/${instanceName}`, {
    method: "DELETE",
    headers: getHeaders(creds.apiKey)
  });
  if (!res.ok) throw new Error(`Falha ao desconectar instância: ${await res.text()}`);
  return res.json();
}

export async function getStateEvolutionInstance(instanceName: string) {
  const creds = getEvolutionCredentials();
  if (!creds) return null;
  try {
    const res = await fetch(`${creds.url}/instance/connectionState/${instanceName}`, {
      method: "GET",
      headers: getHeaders(creds.apiKey)
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function sendEvolutionText(instanceName: string, remoteJid: string, text: string) {
  const creds = getEvolutionCredentials();
  if (!creds) throw new Error("Evolution API não configurada");

  const res = await fetch(`${creds.url}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: getHeaders(creds.apiKey),
    body: JSON.stringify({
      number: remoteJid,
      text: text,
      delay: 2000,
      presence: "composing"
    })
  });
  if (!res.ok) throw new Error(`Falha ao enviar texto: ${await res.text()}`);
  return res.json();
}

export async function sendEvolutionMedia(instanceName: string, remoteJid: string, base64: string, mimetype: string, caption?: string) {
  const creds = getEvolutionCredentials();
  if (!creds) throw new Error("Evolution API não configurada");

  const res = await fetch(`${creds.url}/message/sendMedia/${instanceName}`, {
    method: "POST",
    headers: getHeaders(creds.apiKey),
    body: JSON.stringify({
      number: remoteJid,
      mediaMessage: {
        mediatype: "document",
        caption: caption || "",
        media: base64, // o base64 precisa ser o base64 purinho ou data uri, evolution aceita ambos na v1/v2 normalmente, mas depende
        fileName: "media"
      }
    })
  });
  if (!res.ok) throw new Error(`Falha ao enviar midia: ${await res.text()}`);
  return res.json();
}

export async function setEvolutionWebhook(instanceName: string, webhookUrl: string) {
  const creds = getEvolutionCredentials();
  if (!creds) throw new Error("Evolution API não configurada");

  const EVENTS = [
    "APPLICATION_STARTUP",
    "MESSAGES_UPSERT",
    "MESSAGES_UPDATE",
    "MESSAGES_DELETE",
    "SEND_MESSAGE",
    "CONTACTS_SET",
    "CONTACTS_UPSERT",
    "CONTACTS_UPDATE",
    "PRESENCE_UPDATE",
    "CHATS_SET",
    "CHATS_UPSERT",
    "CHATS_UPDATE",
    "CHATS_DELETE",
    "CONNECTION_UPDATE",
    "CALL"
  ];

  const res = await fetch(`${creds.url}/webhook/set/${instanceName}`, {
    method: "POST",
    headers: getHeaders(creds.apiKey),
    body: JSON.stringify({
      enabled: true,
      url: webhookUrl,
      webhookByEvents: false,
      webhook_by_events: false,
      webhookBase64: false,
      webhook_base64: false,
      events: EVENTS,
      webhook_events: EVENTS
    })
  });
  if (!res.ok) {
    console.error(`Falha ao configurar webhook: ${await res.text()}`);
    // Não vamos lançar erro para não quebrar a criação da instância, mas vamos logar
  } else {
    return res.json();
  }
}
