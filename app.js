"use strict";
const $ = (id) => document.getElementById(id);
let worker,
  ready = false,
  busy = false,
  snapshot = null,
  previous = null,
  hasPrevious = false,
  checkpoint = null,
  hasCheckpoint = false,
  timer,
  job = 0;
const examples = {
  top: "SELECT TOP (10) * FROM dbo.Bonos ORDER BY Cupon DESC;",
  join: "SELECT b.Nombre AS Bono, e.Nombre AS Emisor, b.Moneda, b.Cupon\nFROM dbo.Bonos AS b\nLEFT JOIN dbo.Emisores AS e ON b.EmisorId = e.Id\nORDER BY b.Cupon DESC;",
  group:
    "SELECT Moneda, COUNT(*) AS Cantidad, AVG(Cupon) AS CuponPromedio\nFROM dbo.Bonos\nGROUP BY Moneda\nHAVING COUNT(*) > 0;",
  update:
    "-- Modifica solo la base de práctica. Puedes deshacerlo.\nUPDATE dbo.Bonos SET Cupon = 7.5 WHERE Id = 1;\nSELECT * FROM dbo.Bonos WHERE Id = 1;",
  delete:
    "-- Elimina solo datos simulados. Puedes deshacerlo.\nDELETE FROM dbo.Bonos WHERE Id = 4;\nSELECT * FROM dbo.Bonos;",
};
function message(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function controls() {
  for (const id of ["files", "run", "demo", "clear", "checkpoint"])
    $(id).disabled = !ready || busy;
  $("undo").disabled = !ready || busy || !hasPrevious;
  $("restore").disabled = !ready || busy || !hasCheckpoint;
  $("stop").disabled = !busy;
}
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function showSchema(tables) {
  $("schema").replaceChildren();
  if (!tables.length) {
    $("schema").append(el("p", "No hay tablas todavía."));
    return;
  }
  for (const t of tables) {
    const d = el("details");
    d.append(el("summary", t.name));
    const ul = el("ul");
    for (const c of t.columns) ul.append(el("li", c.name + " · " + c.type));
    const b = el("button", "Consultar tabla");
    b.onclick = () => {
      $("query").value =
        "SELECT TOP (10) * FROM [" + t.name.replace(/]/g, "]]") + "];";
      $("query").focus();
    };
    d.append(ul, b);
    $("schema").append(d);
  }
}
function download(text, name) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(v) {
  let s = v === null ? "" : String(v);
  if (/^[\s]*[=+@-]/.test(s) && typeof v !== "number") s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function showResults(results) {
  $("results").replaceChildren();
  if (!results.length) {
    $("results").append(
      el("div", "Base preparada. Ejecuta una consulta.", "empty"),
    );
    return;
  }
  results.forEach((r, i) => {
    const a = el("article");
    a.append(
      el(
        "h3",
        `Resultado ${i + 1} · ${r.columns.length ? r.values.length + " filas" + (r.truncated ? " (vista limitada; consulta más filas con filtros)" : "") : "Instrucción completada"}`,
      ),
    );
    if (r.columns.length) {
      const b = el("button", "Descargar CSV visible");
      b.onclick = () =>
        download(
          "\ufeff" +
            [r.columns, ...r.values]
              .map((row) => row.map(csvCell).join(","))
              .join("\r\n"),
          `resultado_${i + 1}.csv`,
        );
      a.append(b);
      const wrap = el("div", undefined, "table-wrap"),
        table = el("table"),
        head = el("thead"),
        tr = el("tr");
      r.columns.forEach((c) => tr.append(el("th", c)));
      head.append(tr);
      table.append(head);
      const body = el("tbody");
      r.values.forEach((row) => {
        const tr = el("tr");
        row.forEach((v) =>
          tr.append(
            el(
              "td",
              v === null ? "NULL" : String(v),
              v === null ? "null" : undefined,
            ),
          ),
        );
        body.append(tr);
      });
      table.append(body);
      wrap.append(table);
      a.append(wrap);
    } else a.append(el("p", "Cambios aplicados a la base simulada."));
    $("results").append(a);
  });
}
function boot(note) {
  ready = false;
  controls();
  worker = new Worker("worker.js");
  const current = worker;
  const initTimer = setTimeout(() => {
    if (current === worker && !ready) {
      worker.terminate();
      message(
        "No se pudo iniciar el motor. Comprueba tu conexión y recarga la página.",
        true,
      );
    }
  }, 30000);
  worker.onerror = () => {
    clearTimeout(initTimer);
    clearTimeout(timer);
    busy = false;
    ready = false;
    controls();
    message(
      "No se pudo cargar el motor o una dependencia. Abre la aplicación por HTTP/HTTPS, comprueba la conexión y recarga.",
      true,
    );
  };
  worker.onmessage = ({ data: m }) => {
    if (current !== worker) return;
    if (m.type === "ready") {
      clearTimeout(initTimer);
      ready = true;
      showSchema(m.schema);
      controls();
      message(note || "Listo. Carga un Excel/CSV o el ejemplo de bonos.");
      return;
    }
    clearTimeout(timer);
    busy = false;
    if (m.type === "error") {
      message(m.error + " No se aplicaron cambios.", true);
      controls();
      return;
    }
    previous = snapshot;
    hasPrevious = true;
    snapshot = m.bytes;
    showSchema(m.schema);
    showResults(m.results);
    if (m.translated) {
      const d = el("details");
      d.className = "guide";
      d.append(
        el("summary", "SQL ejecutado por el motor de práctica"),
        el("pre", m.translated),
      );
      $("results").append(d);
    }
    controls();
    message(
      m.imported.length
        ? "Importación completada: " +
            m.imported.map((t) => `${t.name} (${t.rows} filas)`).join(" · ")
        : "Operación completada. Puedes deshacerla.",
    );
  };
  worker.postMessage({ type: "init", bytes: snapshot });
}
function start() {
  if (!ready || busy) return false;
  busy = true;
  job++;
  controls();
  message("Procesando en la base simulada…");
  timer = setTimeout(
    () =>
      cancel(
        "La tarea superó 30 segundos. Se recuperó el último estado completado.",
      ),
    30000,
  );
  return true;
}
function run(type, extra = {}) {
  if (start()) worker.postMessage({ type, ...extra });
}
function cancel(
  note = "Tarea detenida. Se recuperó el último estado completado.",
) {
  job++;
  clearTimeout(timer);
  worker.terminate();
  busy = false;
  boot(note);
}
$("run").onclick = () => run("run", { sql: $("query").value });
$("stop").onclick = () => cancel();
$("demo").onclick = () => run("demo");
$("clear").onclick = () => {
  if (
    confirm(
      "¿Vaciar todas las tablas de práctica? Podrás deshacer esta operación.",
    )
  )
    run("restore", { bytes: null });
};
$("undo").onclick = () => run("restore", { bytes: previous });
$("checkpoint").onclick = () => {
  checkpoint = snapshot;
  hasCheckpoint = true;
  controls();
  message(
    "Punto de restauración guardado en esta sesión. Se perderá al recargar la página.",
  );
};
$("restore").onclick = () => run("restore", { bytes: checkpoint });
$("examples").onchange = (e) => {
  if (examples[e.target.value]) $("query").value = examples[e.target.value];
};
$("query").onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    $("run").click();
  }
};
$("files").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  if (files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024) {
    message("Carga hasta 20 MB en total cada vez.", true);
    return;
  }
  if (files.some((f) => !/\.(csv|xlsx|xls)$/i.test(f.name))) {
    message("Selecciona archivos CSV, XLSX o XLS.", true);
    return;
  }
  if (!start()) return;
  const id = job;
  try {
    const data = await Promise.all(
      files.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })),
    );
    if (id === job) worker.postMessage({ type: "import", files: data });
  } catch (err) {
    if (id !== job) return;
    clearTimeout(timer);
    busy = false;
    controls();
    message("No se pudo leer el archivo: " + err.message, true);
  }
};
window.addEventListener("beforeunload", (e) => {
  if (snapshot) {
    e.preventDefault();
    e.returnValue = "";
  }
});
boot();
