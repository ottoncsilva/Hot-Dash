"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/components/ui/Toast";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushNotificationButton() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setIsSupported(true);
      checkSubscription();
    }
  }, []);

  async function checkSubscription() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (e) {
      console.error(e);
    }
  }

  async function subscribe() {
    try {
      const res = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await res.json();
      const convertedVapidKey = urlBase64ToUint8Array(publicKey);

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
        headers: {
          "content-type": "application/json",
        },
      });

      setIsSubscribed(true);
      showToast({ title: "Notificações Ativadas", type: "success" });
    } catch (err) {
      console.error(err);
      showToast({ title: "Erro ao ativar notificações", type: "error" });
    }
  }

  if (!isSupported || isSubscribed) {
    return null;
  }

  return (
    <button
      onClick={subscribe}
      className="ml-auto inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition"
    >
      Ativar Notificações (PWA)
    </button>
  );
}
