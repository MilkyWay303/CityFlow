const streets = [
  "Aleja 29 Listopada", "Aleja Generała Tadeusza Bora-Komorowskiego", "Aleja Ignacego Daszyńskiego",
  "Aleja Jana Pawła II", "Aleja Kijowska", "Aleja Księdza Józefa Tischnera", "Aleja Pokoju",
  "Aleja Powstania Warszawskiego", "Aleja Puszkarska", "Aleja Słowackiego", "Aleja Solidarności",
  "Aleja Zygmunta Krasińskiego", "Balicka", "Basztowa", "Bieżanowska", "Biskupia", "Blich",
  "Błonia", "Bora-Komorowskiego", "Brodowicza", "Bulwar Czerwieński", "Cystersów", "Czarnowiejska",
  "Czyżówka", "Długa", "Dietla", "Dobrego Pasterza", "Dominikańska", "Drukarska", "Dunajewskiego",
  "Floriańska", "Franciszkańska", "Garbarska", "Gęsia", "Głowackiego", "Grzegórzecka",
  "Gustawa Herlinga-Grudzińskiego", "Igołomska", "Jakuba", "Jasnogórska", "Józefa", "Kalwaryjska",
  "Kamieńskiego", "Kapelanka", "Karmelicka", "Kazimierza Wielkiego", "Kobierzyńska", "Koletek",
  "Kołłątaja", "Komandosów", "Konopnickiej", "Kopernika", "Krakowska", "Królewska", "Krowoderska",
  "Księcia Józefa", "Kupa", "Lipska", "Lubicz", "Łobzowska", "Łokietka", "Mackiewicza", "Miodowa",
  "Mogilska", "Monte Cassino", "Na Zjeździe", "Nadwiślańska", "Nawojki",
  "Nowohucka", "Nowosądecka", "Obrońców Krzyża", "Opolska", "Osiedle Centrum A", "Osiedle Centrum B",
  "Osiedle Centrum C", "Osiedle Centrum D", "Osiedle Centrum E", "Osiedle Handlowe", "Osiedle Hutnicze",
  "Osiedle Kalinowe", "Osiedle Kolorowe", "Osiedle Na Skarpie", "Osiedle Piastów", "Osiedle Teatralne",
  "Osiedle Złotego Wieku", "Pawia", "Pędzichów", "Piastowska", "Pilotów", "Piwna", "Plac Bohaterów Getta",
  "Plac Centralny", "Plac Inwalidów", "Plac Matejki", "Plac Na Groblach", "Plac Nowy", "Plac Szczepański",
  "Plac Wszystkich Świętych", "Podgórska", "Podwale", "Powstańców", "Prądnicka", "Rakowicka", "Rajska",
  "Rondo Grunwaldzkie", "Rondo Mogilskie", "Rondo Ofiar Katynia", "Rondo Polsadu", "Ruczaj", "Rydla",
  "Rynek Główny", "Rynek Podgórski", "Saska", "Senatorska", "Sienkiewicza", "Sławkowska",
  "Starowiślna", "Stradomska", "Straszewskiego", "Szewska", "Świętej Gertrudy", "Świętego Tomasza",
  "Tyniecka", "Ujastek", "Ujastek Mogilski", "Wadowicka", "Wielicka", "Wita Stwosza", "Wrocławska",
  "Wysłouchów", "Zakopiańska", "Zamoyskiego", "Zawiła", "Zwierzyniecka"
].map(street => street.replace(/\s+/g, " ").trim());

