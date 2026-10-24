/* SQL and workbook parsing run away from the UI; Stop discards unfinished work. */
importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  "core.js",
);
let SQL, db;
function open(bytes) {
  if (db) db.close();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  registerFunctions();
}
function registerFunctions() {
  db.run("PRAGMA foreign_keys=ON");
  db.create_function("tsql_len", (v) =>
    v == null ? null : String(v).replace(/ +$/, "").length,
  );
}
function dump() {
  const bytes = db.export();
  registerFunctions();
  return bytes;
}
function schema() {
  return (
    db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )[0]?.values || []
  ).map(([name]) => ({
    name,
    columns:
      db
        .exec("PRAGMA table_info(" + SQLLab.ident(name) + ")")[0]
        ?.values.map((r) => ({ name: r[1], type: r[2] })) || [],
  }));
}
function insert(name, rows) {
  const p = SQLLab.prepareRows(rows);
  db.run(
    `CREATE TABLE ${SQLLab.ident(name)} (${p.headers.map((h, i) => SQLLab.ident(h) + " " + p.types[i]).join(",")})`,
  );
  const s = db.prepare(
    `INSERT INTO ${SQLLab.ident(name)} VALUES (${p.headers.map(() => "?").join(",")})`,
  );
  try {
    for (const row of p.data) s.run(row);
  } finally {
    s.free();
  }
  return { name, rows: p.data.length };
}
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      SQL = await initSqlJs({
        locateFile: (f) =>
          "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/" + f,
      });
      open(m.bytes);
      postMessage({ type: "ready", schema: schema() });
      return;
    }
    const before = dump();
    let results = [],
      translated = "",
      imported = [];
    try {
      if (m.type === "restore") open(m.bytes);
      if (m.type === "demo") {
        db.run("BEGIN");
        if (
          schema().some((t) =>
            ["bonos", "emisores"].includes(t.name.toLowerCase()),
          )
        )
          throw Error(
            "Ya existen Bonos o Emisores. Vacía la base para cargar el ejemplo sin sobrescribir datos.",
          );
        imported.push(
          insert("Emisores", [
            ["Id", "Nombre", "Pais"],
            [1, "Tesoro del Perú", "Perú"],
            [2, "Empresa Andina (ficticia)", "Perú"],
            [3, "Banco Regional (ficticio)", "Chile"],
          ]),
        );
        imported.push(
          insert("Bonos", [
            ["Id", "EmisorId", "Nombre", "Moneda", "Cupon", "Vencimiento"],
            [1, 1, "Soberano demo 2030", "PEN", 6.5, "2030-08-12"],
            [2, 1, "Global demo 2035", "USD", 5.8, "2035-03-01"],
            [3, 2, "Andina demo 2029", "PEN", 7.2, "2029-06-15"],
            [4, 3, "Regional demo 2032", "USD", 6.1, "2032-11-10"],
          ]),
        );
        db.run("COMMIT");
      }
      if (m.type === "import") {
        db.run("BEGIN");
        const used = new Set(schema().map((t) => t.name.toLowerCase()));
        for (const f of m.files) {
          const csv = /\.csv$/i.test(f.name);
          const wb = XLSX.read(f.bytes, {
            type: "array",
            cellDates: true,
            raw: csv,
          });
          for (const sheet of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
              header: 1,
              defval: null,
              raw: true,
            });
            if (!rows.some((r) => r.some((v) => v !== null && v !== "")))
              continue;
            const base = SQLLab.normalize(
              csv ? f.name.replace(/\.[^.]+$/, "") : sheet,
              "Tabla",
            );
            const name = SQLLab.unique(base, used);
            imported.push(insert(name, rows));
          }
        }
        if (!imported.length) throw Error("No se encontraron hojas con datos.");
        db.run("COMMIT");
      }
      if (m.type === "run") {
        translated = SQLLab.translate(m.sql);
        if (!translated.trim()) throw Error("Escribe una consulta primero.");
        db.run("BEGIN");
        for (const stmt of db.iterateStatements(translated)) {
          try {
            const columns = stmt.getColumnNames();
            const values = [];
            let truncated = false;
            while (stmt.step()) {
              if (values.length >= 1000) {
                truncated = true;
                break;
              }
              if (columns.length) values.push(stmt.get());
            }
            results.push({
              columns,
              values,
              truncated,
              changes: columns.length ? null : db.getRowsModified(),
            });
          } finally {
            stmt.free();
          }
        }
        db.run("COMMIT");
      }
      postMessage({
        type: "done",
        bytes: dump(),
        schema: schema(),
        results,
        translated,
        imported,
      });
    } catch (e) {
      open(before);
      throw e;
    }
  } catch (e) {
    postMessage({ type: "error", error: e.message });
  }
};
