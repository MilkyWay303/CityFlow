const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "storage");
const DATA_FILE = path.join(DATA_DIR, "reports.json");
const COUNTERS_FILE = path.join(DATA_DIR, "report-counters.json");
const PORT = Number(process.env.PORT || 4173);
const HOST = "127.0.0.1";
const PASSWORD = process.env.OFFICIAL_PASSWORD || "321123";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
let writeQueue = Promise.resolve();

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map(part => {
    const separator = part.indexOf("=");
    return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

function hasOfficialSession(request) {
  const token = parseCookies(request).dk_official;
  const session = token && sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function decodeReportId(encodedId) {
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

function pruneExpiredEntries() {
  const now = Date.now();
  sessions.forEach((session, token) => {
    if (session.expiresAt <= now) sessions.delete(token);
  });
  loginAttempts.forEach((attempts, address) => {
    if (!attempts.some(time => time > now - 60_000)) loginAttempts.delete(address);
  });
}

function requireOfficial(request, response) {
  if (hasOfficialSession(request)) return true;
  sendJson(response, 401, { error: "Zaloguj się do panelu urzędnika." });
  return false;
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Wysłane dane są za duże.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Nieprawidłowy format danych.");
    error.statusCode = 400;
    throw error;
  }
}

async function readReports() {
  await writeQueue;
  const contents = await fs.readFile(DATA_FILE, "utf8");
  const reports = JSON.parse(contents);
  if (!Array.isArray(reports)) throw new Error("Plik lokalnej bazy zgłoszeń ma nieprawidłowy format.");
  return reports;
}

function streetSlug(street) {
  return street
    .replace(/[łŁ]/g, character => character === "Ł" ? "L" : "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readCounters(reports) {
  let counters;
  try {
    counters = JSON.parse(await fs.readFile(COUNTERS_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    counters = {};
  }
  if (!counters || Array.isArray(counters) || typeof counters !== "object") {
    throw new Error("Plik lokalnych liczników zgłoszeń ma nieprawidłowy format.");
  }
  for (const report of reports) {
    const slug = streetSlug(report.street);
    const match = typeof report.id === "string" && report.id.match(new RegExp(`^${slug}-(\\d+)$`));
    if (match) counters[slug] = Math.max(Number(counters[slug]) || 0, Number(match[1]));
  }
  return counters;
}

async function writeJsonAtomically(filePath, value) {
  const temporaryFile = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, filePath);
}

function appendReport(report) {
  const operation = writeQueue.then(async () => {
    const reports = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    if (!Array.isArray(reports)) throw new Error("Plik lokalnej bazy zgłoszeń ma nieprawidłowy format.");
    const counters = await readCounters(reports);
    const slug = streetSlug(report.street);
    const number = (Number(counters[slug]) || 0) + 1;
    const savedReport = { ...report, id: `${slug}-${number}`, status: "unchecked" };
    counters[slug] = number;
    await writeJsonAtomically(COUNTERS_FILE, counters);
    await writeJsonAtomically(DATA_FILE, [...reports, savedReport]);
    return savedReport;
  });
  writeQueue = operation.catch(error => console.error("Nie udało się zapisać lokalnego zgłoszenia.", error));
  return operation;
}

async function migrateReportIds() {
  const reports = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  if (!Array.isArray(reports)) throw new Error("Plik lokalnej bazy zgłoszeń ma nieprawidłowy format.");
  const counters = await readCounters(reports);
  const seenIds = new Set();
  const migratedReports = reports.map(report => {
    const slug = streetSlug(report.street);
    const idPattern = new RegExp(`^${slug}-(\\d+)$`);
    if (typeof report.id === "string" && idPattern.test(report.id) && !seenIds.has(report.id)
      && (report.status === "unchecked" || report.status === "verified")) {
      seenIds.add(report.id);
      return report;
    }
    let id = report.id;
    if (typeof id !== "string" || !idPattern.test(id) || seenIds.has(id)) {
      counters[slug] = Math.max(Number(counters[slug]) || 0, 0) + 1;
      id = `${slug}-${counters[slug]}`;
    }
    seenIds.add(id);
    return { ...report, id, status: report.status === "verified" ? "verified" : "unchecked" };
  });
  await writeJsonAtomically(COUNTERS_FILE, counters);
  await writeJsonAtomically(DATA_FILE, migratedReports);
}

function updateReports(change) {
  const operation = writeQueue.then(async () => {
    const reports = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    const nextReports = change(reports);
    await writeJsonAtomically(DATA_FILE, nextReports);
    return nextReports;
  });
  writeQueue = operation.catch(error => console.error("Nie udało się zapisać lokalnej bazy zgłoszeń.", error));
  return operation;
}

function validateReport(report) {
  if (!report || typeof report !== "object"
    || typeof report.street !== "string" || !report.street.trim() || report.street.length > 150
    || !streetSlug(report.street)
    || typeof report.category !== "string" || !report.category.trim() || report.category.length > 100
    || typeof report.description !== "string" || !report.description.trim() || report.description.length > 600) {
    return "Uzupełnij poprawnie ulicę, kategorię i opis zgłoszenia.";
  }
  if (report.photo !== undefined && report.photo !== "" && (typeof report.photo !== "string"
    || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(report.photo)
    || report.photo.length > 5 * 1024 * 1024)) {
    return "Zdjęcie ma nieprawidłowy format lub jest za duże.";
  }
  return null;
}

function serveStatic(request, response, pathname) {
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"]
  };
  const file = files[pathname];
  if (!file || !["GET", "HEAD"].includes(request.method)) {
    sendJson(response, 404, { error: "Nie znaleziono strony." });
    return;
  }
  fs.readFile(path.join(ROOT, file[0])).then(contents => {
    response.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  }).catch(error => {
    console.error("Nie udało się odczytać pliku aplikacji.", error);
    sendJson(response, 500, { error: "Nie udało się wczytać aplikacji." });
  });
}

async function handleRequest(request, response) {
  let url;
  try {
    url = new URL(request.url, `http://${HOST}:${PORT}`);
  } catch {
    sendJson(response, 400, { error: "Nieprawidłowy adres żądania." });
    return;
  }
  const { pathname } = url;

  if (pathname === "/api/summary" && request.method === "GET") {
    try {
      sendJson(response, 200, { count: (await readReports()).length });
    } catch (error) {
      console.error("Nie udało się odczytać liczby zgłoszeń.", error);
      sendJson(response, 500, { error: "Nie udało się odczytać lokalnych zgłoszeń." });
    }
    return;
  }

  if (pathname === "/api/session" && request.method === "GET") {
    sendJson(response, 200, { authenticated: hasOfficialSession(request) });
    return;
  }

  if (pathname === "/api/login" && request.method === "POST") {
    const address = request.socket.remoteAddress || "local";
    const recentAttempts = (loginAttempts.get(address) || []).filter(time => time > Date.now() - 60_000);
    if (recentAttempts.length >= 10) {
      sendJson(response, 429, { error: "Zbyt wiele prób logowania. Spróbuj ponownie za minutę." });
      return;
    }
    recentAttempts.push(Date.now());
    loginAttempts.set(address, recentAttempts);
    try {
      const body = await readJsonBody(request);
      const password = body && typeof body === "object" ? body.password : "";
      const supplied = crypto.createHash("sha256").update(String(password || "")).digest();
      const expected = crypto.createHash("sha256").update(PASSWORD).digest();
      if (!crypto.timingSafeEqual(supplied, expected)) {
        sendJson(response, 401, { error: "Nieprawidłowe hasło." });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
      loginAttempts.delete(address);
      sendJson(response, 200, { authenticated: true }, {
        "Set-Cookie": `dk_official=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
      });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/logout" && request.method === "POST") {
    const token = parseCookies(request).dk_official;
    if (token) sessions.delete(token);
    sendJson(response, 200, { authenticated: false }, {
      "Set-Cookie": "dk_official=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    });
    return;
  }

  if (pathname === "/api/reports" && request.method === "GET") {
    if (!requireOfficial(request, response)) return;
    try {
      sendJson(response, 200, await readReports());
    } catch (error) {
      console.error("Nie udało się wczytać lokalnych zgłoszeń.", error);
      sendJson(response, 500, { error: "Nie udało się odczytać lokalnych zgłoszeń." });
    }
    return;
  }

  if (pathname === "/api/reports" && request.method === "POST") {
    try {
      const report = await readJsonBody(request);
      const validationError = validateReport(report);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }
      const savedReport = await appendReport({
        street: report.street.trim(),
        category: report.category.trim(),
        description: report.description.trim(),
        photo: report.photo || "",
        createdAt: new Date().toISOString()
      });
      sendJson(response, 201, { saved: true, id: savedReport.id, createdAt: savedReport.createdAt });
    } catch (error) {
      if (error.statusCode === 409) {
        sendJson(response, 409, { error: error.message });
        return;
      }
      console.error("Nie udało się zapisać lokalnego zgłoszenia.", error);
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Nie udało się zapisać zgłoszenia w lokalnym pliku."
      });
    }
    return;
  }

  if (pathname === "/api/reports/bulk" && request.method === "DELETE") {
    if (!requireOfficial(request, response)) return;
    try {
      const body = await readJsonBody(request);
      if (!body || !Array.isArray(body.ids) || body.ids.length === 0
        || body.ids.length > 1000
        || body.ids.some(id => typeof id !== "string" || id.length > 100)) {
        sendJson(response, 400, { error: "Wybierz poprawne zgłoszenia do usunięcia." });
        return;
      }
      const ids = new Set(body.ids);
      let deleted = 0;
      await updateReports(reports => {
        const remaining = reports.filter(report => {
          if (!ids.has(report.id)) return true;
          deleted += 1;
          return false;
        });
        return remaining;
      });
      sendJson(response, 200, { deleted });
    } catch (error) {
      console.error("Nie udało się usunąć zaznaczonych zgłoszeń.", error);
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Nie udało się usunąć zgłoszeń z lokalnego pliku."
      });
    }
    return;
  }

  if (pathname === "/api/reports/bulk/status" && request.method === "PATCH") {
    if (!requireOfficial(request, response)) return;
    try {
      const body = await readJsonBody(request);
      if (!body || !Array.isArray(body.ids) || body.ids.length === 0
        || body.ids.length > 1000
        || body.ids.some(id => typeof id !== "string" || id.length > 100)
        || !["unchecked", "verified"].includes(body.status)) {
        sendJson(response, 400, { error: "Wybierz zgłoszenia i poprawny status." });
        return;
      }
      const ids = new Set(body.ids);
      let updated = 0;
      await updateReports(reports => reports.map(report => {
        if (!ids.has(report.id) || report.status === body.status) return report;
        updated += 1;
        return { ...report, status: body.status };
      }));
      sendJson(response, 200, { updated });
    } catch (error) {
      console.error("Nie udało się zmienić statusów zaznaczonych zgłoszeń.", error);
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Nie udało się zapisać nowych statusów zgłoszeń."
      });
    }
    return;
  }

  const reportStatusMatch = pathname.match(/^\/api\/reports\/([^/]+)\/status$/);
  if (reportStatusMatch && request.method === "PATCH") {
    if (!requireOfficial(request, response)) return;
    try {
      const body = await readJsonBody(request);
      if (!body || !["unchecked", "verified"].includes(body.status)) {
        sendJson(response, 400, { error: "Wybierz poprawny status zgłoszenia." });
        return;
      }
      const reportId = decodeReportId(reportStatusMatch[1]);
      if (reportId === null) {
        sendJson(response, 400, { error: "Nieprawidłowy numer zgłoszenia." });
        return;
      }
      let updated = false;
      let found = false;
      await updateReports(reports => reports.map(report => {
        if (report.id !== reportId) return report;
        found = true;
        if (report.status === body.status) return report;
        updated = true;
        return { ...report, status: body.status };
      }));
      if (!found) {
        sendJson(response, 404, { error: "Nie znaleziono zgłoszenia." });
        return;
      }
      sendJson(response, 200, { updated });
    } catch (error) {
      console.error("Nie udało się zmienić statusu zgłoszenia.", error);
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Nie udało się zapisać statusu zgłoszenia."
      });
    }
    return;
  }

  const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
  if (reportMatch && request.method === "DELETE") {
    if (!requireOfficial(request, response)) return;
    try {
      const reportId = decodeReportId(reportMatch[1]);
      if (reportId === null) {
        sendJson(response, 400, { error: "Nieprawidłowy numer zgłoszenia." });
        return;
      }
      let deleted = false;
      await updateReports(reports => {
        const remaining = reports.filter(report => report.id !== reportId);
        deleted = remaining.length !== reports.length;
        return remaining;
      });
      if (!deleted) {
        sendJson(response, 404, { error: "Nie znaleziono zgłoszenia." });
        return;
      }
      sendJson(response, 200, { deleted: true });
    } catch (error) {
      console.error("Nie udało się usunąć lokalnego zgłoszenia.", error);
      sendJson(response, 500, { error: "Nie udało się usunąć zgłoszenia z lokalnego pliku." });
    }
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Nie znaleziono endpointu." });
    return;
  }
  serveStatic(request, response, pathname);
}

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", { flag: "wx" }).catch(error => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  try {
    await fs.access(COUNTERS_FILE);
  } catch {
    await fs.writeFile(COUNTERS_FILE, "{}\n", { flag: "wx" }).catch(error => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  await migrateReportIds();
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      console.error("Nieoczekiwany błąd lokalnego serwera.", error);
      if (!response.headersSent) sendJson(response, 500, { error: "Wystąpił nieoczekiwany błąd serwera." });
      else response.destroy();
    });
  });
  setInterval(pruneExpiredEntries, 10 * 60 * 1000).unref();
  server.listen(PORT, HOST,() => console.log(`CityFLOW działa: http://${HOST}:${PORT}`));
}

start().catch(error => {
  console.error("Nie udało się uruchomić lokalnego serwera.", error);
  process.exitCode = 1;
});