const form = document.querySelector("#report-form");
const streetSelect = document.querySelector("#street");
const photoInput = document.querySelector("#photo");
const feedback = document.querySelector("#form-feedback");
const residentView = document.querySelector("#resident-view");
const officialView = document.querySelector("#official-view");
const searchInput = document.querySelector("#street-search");
let selectedPhoto = "";
let photoProcessing = false;
let photoRequestId = 0;
let cachedReports = [];
const openStreets = new Set();
let officialAuthenticated = false;
let activeReportStatus = "unchecked";
const selectedReportIds = new Set();

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const isJson = (response.headers.get("Content-Type") || "").includes("application/json");
  if (!isJson) {
    throw new Error("Aplikacja nie jest uruchomiona przez serwer CityFLOW. Uruchom node server.js i otwórz http://127.0.0.1:4173.");
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Wystąpił błąd komunikacji z lokalnym serwerem.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function pluralReports(count) {
  if (count === 1) return "zgłoszenie";
  const last = count % 10;
  const lastTwo = count % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "zgłoszenia" : "zgłoszeń";
}

function expireOfficialSession() {
  officialAuthenticated = false;
  cachedReports = [];
  openStreets.clear();
  selectedReportIds.clear();
  activateResidentView();
  loginForm.reset();
  loginFeedback.textContent = "Sesja wygasła. Zaloguj się ponownie.";
  if (!loginDialog.open) loginDialog.showModal();
}

function showFeedback(message, success, target = feedback) {
  target.textContent = message;
  target.classList.toggle("success", success);
}

function explainApiError(error, context) {
  console.error(context, error);
  if (error.status === 401 && officialAuthenticated) expireOfficialSession();
  return error instanceof TypeError
    ? "Nie można połączyć się z lokalnym serwerem. Uruchom aplikację poleceniem node server.js."
    : error.message;
}

function formatReportTime(timestamp) {
  return new Date(timestamp).toLocaleString("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Warsaw"
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function priorityFor(count) {
  if (count >= 5) return { label: "Wysoki priorytet", level: "wysoki", pill: "high" };
  if (count >= 2) return { label: "Średni priorytet", level: "średni", pill: "medium" };
  return { label: "Obserwacja", level: "standardowy", pill: "" };
}

function populateStreets() {
  const fragment = document.createDocumentFragment();
  [...new Set(streets)].sort((a, b) => a.localeCompare(b, "pl")).forEach(street => {
    const option = document.createElement("option");
    option.value = street;
    option.textContent = street;
    fragment.append(option);
  });
  streetSelect.append(fragment);
}

async function renderDashboard({ refresh = true } = {}) {
  if (refresh) {
    try {
      cachedReports = await apiRequest("/api/reports");
    } catch (error) {
      showFeedback(explainApiError(error, "Nie udało się wczytać zgłoszeń."), false, dashboardFeedback);
      return;
    }
  }
  const reports = cachedReports;
  const availableReportIds = new Set(reports.map(report => report.id));
  selectedReportIds.forEach(id => {
    if (!availableReportIds.has(id)) selectedReportIds.delete(id);
  });
  const groups = new Map();
  reports.forEach(report => {
    if (!groups.has(report.street)) groups.set(report.street, []);
    groups.get(report.street).push(report);
  });
  const orderedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pl"));
  const highest = orderedGroups[0];
  const stats = [
    { label: "Wszystkie zgłoszenia", value: reports.length, note: "od mieszkańców" },
    { label: "Ulice z problemem", value: groups.size, note: "wymagają uwagi" },
    { label: "Najpilniejsza ulica", value: highest ? highest[0] : "—", note: highest ? `${highest[1].length} ${pluralReports(highest[1].length)}` : "brak zgłoszeń" }
  ];
  document.querySelector("#dashboard-stats").innerHTML = stats.map((stat, index) =>
    `<div class="stat-card"><span>${stat.label}</span><strong${index === 2 ? ' class="top-street"' : ""}>${escapeHtml(stat.value)}</strong><em>${escapeHtml(stat.note)}</em></div>`
  ).join("");
  showReportCount(reports.length);
  document.querySelector("#unchecked-count").textContent = reports.filter(report => report.status !== "verified").length;
  document.querySelector("#verified-count").textContent = reports.filter(report => report.status === "verified").length;

  const query = searchInput.value.trim().toLocaleLowerCase("pl");
  const allStreetCounts = new Map();
  reports.forEach(report => allStreetCounts.set(report.street, (allStreetCounts.get(report.street) || 0) + 1));
  const statusReports = reports.filter(report => activeReportStatus === "verified"
    ? report.status === "verified"
    : report.status !== "verified");
  const statusGroups = new Map();
  statusReports.forEach(report => {
    if (!statusGroups.has(report.street)) statusGroups.set(report.street, []);
    statusGroups.get(report.street).push(report);
  });
  const visibleGroups = [...statusGroups.entries()]
    .sort((a, b) => allStreetCounts.get(b[0]) - allStreetCounts.get(a[0]) || a[0].localeCompare(b[0], "pl"))
    .filter(([street]) => street.toLocaleLowerCase("pl").includes(query));
  const container = document.querySelector("#street-groups");
  container.querySelectorAll(".street-group").forEach(group => {
    if (group.open) openStreets.add(group.dataset.street);
    else openStreets.delete(group.dataset.street);
  });
  container.innerHTML = visibleGroups.map(([street, streetReports], index) => {
    const priority = priorityFor(allStreetCounts.get(street));
    const cards = streetReports.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(report => `
      <article class="report-card${report.photo ? "" : " no-photo"}">
        <div>
          <h4 class="report-title">${escapeHtml(report.id)}</h4>
          <p class="report-category">${escapeHtml(report.category)}</p>
          <p class="report-description">${escapeHtml(report.description)}</p>
          <time class="report-meta" datetime="${escapeHtml(report.createdAt)}">Zgłoszono: ${escapeHtml(formatReportTime(report.createdAt))}</time>
        </div>
        <div class="report-card-actions">
          <label class="report-select-label"><input class="report-select-checkbox" type="checkbox" data-report-id="${escapeHtml(report.id)}"${selectedReportIds.has(report.id) ? " checked" : ""}> Zaznacz</label>
          ${report.photo
            ? `<button class="photo-preview" type="button" data-photo="${escapeHtml(report.photo)}" data-caption="${escapeHtml(`${report.street} · ${report.category}`)}" aria-label="Powiększ zdjęcie zgłoszenia: ${escapeHtml(report.category)}"><img src="${escapeHtml(report.photo)}" alt="Zdjęcie zgłoszenia: ${escapeHtml(report.category)}"></button>`
            : '<span class="report-no-photo">Bez zdjęcia</span>'}
          <button class="copy-description-button" type="button" aria-label="Kopiuj opis zgłoszenia">Kopiuj opis</button>
          ${report.photo
            ? `<a class="download-photo-link" href="${escapeHtml(report.photo)}" download="zgloszenie-${escapeHtml(report.id.replace(/[^a-zA-Z0-9_-]/g, "-"))}.jpg">Pobierz zdjęcie</a>`
            : ""}
          ${report.status === "verified"
            ? '<button class="verify-report-button" type="button" data-report-id="' + escapeHtml(report.id) + '" data-next-status="unchecked">Przenieś do niesprawdzonych</button>'
            : '<button class="verify-report-button" type="button" data-report-id="' + escapeHtml(report.id) + '" data-next-status="verified">Oznacz jako sprawdzone</button>'}
          <button class="delete-report-button" type="button" data-report-id="${escapeHtml(report.id)}" data-street="${escapeHtml(street)}" aria-label="Usuń zgłoszenie: ${escapeHtml(report.category)}">Usuń wpis</button>
        </div>
      </article>`).join("");
    return `<details class="street-group" data-priority="${priority.level}" data-street="${escapeHtml(street)}"${openStreets.has(street) ? " open" : ""}>
      <summary>
        <span class="priority-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="street-name">${escapeHtml(street)}</span>
        <span class="street-count">${streetReports.length} ${pluralReports(streetReports.length)}</span>
        <span class="priority-pill ${priority.pill}">${priority.label}</span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="street-reports">${cards}</div>
    </details>`;
  }).join("");
  document.querySelector("#empty-state").hidden = visibleGroups.length > 0;
  document.querySelector("#empty-state").textContent = query
    ? "Nie znaleziono ulicy pasującej do wyszukiwania."
    : activeReportStatus === "verified"
      ? "Nie ma jeszcze sprawdzonych zgłoszeń."
      : "Nie ma niesprawdzonych zgłoszeń.";
  const verifySelectedButton = document.querySelector("#verify-selected-reports");
  const targetStatus = activeReportStatus === "verified" ? "unchecked" : "verified";
  verifySelectedButton.disabled = selectedReportIds.size === 0;
  verifySelectedButton.firstChild.textContent = targetStatus === "verified" ? "Oznacz jako sprawdzone " : "Przenieś do niesprawdzonych ";
  updateBulkSelectionControls();
}

function updateBulkSelectionControls() {
  const checkboxes = [...document.querySelectorAll(".report-select-checkbox")];
  const selectedVisibleCount = checkboxes.filter(checkbox => selectedReportIds.has(checkbox.dataset.reportId)).length;
  const selectAll = document.querySelector("#select-all-reports");
  selectAll.checked = checkboxes.length > 0 && selectedVisibleCount === checkboxes.length;
  selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < checkboxes.length;
  selectAll.disabled = checkboxes.length === 0;
  const selectedCount = checkboxes.filter(checkbox => selectedReportIds.has(checkbox.dataset.reportId)).length;
  document.querySelector("#selected-report-count").textContent = selectedCount;
  document.querySelector("#verify-selected-reports").disabled = selectedCount === 0;
  document.querySelector("#delete-selected-reports").disabled = selectedCount === 0;
}

function resetPhotoSelection() {
  photoRequestId += 1;
  photoProcessing = false;
  selectedPhoto = "";
  document.querySelector("#upload-title").textContent = "Dodaj zdjęcie";
  document.querySelector("#upload-hint").textContent = "JPG, PNG lub WEBP · maks. 10 MB";
  document.querySelector("#selected-photo-thumbnail").removeAttribute("src");
  document.querySelector("#selected-photo-preview").hidden = true;
}

function failPhotoSelection(message) {
  photoInput.value = "";
  resetPhotoSelection();
  showFeedback(message, false);
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  resetPhotoSelection();
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    failPhotoSelection("Wybierz zdjęcie JPG, PNG lub WEBP o wielkości do 10 MB.");
    return;
  }
  const requestId = photoRequestId;
  photoProcessing = true;
  document.querySelector("#upload-title").textContent = file.name;
  document.querySelector("#upload-hint").textContent = "Przygotowywanie zdjęcia…";
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (requestId !== photoRequestId) return;
    const image = new Image();
    image.addEventListener("load", () => {
      if (requestId !== photoRequestId) return;
      photoProcessing = false;
      const maxDimension = 1200;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        failPhotoSelection("Nie udało się przygotować zdjęcia. Spróbuj wybrać inny plik.");
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      selectedPhoto = canvas.toDataURL("image/jpeg", 0.78);
      document.querySelector("#upload-title").textContent = file.name;
      document.querySelector("#upload-hint").textContent = "Zdjęcie gotowe do wysłania";
      document.querySelector("#selected-photo-thumbnail").src = selectedPhoto;
      document.querySelector("#selected-photo-preview").hidden = false;
      showFeedback("", false);
    });
    image.addEventListener("error", () => {
      if (requestId === photoRequestId) failPhotoSelection("Nie udało się odczytać zdjęcia. Wybierz inny plik.");
    });
    image.src = reader.result;
  });
  reader.addEventListener("error", () => {
    if (requestId === photoRequestId) failPhotoSelection("Nie udało się odczytać zdjęcia. Wybierz inny plik.");
  });
  reader.readAsDataURL(file);
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if (photoProcessing) {
    showFeedback("Poczekaj chwilę — zdjęcie jest jeszcze przygotowywane.", false);
    return;
  }
  if (!document.querySelector("#description").value.trim()) {
    showFeedback("Opisz problem — opis nie może składać się z samych spacji.", false);
    return;
  }
  const report = {
    street: streetSelect.value,
    category: document.querySelector("#category").value,
    description: document.querySelector("#description").value.trim(),
    photo: selectedPhoto
  };
  const submitButton = form.querySelector(".submit-button");
  submitButton.disabled = true;
  let savedReport;
  try {
    savedReport = await apiRequest("/api/reports", { method: "POST", body: JSON.stringify(report) });
  } catch (error) {
    showFeedback(explainApiError(error, "Nie udało się zapisać zgłoszenia."), false);
    return;
  } finally {
    submitButton.disabled = false;
  }
  form.reset();
  resetPhotoSelection();
  showFeedback("Dziękujemy! Zgłoszenie zostało zapisane.", true);
  document.querySelector("#receipt-id").textContent = savedReport.id;
  document.querySelector("#receipt-street").textContent = report.street;
  document.querySelector("#receipt-category").textContent = report.category;
  document.querySelector("#receipt-time").textContent = formatReportTime(savedReport.createdAt);
  document.querySelector("#receipt-dialog").showModal();
  updateReportCount();
});

