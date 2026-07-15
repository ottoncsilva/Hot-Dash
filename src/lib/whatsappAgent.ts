import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";
import { callRawAi } from "./ai";
import { sendEvolutionText, sendEvolutionMedia } from "./evolution";
import { readFileSync } from "fs";

export async function processWhatsappAgent(chatId: string, profileId: string, remoteJid: string, instanceName: string) {
  const db = getDb();
  
  // 1. Coleta o Agente (Prompt e Permissoes)
  const agentRow = db.prepare(`SELECT * FROM whatsapp_agent_settings WHERE profile_id = ?`).get(profileId) as any;
  if (!agentRow) return;

  const basePrompt = agentRow.prompt;
  const enableMedia = Boolean(agentRow.enable_media);

  // 2. Coleta o Histórico de Mensagens (ultimas 20)
  const msgs = db.prepare(`
    SELECT role, content FROM whatsapp_messages 
    WHERE chat_id = ? 
    ORDER BY created_at ASC 
    LIMIT 20
  `).all(chatId) as { role: "user" | "assistant", content: string }[];

  const systemConstraint = `
VOCÊ DEVE RESPONDER EXCLUSIVAMENTE NO FORMATO JSON ABAIXO. NÃO ADICIONE NENHUM TEXTO FORA DO JSON.
SEU OBJETIVO É CONTINUAR A CONVERSA COMO A PERSONA DEFINIDA.

FORMATO OBRIGATÓRIO:
{
  "tipo": "texto" ou "imagem",
  "resposta": "Sua mensagem de texto aqui",
  "prompt_imagem": "Se tipo for imagem, descreva a foto aqui em 5 palavras. Se tipo for texto, deixe vazio."
}

REGRAS:
- Se "tipo" for "texto", o sistema enviará apenas a "resposta".
- Se "tipo" for "imagem", o sistema buscará uma foto na galeria que combine com "prompt_imagem" e a enviará com a "resposta" como legenda.
- Siga rigorosamente as instruções da persona. Mantenha mensagens curtas, como WhatsApp real.
${enableMedia ? "" : "- O envio de imagens está DESATIVADO. Use SEMPRE tipo: 'texto'."}
  `.trim();

  const fullSystemPrompt = `${basePrompt}\n\n${systemConstraint}`;

  const messagesPayload = [
    { role: "system", content: fullSystemPrompt },
    ...msgs.map(m => ({ role: m.role, content: m.content }))
  ];

  try {
    // 3. Chama a IA (usando Grok, provider fixo na fase atual ou podemos ler do settings)
    const rawAiResponse = await callRawAi({
      provider: "grok",
      messages: messagesPayload as any,
      maxTokens: 500,
      temperature: 0.8,
    });

    if (!rawAiResponse.text) throw new Error("IA retornou vazio");

    // Remove code blocks (markdown) if present
    const cleanJsonText = rawAiResponse.text.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleanJsonText) as { tipo: string; resposta: string; prompt_imagem: string };

    const tipo = result.tipo === "imagem" && enableMedia ? "imagem" : "texto";
    const resposta = result.resposta || "Oi...";
    const promptImagem = result.prompt_imagem || "";

    // 4. Executa a Ação de Envio (Evolution API)
    if (tipo === "imagem") {
      // Tenta achar uma imagem aleatória (ou pode usar FTS/busca semântica depois)
      const mediaRow = db.prepare(`
        SELECT * FROM media 
        WHERE profile_id = ? AND kind = 'image' 
        ORDER BY RANDOM() LIMIT 1
      `).get(profileId) as any;

      if (mediaRow) {
        const fileBuffer = readFileSync(mediaRow.path);
        const base64 = fileBuffer.toString("base64");
        await sendEvolutionMedia(instanceName, remoteJid, base64, mediaRow.mime || "image/jpeg", resposta);
      } else {
        // Fallback pra texto se nao tem imagem
        await sendEvolutionText(instanceName, remoteJid, resposta);
      }
    } else {
      await sendEvolutionText(instanceName, remoteJid, resposta);
    }

    // 5. Salva a resposta da IA no histórico
    db.prepare(`
      INSERT INTO whatsapp_messages (id, chat_id, role, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), chatId, "assistant", resposta, tipo, Date.now());

  } catch (err: any) {
    console.error("Erro no Agente de WhatsApp:", err);
  }
}
