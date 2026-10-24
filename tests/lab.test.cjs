const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../core.js");
const sqlPath =
  process.env.LAB_SQLJS || require.resolve("sql.js/dist/sql-wasm.js");
const initSqlJs = require(sqlPath);
const XLSX = require(process.env.LAB_XLSX || "xlsx");
test("T-SQL translation preserves literals and quoted identifiers", () => {
  const q = core.translate(
    "-- TOP 999\nSELECT DISTINCT TOP (2) ISNULL(LEN(N'abc  '), 0), 'GETDATE(); TOP 9', [TOP] FROM [dbo].[Bonos] ORDER BY Id;",
  );
  assert.match(q, /LIMIT 2$/);
  assert.match(q, /'GETDATE\(\); TOP 9'/);
  assert.match(q, /\[TOP\]/);
  assert.match(q, /tsql_len/);
  assert.doesNotMatch(q, /\[dbo\]/);
  assert.match(core.translate("SELECT TOP 0 * FROM Bonos"), /LIMIT 0$/);
  for (const s of [
    "SELECT TOP 1 PERCENT * FROM Bonos",
    "SELECT TOP 1 WITH TIES * FROM Bonos",
    "SELECT * FROM (SELECT TOP 2 * FROM Bonos)",
    "DECLARE @x INT",
    "BEGIN TRANSACTION",
    "SELECT TOP 1 * FROM Bonos UNION SELECT * FROM Bonos",
  ])
    assert.throws(() => core.translate(s));
});
test("Header normalization, mixed types, empty cells and large imports", () => {
  const p = core.prepareRows([
    ["ID", "ID", "", "Fecha", "Precio"],
    ["001", 2, null, new Date("2026-10-23T00:00:00Z"), 3.5],
    ["002", 3, null, null, 4],
  ]);
  assert.deepEqual(p.headers, ["ID", "ID_2", "Columna_3", "Fecha", "Precio"]);
  assert.deepEqual(p.types, ["TEXT", "INTEGER", "TEXT", "TEXT", "REAL"]);
  assert.equal(p.data[0][3], "2026-10-23 00:00:00");
  assert.equal(
    core.prepareRows([["id"], ...Array.from({ length: 140000 }, (_, i) => [i])])
      .data.length,
    140000,
  );
});
test("Real SQLite worker: demo, queries, rollback, CSV, XLSX, collisions and restore", async () => {
  let reply;
  const ctx = {
    console,
    Uint8Array,
    Date,
    setTimeout,
    clearTimeout,
    SQLLab: core,
    XLSX,
    importScripts() {},
    postMessage(m) {
      reply = m;
    },
    initSqlJs: () =>
      initSqlJs({
        locateFile: () => path.join(path.dirname(sqlPath), "sql-wasm.wasm"),
      }),
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../worker.js"), "utf8"),
    ctx,
  );
  async function send(data) {
    reply = null;
    await ctx.onmessage({ data });
    assert.ok(reply);
    return reply;
  }
  const run = (sql) => send({ type: "run", sql });
  assert.equal((await send({ type: "init" })).type, "ready");
  const demo = await send({ type: "demo" });
  assert.equal(demo.type, "done");
  assert.equal(demo.schema.length, 2);
  let r = await run(
    "SELECT TOP (2) Nombre FROM dbo.Bonos ORDER BY Cupon DESC; SELECT LEN('ab  ') AS n;",
  );
  assert.equal(r.type, "done", r.error);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].values.length, 2);
  assert.equal(r.results[1].values[0][0], 2);
  r = await run(
    "SELECT b.Nombre,e.Pais FROM Bonos b JOIN Emisores e ON b.EmisorId=e.Id",
  );
  assert.equal(r.results[0].values.length, 4);
  r = await run(
    "UPDATE Bonos SET Cupon=99 WHERE Id=1; SELECT * FROM missing_table;",
  );
  assert.equal(r.type, "error");
  r = await run("SELECT Cupon FROM Bonos WHERE Id=1");
  assert.equal(r.results[0].values[0][0], 6.5);
  r = await run("DELETE FROM Bonos WHERE Id=1; SELECT * FROM Bonos;");
  assert.equal(r.results[1].values.length, 3);
  await send({ type: "restore", bytes: demo.bytes });
  r = await run("SELECT COUNT(*) FROM Bonos");
  assert.equal(r.results[0].values[0][0], 4);
  const csv = Buffer.from(
    'Codigo,Nombre,Nota\r\n001,"Doe, Jane","primera\nsegunda"\r\n002,"O\'Brien","<img src=x onerror=alert(1)>"\r\n',
  );
  r = await send({
    type: "import",
    files: [{ name: "Clientes.CSV", bytes: csv }],
  });
  assert.equal(r.type, "done");
  assert.equal(r.imported[0].rows, 2);
  r = await run("SELECT * FROM Clientes ORDER BY Codigo");
  assert.equal(r.results[0].values[0][0], "001");
  assert.equal(r.results[0].values[0][1], "Doe, Jane");
  assert.equal(r.results[0].values[0][2], "primera\nsegunda");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Id", "Precio"],
      [1, 98.5],
      [2, 101],
    ]),
    "Bonos",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Id", "Texto"],
      [1, "áéí"],
    ]),
    "Otra Hoja",
  );
  r = await send({
    type: "import",
    files: [
      {
        name: "test.xlsx",
        bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
      },
    ],
  });
  assert.equal(r.type, "done");
  assert.equal(r.imported[0].name, "Bonos_2");
  assert.equal(r.imported[1].name, "Otra_Hoja");
  r = await run("SELECT SUM(Precio) FROM Bonos_2");
  assert.equal(r.results[0].values[0][0], 199.5);
  r = await send({
    type: "import",
    files: [
      {
        name: "legacy.xls",
        bytes: XLSX.write(wb, { type: "buffer", bookType: "biff8" }),
      },
    ],
  });
  assert.equal(r.type, "done", r.error);
  assert.equal(r.imported[0].name, "Bonos_3");
  r = await run(
    "CREATE TABLE Padre (Id INTEGER PRIMARY KEY); CREATE TABLE Hijo (Id INTEGER, PadreId INTEGER REFERENCES Padre(Id)); INSERT INTO Hijo VALUES(1,999);",
  );
  assert.equal(r.type, "error");
  r = await run("SELECT * FROM Padre");
  assert.equal(r.type, "error");
  r = await send({
    type: "import",
    files: [
      { name: "new.csv", bytes: csv },
      { name: "bad.xlsx", bytes: Buffer.from([0x50, 0x4b, 3, 4, 0, 0]) },
    ],
  });
  assert.equal(r.type, "error");
  r = await run("SELECT * FROM new");
  assert.equal(r.type, "error");
  r = await run(
    "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1005) SELECT * FROM n",
  );
  assert.equal(r.type, "done");
  assert.equal(r.results[0].values.length, 1000);
  assert.equal(r.results[0].truncated, true);
  r = await run("SELECT '<b>text</b>' AS label");
  assert.equal(r.results[0].values[0][0], "<b>text</b>");
});