function activateOfficialView() {
  document.querySelectorAll(".role-button").forEach(roleButton => roleButton.classList.toggle("is-active", roleButton.dataset.view === "official"));
  residentView.hidden = true;
  officialView.hidden = false;
  document.querySelector("#hero-title").innerHTML = "Wszystkie sprawy<br><span>w jednym miejscu.</span>";
  document.querySelector("#hero-description").textContent = "Przeglądaj zgłoszenia mieszkańców pogrupowane według ulic. Priorytet rośnie wraz z liczbą zgłoszeń.";
  renderDashboard();
}

function activateResidentView() {
  document.querySelectorAll(".role-button").forEach(roleButton => roleButton.classList.toggle("is-active", roleButton.dataset.view === "resident"));
  residentView.hidden = false;
  officialView.hidden = true;
  document.querySelector("#hero-title").innerHTML = "Zauważyłeś problem?<br><span>Daj nam znać.</span>";
  document.querySelector("#hero-description").textContent = "Dziura w jezdni, uszkodzony chodnik, a może niebezpieczne oznakowanie? Zgłoś to — razem zadbajmy o krakowskie ulice.";
}

searchInput.addEventListener("input", () => renderDashboard({ refresh: false }));
const dashboardFeedback = document.querySelector("#dashboard-feedback");
const photoDialog = document.querySelector("#photo-dialog");
const photoDialogImage = document.querySelector("#photo-dialog-image");
const loginDialog = document.querySelector("#login-dialog");
const loginForm = document.querySelector("#login-form");
const loginFeedback = document.querySelector("#login-feedback");

