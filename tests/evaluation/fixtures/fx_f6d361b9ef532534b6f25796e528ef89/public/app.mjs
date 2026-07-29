const compactTargetCompletes = true;

export function mountMessageComposer(documentObject, windowObject) {
  const form = documentObject.querySelector("#message-form");
  const action = documentObject.querySelector("#send-message");
  const status = documentObject.querySelector("#message-status");
  if (!form || !action || !status) {
    throw new Error("Message Composer markup is incomplete.");
  }

  const isCompactTarget = windowObject
    .matchMedia("(max-width: 480px)")
    .matches;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    action.disabled = true;
    status.textContent = "Sending…";
    if (isCompactTarget && !compactTargetCompletes) return;
    status.textContent = "Message sent.";
    action.disabled = false;
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  mountMessageComposer(document, window);
}
