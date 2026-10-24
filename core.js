/* Token-aware, deliberately limited T-SQL compatibility layer. */
(function (root) {
  "use strict";
  function tokens(sql) {
    const out = [];
    let i = 0;
    while (i < sql.length) {
      const s = sql.slice(i);
      let m;
      if ((m = /^\s+/.exec(s))) {
        i += m[0].length;
        continue;
      }
      if (s.startsWith("--")) {
        const e = s.indexOf("\n");
        i += e < 0 ? s.length : e;
        continue;
      }
      if (s.startsWith("/*")) {
        const e = s.indexOf("*/", 2);
        if (e < 0) throw Error("Comentario sin cerrar.");
        i += e + 2;
        continue;
      }
      if ("'\"[".includes(s[0])) {
        const end = s[0] === "[" ? "]" : s[0];
        let j = 1,
          closed = false;
        for (; j < s.length; j++) {
          if (s[j] === end) {
            if (s[j + 1] === end) {
              j++;
              continue;
            }
            j++;
            closed = true;
            break;
          }
        }
        if (!closed) throw Error("Texto o identificador sin cerrar.");
        out.push({ v: s.slice(0, j), quoted: true });
        i += j;
        continue;
      }
      m = /^(?:[A-Za-z_@#][\w@$#]*|\d+(?:\.\d+)?|<>|!=|<=|>=|\|\||.)/.exec(s);
      out.push({ v: m[0], quoted: false });
      i += m[0].length;
    }
    return out;
  }
  const upper = (t) => (t && !t.quoted ? t.v.toUpperCase() : "");
  function translate(sql) {
    const ts = tokens(sql),
      groups = [[]];
    for (const t of ts) {
      if (t.v === ";") groups.push([]);
      else groups.at(-1).push(t);
    }
    return groups
      .filter((g) => g.length)
      .map((g) => {
        const unsupported = new Set([
          "DECLARE",
          "EXEC",
          "EXECUTE",
          "PROCEDURE",
          "PROC",
          "MERGE",
          "APPLY",
          "OUTPUT",
          "IDENTITY",
          "TRY_CONVERT",
          "CONVERT",
          "DATEADD",
          "DATEDIFF",
          "USE",
          "GO",
          "TRUNCATE",
          "BEGIN",
          "COMMIT",
          "ROLLBACK",
          "SAVEPOINT",
          "RELEASE",
          "ATTACH",
          "DETACH",
          "PRAGMA",
          "VACUUM",
          "REINDEX",
          "TRIGGER",
        ]);
        for (const t of g)
          if (!t.quoted && (unsupported.has(upper(t)) || /^[@#]/.test(t.v)))
            throw Error(
              `No compatible en este laboratorio: ${t.v}. Consulta la guía de compatibilidad.`,
            );
        let limit = null;
        const tops = g
          .map((t, i) => (upper(t) === "TOP" ? i : -1))
          .filter((i) => i >= 0);
        if (tops.length) {
          let p = upper(g[1]) === "DISTINCT" ? 2 : 1;
          if (
            tops.length !== 1 ||
            upper(g[0]) !== "SELECT" ||
            tops[0] !== p ||
            g.some((t) =>
              ["UNION", "INTERSECT", "EXCEPT", "LIMIT"].includes(upper(t)),
            )
          )
            throw Error(
              "TOP solo admite un SELECT simple, sin UNION ni TOP anidados.",
            );
          let end = p + 1;
          if (g[end]?.v === "(") {
            if (!/^\d+$/.test(g[end + 1]?.v || "") || g[end + 2]?.v !== ")")
              throw Error("TOP requiere un entero literal.");
            limit = g[end + 1].v;
            end += 3;
          } else {
            if (!/^\d+$/.test(g[end]?.v || ""))
              throw Error("TOP requiere un entero literal.");
            limit = g[end].v;
            end++;
          }
          if (["PERCENT", "WITH"].includes(upper(g[end])))
            throw Error("TOP PERCENT y WITH TIES no están disponibles.");
          g.splice(p, end - p);
        }
        const out = [];
        for (let i = 0; i < g.length; i++) {
          const t = g[i],
            u = upper(t);
          if (u === "INTO" && upper(g[0]) === "SELECT")
            throw Error(
              "SELECT INTO no está disponible. Usa CREATE TABLE ... AS SELECT ... (SQLite).",
            );
          if (u === "DBO" && g[i + 1]?.v === ".") {
            i++;
            continue;
          }
          if (t.quoted && /^\[dbo\]$/i.test(t.v) && g[i + 1]?.v === ".") {
            i++;
            continue;
          }
          if (u === "N" && g[i + 1]?.v.startsWith("'")) {
            continue;
          }
          if (u === "GETDATE" && g[i + 1]?.v === "(" && g[i + 2]?.v === ")") {
            out.push("datetime('now','localtime')");
            i += 2;
            continue;
          }
          if (["ISNULL", "LEN"].includes(u) && g[i + 1]?.v === "(") {
            out.push(u === "ISNULL" ? "IFNULL" : "tsql_len");
            continue;
          }
          if (
            ["NVARCHAR", "VARCHAR", "NCHAR", "CHAR"].includes(u) &&
            g[i + 1]?.v === "(" &&
            /^(\d+|max)$/i.test(g[i + 2]?.v || "") &&
            g[i + 3]?.v === ")"
          ) {
            out.push("TEXT");
            i += 3;
            continue;
          }
          out.push(t.v);
        }
        if (limit !== null) out.push("LIMIT", limit);
        return out.join(" ");
      })
      .join(";\n");
  }
  function ident(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }
  function normalize(name, fallback) {
    const n = String(name ?? "")
      .trim()
      .replace(/[^\p{L}\p{N}_]/gu, "_");
    return n ? (/^\d/.test(n) ? "T_" + n : n) : fallback;
  }
  function unique(base, used) {
    let n = base,
      i = 2;
    while (used.has(n.toLowerCase())) n = base + "_" + i++;
    used.add(n.toLowerCase());
    return n;
  }
  function prepareRows(rows) {
    rows = rows.filter((r) =>
      r.some((v) => v !== null && v !== undefined && v !== ""),
    );
    if (!rows.length) throw Error("La hoja está vacía.");
    const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
    if (width > 500) throw Error("Máximo 500 columnas por tabla.");
    const used = new Set();
    const headers = Array.from({ length: width }, (_, i) =>
      unique(normalize(rows[0][i], "Columna_" + (i + 1)), used),
    );
    const data = rows.slice(1).map((r) =>
      headers.map((_, i) => {
        const v = r[i];
        return v === undefined || v === null || v === ""
          ? null
          : v instanceof Date
            ? v.toISOString().slice(0, 19).replace("T", " ")
            : typeof v === "boolean"
              ? Number(v)
              : v;
      }),
    );
    const types = headers.map((_, i) => {
      const vals = data.map((r) => r[i]).filter((v) => v !== null);
      return vals.length &&
        vals.every((v) => typeof v === "number" && Number.isFinite(v))
        ? vals.every(Number.isInteger)
          ? "INTEGER"
          : "REAL"
        : "TEXT";
    });
    return { headers, data, types };
  }
  const api = { tokens, translate, ident, normalize, unique, prepareRows };
  if (typeof module !== "undefined") module.exports = api;
  root.SQLLab = api;
})(typeof self !== "undefined" ? self : globalThis);