document.querySelectorAll(".role-button").forEach(button => {
  button.addEventListener("click", async () => {
    if (button.dataset.view === "resident") {
      if (officialAuthenticated) {
        try {
          await apiRequest("/api/logout", { method: "POST" });
        } catch (error) {
          console.error("Nie udało się zakończyć sesji urzędnika.", error);
        }
        officialAuthenticated = false;
      }
      activateResidentView();
      return;
    }
    if (officialAuthenticated) {
      activateOfficialView();
      return;
    }
    loginFeedback.textContent = "";
    loginForm.reset();
    loginDialog.showModal();
  });
});

document.querySelector("#street-groups").addEventListener("click", event => {
  const verifyButton = event.target.closest(".verify-report-button");
  if (verifyButton) {
    apiRequest(`/api/reports/${encodeURIComponent(verifyButton.dataset.reportId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: verifyButton.dataset.nextStatus })
    }).then(() => {
      selectedReportIds.delete(verifyButton.dataset.reportId);
      renderDashboard();
      updateReportCount();
      showFeedback(verifyButton.dataset.nextStatus === "verified"
        ? "Zgłoszenie przeniesiono do sprawdzonych."
        : "Zgłoszenie przeniesiono do niesprawdzonych.", true, dashboardFeedback);
    }).catch(error => showFeedback(explainApiError(error, "Nie udało się zmienić statusu zgłoszenia."), false, dashboardFeedback));
    return;
  }

  const copyButton = event.target.closest(".copy-description-button");
  if (copyButton) {
    const description = copyButton.closest(".report-card").querySelector(".report-description").textContent;
    navigator.clipboard.writeText(description)
      .then(() => showFeedback("Opis zgłoszenia skopiowano.", true, dashboardFeedback))
      .catch(error => {
        console.error("Nie udało się skopiować opisu zgłoszenia.", error);
        showFeedback("Nie udało się skopiować opisu. Sprawdź uprawnienia przeglądarki.", false, dashboardFeedback);
      });
    return;
  }

  const previewButton = event.target.closest(".photo-preview");
  if (previewButton) {
    photoDialogImage.src = previewButton.dataset.photo;
    photoDialogImage.alt = `Powiększone zdjęcie: ${previewButton.dataset.caption}`;
    document.querySelector("#photo-dialog-caption").textContent = previewButton.dataset.caption;
    photoDialog.showModal();
    return;
  }

  const deleteButton = event.target.closest(".delete-report-button");
  if (!deleteButton) return;
  if (!window.confirm(`Czy na pewno chcesz usunąć zgłoszenie z ulicy ${deleteButton.dataset.street}? Tej czynności nie można cofnąć.`)) return;
  apiRequest(`/api/reports/${encodeURIComponent(deleteButton.dataset.reportId)}`, { method: "DELETE" })
    .then(() => {
      renderDashboard();
      updateReportCount();
      showFeedback("Zgłoszenie zostało usunięte.", true, dashboardFeedback);
    })
    .catch(error => showFeedback(explainApiError(error, "Nie udało się usunąć zgłoszenia."), false, dashboardFeedback));
});

document.querySelector("#street-groups").addEventListener("change", event => {
  const checkbox = event.target.closest(".report-select-checkbox");
  if (!checkbox) return;
  if (checkbox.checked) selectedReportIds.add(checkbox.dataset.reportId);
  else selectedReportIds.delete(checkbox.dataset.reportId);
  updateBulkSelectionControls();
});

document.querySelector("#select-all-reports").addEventListener("change", event => {
  document.querySelectorAll(".report-select-checkbox").forEach(checkbox => {
    if (event.target.checked) selectedReportIds.add(checkbox.dataset.reportId);
    else selectedReportIds.delete(checkbox.dataset.reportId);
    checkbox.checked = event.target.checked;
  });
  updateBulkSelectionControls();
});

document.querySelector("#delete-selected-reports").addEventListener("click", async () => {
  const reportIds = [...document.querySelectorAll(".report-select-checkbox:checked")].map(checkbox => checkbox.dataset.reportId);
  if (reportIds.length === 0) return;
  if (!window.confirm(`Czy na pewno chcesz usunąć zaznaczone zgłoszenia (${reportIds.length})? Tej czynności nie można cofnąć.`)) return;
  try {
    const { deleted } = await apiRequest("/api/reports/bulk", {
      method: "DELETE",
      body: JSON.stringify({ ids: reportIds })
    });
    selectedReportIds.clear();
    await renderDashboard();
    await updateReportCount();
    showFeedback(`Usunięto zgłoszenia: ${deleted}.`, true, dashboardFeedback);
  } catch (error) {
    showFeedback(explainApiError(error, "Nie udało się usunąć zaznaczonych zgłoszeń."), false, dashboardFeedback);
  }
});

document.querySelector("#verify-selected-reports").addEventListener("click", async () => {
  const reportIds = [...document.querySelectorAll(".report-select-checkbox:checked")].map(checkbox => checkbox.dataset.reportId);
  if (reportIds.length === 0) return;
  const status = activeReportStatus === "verified" ? "unchecked" : "verified";
  try {
    const { updated } = await apiRequest("/api/reports/bulk/status", {
      method: "PATCH",
      body: JSON.stringify({ ids: reportIds, status })
    });
    selectedReportIds.clear();
    await renderDashboard();
    showFeedback(status === "verified"
      ? `Przeniesiono do sprawdzonych: ${updated}.`
      : `Przeniesiono do niesprawdzonych: ${updated}.`, true, dashboardFeedback);
  } catch (error) {
    showFeedback(explainApiError(error, "Nie udało się zmienić statusów zgłoszeń."), false, dashboardFeedback);
  }
});

document.querySelectorAll(".report-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    activeReportStatus = tab.dataset.status;
    selectedReportIds.clear();
    document.querySelectorAll(".report-tab").forEach(item => {
      const selected = item === tab;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    renderDashboard({ refresh: false });
  });
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginFeedback.textContent = "";
  try {
    await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: document.querySelector("#official-password").value })
    });
    officialAuthenticated = true;
    loginDialog.close();
    activateOfficialView();
  } catch (error) {
    loginFeedback.textContent = error instanceof TypeError
      ? explainApiError(error, "Nie udało się zalogować.")
      : error.message;
  }
});

document.querySelector("#cancel-login").addEventListener("click", () => loginDialog.close());
loginDialog.addEventListener("click", event => {
  if (event.target === loginDialog) loginDialog.close();
});

document.querySelector("#preview-selected-photo").addEventListener("click", () => {
  if (!selectedPhoto) return;
  photoDialogImage.src = selectedPhoto;
  photoDialogImage.alt = "Powiększony podgląd zdjęcia przed wysłaniem";
  document.querySelector("#photo-dialog-caption").textContent = "Podgląd zdjęcia przed wysłaniem";
  photoDialog.showModal();
});

function showReportCount(count) {
  document.querySelector("#report-count-note").textContent = count;
  document.querySelector("#report-count-label").textContent = `${pluralReports(count)} od mieszkańców`;
}

async function updateReportCount() {
  try {
    const { count } = await apiRequest("/api/summary");
    showReportCount(count);
  } catch (error) {
    console.error("Nie udało się pobrać liczby zgłoszeń.", error);
  }
}

document.querySelector(".photo-dialog-close").addEventListener("click", () => photoDialog.close());
photoDialog.addEventListener("click", event => {
  if (event.target === photoDialog) photoDialog.close();
});
photoDialog.addEventListener("close", () => {
  photoDialogImage.removeAttribute("src");
  photoDialogImage.alt = "";
});
const receiptDialog = document.querySelector("#receipt-dialog");
document.querySelector("#close-receipt").addEventListener("click", () => receiptDialog.close());
receiptDialog.addEventListener("click", event => {
  if (event.target === receiptDialog) receiptDialog.close();
});
populateStreets();
updateReportCount();
apiRequest("/api/session")
  .then(({ authenticated }) => {
    officialAuthenticated = authenticated;
    if (authenticated) activateOfficialView();
  })
  .catch(error => console.error("Nie udało się sprawdzić sesji urzędnika.", error));