// ArcScale EDMS — Push Notification Service Worker

const CACHE_VERSION = "edms-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Handle push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "ArcScale EDMS", body: event.data.text() };
  }
  const title = data.title ?? "ArcScale EDMS";
  const options = {
    body: data.body ?? data.message ?? "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag ?? "edms-notification",
    data: { url: data.actionUrl ?? "/" },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click — navigate to actionUrl
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
