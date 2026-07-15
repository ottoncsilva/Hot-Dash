import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";
import { callAiRaw } from "./ai";
import { sendEvolutionText, sendEvolutionMedia } from "./evolution";
import { readFileSync } from "fs";
import { randomDelay } from "./randomDelay";
import { resolve } from "path";

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

  // Fetch available tags for this profile's images
  const tagsRow = db.prepare(`
    SELECT DISTINCT t.name 
    FROM tags t
    JOIN media_tags mt ON mt.tag_id = t.id
    JOIN media m ON m.id = mt.media_id
    WHERE m.profile_id = ? AND m.kind = 'image'
  `).all(profileId) as { name: string }[];
  
  const availableTags = tagsRow.map(t => t.name);
  const tagsListString = availableTags.length > 0 
    ? `[${availableTags.join(", ")}]` 
    : "NENHUMA (a modelo não possui imagens cadastradas, envie apenas texto)";

  const systemConstraint = `
VOCÊ DEVE RESPONDER EXCLUSIVAMENTE NO FORMATO JSON ABAIXO. NÃO ADICIONE NENHUM TEXTO FORA DO JSON.
SEU OBJETIVO É CONTINUAR A CONVERSA COMO A PERSONA DEFINIDA.

FORMATO OBRIGATÓRIO:
{
  "tipo": "texto" ou "imagem",
  "resposta": "Sua mensagem de texto aqui",
  "prompt_imagem": "Se tipo for imagem, ESCOLHA EXATAMENTE UMA DAS ETIQUETAS DISPONÍVEIS ABAIXO. Se tipo for texto, deixe vazio."
}

ETIQUETAS DE IMAGEM DISPONÍVEIS PARA VOCÊ ESCOLHER:
${tagsListString}

REGRAS:
- Se "tipo" for "texto", o sistema enviará apenas a "resposta".
- Se "tipo" for "imagem", você deve obrigatoriamente preencher "prompt_imagem" com UMA das etiquetas da lista acima (exatamente como escrita). O sistema buscará uma foto real no banco de dados com essa etiqueta e a enviará com a sua "resposta" como legenda.
- Se a lista de etiquetas for 'NENHUMA', NUNCA envie tipo 'imagem'.
- Siga rigorosamente as instruções da persona. Mantenha mensagens curtas, como WhatsApp real.
${enableMedia ? "" : "- O envio de imagens está DESATIVADO nas configurações. Use SEMPRE tipo: 'texto'."}
  `.trim();

  const fullSystemPrompt = `${basePrompt}\n\n${systemConstraint}`;

  const messagesPayload = [
    { role: "system", content: fullSystemPrompt },
    ...msgs.map(m => ({ role: m.role, content: m.content }))
  ];

  try {
    // 3. Call the AI using the provider configured for this model
    const provider = agentRow.ai_provider || "grok";
    const rawAiResponse = await callAiRaw(
      JSON.stringify(messagesPayload),
      provider,
      { maxTokens: 500 },
    );

    if (!rawAiResponse) throw new Error("IA retornou vazio");

    // Clean possible markdown fences and parse JSON
    const cleanJsonText = rawAiResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const result = JSON.parse(cleanJsonText) as {
      tipo: string;
      resposta: string;
      prompt_imagem: string;
    };

    // Determine final type respecting media enable flag
    const tipo = result.tipo === "imagem" && enableMedia ? "imagem" : "texto";
    let resposta = result.resposta || "Oi...";

    // Append Pix key (telefone, CNPJ ou CPF) if configured
    const pixKey = agentRow.pix_key;
    if (pixKey) {
      resposta = `${resposta}\nPix: ${pixKey}`;
    }

    // Simulate typing delay (4‑6 s)
    await new Promise(r => setTimeout(r, randomDelay()));

    // 4. Execute the send action via Evolution API
    if (tipo === "imagem") {
      // Buscar a imagem com a etiqueta exata pedida, ou aleatória como fallback se não achar
      let mediaRow = db.prepare(`
        SELECT m.* 
        FROM media m
        JOIN media_tags mt ON mt.media_id = m.id
        JOIN tags t ON t.id = mt.tag_id
        WHERE m.profile_id = ? AND m.kind = 'image' AND t.name = ?
        ORDER BY RANDOM() LIMIT 1
      `).get(profileId, result.prompt_imagem || "") as any;

      if (!mediaRow) {
        // Fallback para qualquer imagem aleatória se a etiqueta não bater ou não existir
        mediaRow = db.prepare(`
          SELECT * FROM media 
          WHERE profile_id = ? AND kind = 'image' 
          ORDER BY RANDOM() LIMIT 1
        `).get(profileId) as any;
      }

      if (mediaRow) {
        const baseDir = resolve(process.env.MEDIA_STORAGE_DIR || "/app/data");
        const fullPath = resolve(baseDir, mediaRow.path);
        const fileBuffer = readFileSync(fullPath);
        const base64 = fileBuffer.toString("base64");
        await sendEvolutionMedia(
          instanceName,
          remoteJid,
          base64,
          mediaRow.mime || "image/jpeg",
          resposta,
        );
      } else {
        // Fallback to text if no image is available
        await sendEvolutionText(instanceName, remoteJid, resposta);
      }
    } else {
      await sendEvolutionText(instanceName, remoteJid, resposta);
    }

    // 5. Save the AI response into the history (store full response)
    db.prepare(`
      INSERT INTO whatsapp_messages (id, chat_id, role, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), chatId, "assistant", resposta, tipo, Date.now());
// Duplicate block removed - original duplicated logic omitted
  } catch (err: any) {
    console.error("Erro no Agente de WhatsApp:", err);
  }
}
