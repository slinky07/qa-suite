const projects = [
  {
    description: "Refresh the mobile navigation and release checklist.",
    name: "Atlas Mobile",
    status: "active",
  },
  {
    description: "Document the component library and usage examples.",
    name: "Beacon Design System",
    status: "planning",
  },
  {
    description: "Prepare the customer import workflow for launch.",
    name: "Harbor Importer",
    status: "active",
  },
  {
    description: "Archive the completed reporting migration.",
    name: "Juniper Reports",
    status: "complete",
  },
];

export function filterProjects(items, { query, status }) {
  const normalizedQuery =
    typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
  const normalizedStatus =
    typeof status === "string" ? status.trim().toLocaleLowerCase() : "all";
  return items.filter((project) => {
    const queryMatches =
      normalizedQuery.length === 0 ||
      project.name.toLocaleLowerCase().includes(normalizedQuery);
    const statusMatches =
      normalizedStatus === "all" || project.status === normalizedStatus;
    return queryMatches && statusMatches;
  });
}

function requiredElement(document, selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Project Finder requires ${selector}.`);
  }
  return element;
}

function renderProject(document, project) {
  const card = document.createElement("article");
  card.className = "project-card";

  const heading = document.createElement("h3");
  heading.textContent = project.name;

  const description = document.createElement("p");
  description.textContent = project.description;

  const status = document.createElement("span");
  status.className = `status-badge status-${project.status}`;
  status.textContent = project.status;

  card.append(heading, description, status);
  return card;
}

export function mountProjectFinder(document) {
  const filterPanel = requiredElement(document, "#filter-panel");
  const form = requiredElement(document, "#filter-form");
  const query = requiredElement(document, "#project-query");
  const projectStatus = requiredElement(document, "#project-status");
  const editFilters = requiredElement(document, "#edit-filters");
  const resultCount = requiredElement(document, "#result-count");
  const resultList = requiredElement(document, "#results-list");
  const noResults = requiredElement(document, "#no-results");
  const searchHelp = requiredElement(document, "#search-help");
  const liveStatus = requiredElement(document, "#status");

  function render(matches, announce) {
    resultList.replaceChildren(
      ...matches.map((project) => renderProject(document, project)),
    );
    resultCount.textContent =
      `${matches.length} ${matches.length === 1 ? "project" : "projects"}`;
    noResults.hidden = matches.length !== 0;
    if (announce) {
      liveStatus.textContent =
        matches.length === 0
          ? "No projects matched the current filters."
          : `${resultCount.textContent} shown.`;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render(
      filterProjects(projects, {
        query: query.value,
        status: projectStatus.value,
      }),
      true,
    );
    filterPanel.hidden = true;
    searchHelp.open = false;
  });

  editFilters.addEventListener("click", () => {
    filterPanel.hidden = false;
    liveStatus.textContent = "Filters ready to edit.";
    query.focus();
  });

  render(projects, false);
}

if (typeof document !== "undefined") {
  mountProjectFinder(document);
}
