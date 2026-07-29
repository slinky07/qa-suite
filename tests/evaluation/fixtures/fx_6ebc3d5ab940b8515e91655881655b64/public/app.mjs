const recoveryCompletes = true;

export function mountRecoveryConsole(documentObject) {
  const form = documentObject.querySelector("#recovery-form");
  const action = documentObject.querySelector("#start-recovery");
  const status = documentObject.querySelector("#recovery-status");
  if (!form || !action || !status) {
    throw new Error("Recovery Console markup is incomplete.");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    action.disabled = true;
    status.textContent = "Starting recovery…";
    if (!recoveryCompletes) return;
    status.textContent = "Recovery completed.";
    action.disabled = false;
  });
}

if (typeof document !== "undefined") {
  mountRecoveryConsole(document);
}
