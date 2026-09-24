// OpenMat service worker: shows alerts ("on deck on Mat 2") and opens the page when tapped.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "OpenMat", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "OpenMat", {
      body: data.body || "",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: { url: data.url || "/" },
      tag: data.title,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url === url && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
