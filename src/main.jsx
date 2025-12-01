import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA – registracija service workera + update popup
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("Service Worker registered:", registration.scope);

        // ako već ima waiting SW (deployao si novu verziju)
        if (registration.waiting) {
          showUpdatePrompt(registration.waiting);
        }

        // novi SW pronađen (update)
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // nova verzija spremna
              showUpdatePrompt(newWorker);
            }
          });
        });
      })
      .catch((err) => {
        console.error("Service Worker registration failed:", err);
      });

    // automatski reload kad SW preuzme kontrolu
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

// jednostavan popup za update – možeš kasnije zamijeniti React bannnerom
function showUpdatePrompt(worker) {
  const shouldUpdate = window.confirm(
    "Nova verzija Alive Chat je dostupna. Želiš osvježiti aplikaciju?"
  );

  if (shouldUpdate) {
    worker.postMessage({ type: "SKIP_WAITING" });
  }
}
