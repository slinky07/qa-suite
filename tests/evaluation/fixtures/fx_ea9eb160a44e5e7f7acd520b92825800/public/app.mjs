export function createNote({ title, note }, now = new Date()) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const normalizedNote = typeof note === "string" ? note.trim() : "";
  if (normalizedTitle.length === 0 || normalizedNote.length === 0) {
    throw new Error("A title and note are required.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new Error("A valid creation time is required.");
  }
  return {
    created_at: now.toISOString(),
    note: normalizedNote,
    title: normalizedTitle,
  };
}

export function normalizeDisplayPreferences({
  compactCards,
  showTimestamps,
}) {
  return {
    compact_cards: Boolean(compactCards),
    show_timestamps: Boolean(showTimestamps),
  };
}

function requiredElement(document, selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Pocket Notes requires ${selector}.`);
  }
  return element;
}

function renderNote(document, list, note, showTimestamps) {
  const card = document.createElement("article");
  card.className = "note-card";

  const title = document.createElement("h3");
  title.textContent = note.title;

  const body = document.createElement("p");
  body.textContent = note.note;

  const timestamp = document.createElement("time");
  timestamp.dateTime = note.created_at;
  timestamp.hidden = !showTimestamps;
  timestamp.textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(note.created_at));

  card.append(title, body, timestamp);
  list.prepend(card);
}

export function mountPocketNotes(document) {
  const form = requiredElement(document, "#note-form");
  const title = requiredElement(document, "#note-title");
  const note = requiredElement(document, "#note-text");
  const compactCards = requiredElement(document, "#compact-cards");
  const showTimestamps = requiredElement(document, "#show-timestamps");
  const noteList = requiredElement(document, "#notes-list");
  const emptyState = requiredElement(document, "#empty-state");
  const status = requiredElement(document, "#status");

  function currentPreferences() {
    return normalizeDisplayPreferences({
      compactCards: compactCards.checked,
      showTimestamps: showTimestamps.checked,
    });
  }

  function applyPreferences(announce) {
    const preferences = currentPreferences();
    noteList.classList.toggle("compact-cards", preferences.compact_cards);
    for (const timestamp of noteList.querySelectorAll("time")) {
      timestamp.hidden = !preferences.show_timestamps;
    }
    if (announce) {
      status.textContent = "Display preferences updated.";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const created = createNote({
      note: note.value,
      title: title.value,
    });
    const preferences = currentPreferences();
    renderNote(
      document,
      noteList,
      created,
      preferences.show_timestamps,
    );
    emptyState.hidden = true;
    status.textContent = `Added note “${created.title}”.`;
    title.value = "";
    note.value = "";
    title.focus();
  });

  for (const preference of [compactCards, showTimestamps]) {
    preference.addEventListener("change", () => applyPreferences(true));
  }

  applyPreferences(false);
}

if (typeof document !== "undefined") {
  mountPocketNotes(document);
}
