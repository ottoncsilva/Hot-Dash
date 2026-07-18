import webpush from "web-push";
import { getDb } from "./db";
import { randomUUID } from "crypto";

type VapidKeys = {
  publicKey: string;
  privateKey: string;
};

let initialized = false;

function getVapidKeys(): VapidKeys {
  const db = getDb();
  let row = db.prepare("SELECT value FROM settings WHERE key = 'vapid_keys'").get() as { value: string } | undefined;
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare("INSERT INTO settings (key, value) VALUES ('vapid_keys', ?)").run(JSON.stringify(keys));
    return keys;
  }
  return JSON.parse(row.value) as VapidKeys;
}

export function initWebPush() {
  if (initialized) return;
  const keys = getVapidKeys();
  webpush.setVapidDetails(
    "mailto:contato@hotdash.com",
    keys.publicKey,
    keys.privateKey
  );
  initialized = true;
}

export function getVapidPublicKey() {
  return getVapidKeys().publicKey;
}

export function saveSubscription(subscription: any) {
  const db = getDb();
  // Pra evitar duplicação, exclui pela url do endpoint antes (pois o endpoint é único por browser)
  db.prepare("DELETE FROM push_subscriptions WHERE json_extract(subscription_json, '$.endpoint') = ?").run(subscription.endpoint);
  
  db.prepare("INSERT INTO push_subscriptions (id, subscription_json, created_at) VALUES (?, ?, ?)")
    .run(randomUUID(), JSON.stringify(subscription), Date.now());
}

export function removeSubscription(endpoint: string) {
  const db = getDb();
  db.prepare("DELETE FROM push_subscriptions WHERE json_extract(subscription_json, '$.endpoint') = ?").run(endpoint);
}

export async function sendPushToAll(title: string, body: string, url: string) {
  initWebPush();
  const db = getDb();
  const subs = db.prepare("SELECT id, subscription_json FROM push_subscriptions").all() as { id: string, subscription_json: string }[];
  
  const payload = JSON.stringify({
    title,
    body,
    url
  });

  for (const sub of subs) {
    try {
      const parsed = JSON.parse(sub.subscription_json);
      await webpush.sendNotification(parsed, payload);
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Inscrição expirou ou foi removida pelo usuário
        db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      } else {
        console.error("Erro ao enviar push:", err);
      }
    }
  }
}
