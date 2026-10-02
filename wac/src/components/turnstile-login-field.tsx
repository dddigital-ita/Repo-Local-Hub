"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";

/**
 * Campo nascosto «turnstileToken» per il form di login.
 *
 * Al submit: se il widget ha già un token lo allega; se non c'è ancora (script
 * lazyOnload) ASPETTA fino a 5s e poi re-invia il form con requestSubmit().
 * Solo se il token non arriva per niente si invia vuoto: il server mostra il
 * messaggio anti-bot e l'utente riprova (quando lo script è arrivato).
 *
 * Senza captcha configurato il campo va vuoto e il server NON blocca
 * (verifyTurnstile fail-open con reason "disabled").
 */
export default function TurnstileLoginField() {
  const { pending } = useFormStatus();

  useEffect(() => {
    if (pending) return;
    // Al ritorno da un tentativo fallito: nuovo challenge per il prossimo invio.
    window.wacTurnstile?.reset();
  }, [pending]);

  return (
    <input
      type="hidden"
      name="turnstileToken"
      defaultValue=""
      ref={(el) => {
        if (!el) return;
        const form = el.closest("form");
        if (!form || form.dataset.tsWired === "1") return;
        form.dataset.tsWired = "1";
        form.addEventListener(
          "submit",
          (ev) => {
            if (el.value) return; // token già allegato (secondo passaggio)
            const token = window.wacTurnstile?.getToken();
            if (token) {
              el.value = token;
              return;
            }
            // Nessun token ancora: sospendi l'invio, aspetta il challenge,
            // poi riparti. requestSubmit() ri-attraversa questo listener con
            // il token impostato (nessun loop: il secondo passaggio esce al
            // primo if).
            ev.preventDefault();
            ev.stopPropagation();
            window.wacTurnstile?.readyWithTimeout(5000).then((fresh) => {
              el.value = fresh ?? "";
              form.requestSubmit();
            });
          },
          { capture: true },
        );
      }}
    />
  );
}
