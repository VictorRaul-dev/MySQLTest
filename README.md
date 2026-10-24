# SQL Lab — laboratorio de práctica

Aplicación estática en español para practicar SQL sobre datos simulados cargados desde Excel o CSV. No tiene backend, credenciales ni conexiones a bases de producción. Los datos se procesan en memoria en un Web Worker del navegador.

**Es SQLite con compatibilidad parcial de T-SQL, no una instancia de Microsoft SQL Server.** El laboratorio sirve para aprender consultas y manipulación de datos; no certifica que un script funcione igual en SQL Server.

## Empezar

Sirve la carpeta por HTTP (no abras index.html mediante file://):

```bash
python -m http.server 8000
```

Abre http://localhost:8000. También funciona como sitio estático en GitHub Pages, una vez integrada esta versión en la rama publicada.

1. Carga el ejemplo de emisores y bonos: todos los instrumentos, cupones y vencimientos son ficticios y educativos.
2. Elige una consulta de ejemplo o escribe SQL. Ejecuta con Ctrl/⌘ + Enter.
3. Experimenta con UPDATE y DELETE. Usa **Deshacer última operación** para recuperar el estado anterior (un nivel, alterna entre ambos estados).
4. Guarda un **punto de restauración** antes de una práctica larga; puedes volver a él durante la misma sesión.
5. Carga tus propios Excel/CSV y consulta las tablas del explorador.

## Importación

- XLSX y XLS: todas las hojas no vacías, primera fila no vacía como encabezado.
- CSV: usa el nombre del archivo como tabla. Soporta campos entrecomillados, comas y saltos de línea dentro de campos mediante SheetJS. Se interpreta con la detección de separador de SheetJS; revisa la vista de columnas después de cargar.
- Cada hoja de Excel usa su nombre como tabla. Los nombres se normalizan y los duplicados reciben sufijos `_2`, `_3`, etc. No se reemplazan tablas existentes.
- Encabezados vacíos o duplicados se completan o desambiguan. El explorador muestra los nombres finales y tipos.
- Excel numérico: INTEGER o REAL si todos los valores no vacíos son números; en caso contrario TEXT. CSV conserva cadenas, incluyendo códigos con ceros iniciales; usa `CAST(columna AS REAL)` para sumar importes.
- Vacíos → NULL. Fechas de Excel → texto ISO. No se evalúan fórmulas: deben tener resultados calculados y guardados en Excel.
- Una carga completa es atómica: si un archivo falla, ninguna tabla de esa carga queda aplicada.
- Límite de 20 MB por carga, 500 columnas por tabla y 30 segundos de ejecución. Los archivos comprimidos pueden consumir más memoria que su tamaño en disco. La aplicación es para ejercicios moderados, no grandes volúmenes.

## SQL

Se conserva la sintaxis compatible con SQLite: SELECT, JOIN, GROUP BY, HAVING, ORDER BY, CASE, CTE, INSERT, UPDATE, DELETE, CREATE/DROP TABLE, entre otras. Cada ejecución completa es atómica. Las claves foráneas declaradas se comprueban en el motor; las tablas importadas no infieren relaciones ni claves primarias.

| Forma T-SQL                          | Traducción o alcance                                     |
| ------------------------------------ | -------------------------------------------------------- |
| SELECT TOP n / TOP (n)               | LIMIT n, solo SELECT externo simple; admite DISTINCT     |
| dbo.Tabla / [dbo].[Tabla]            | Tabla sin esquema                                        |
| ISNULL(a,b)                          | IFNULL(a,b)                                              |
| GETDATE()                            | Fecha/hora local del navegador con precisión de segundos |
| LEN(texto)                           | Longitud sin espacios ASCII finales                      |
| N'texto'                             | Cadena Unicode de SQLite                                 |
| VARCHAR/NVARCHAR/CHAR/NCHAR(n o MAX) | TEXT sin restricción de longitud                         |

La traducción tokeniza cadenas, comentarios e identificadores para no modificar texto literal. Se puede inspeccionar el SQL traducido debajo de los resultados.

No se admite T-SQL completo: variables, procedimientos, tablas #temporales, IDENTITY, DATEADD/DATEDIFF, CONVERT, MERGE, APPLY, OUTPUT, SELECT INTO, TOP anidado/PERCENT/WITH TIES, GO ni transacciones manuales. Las formas conocidas se rechazan con un mensaje. Otros comandos no compatibles generan errores del motor. Se bloquean ATTACH, DETACH, PRAGMA y cambios de configuración desde el editor.

SQLite y SQL Server difieren en tipos, aritmética, comparación, fechas, collation y manejo de errores. Para practicar esos aspectos de T-SQL con fidelidad se necesita una instancia desechable de SQL Server, fuera del alcance de esta aplicación estática.

## Recuperación y privacidad

- La aplicación no sube los archivos a un servidor. Descarga sql.js y SheetJS de CDN externos y requiere conectividad inicial; no es un paquete offline.
- Todo permanece en memoria. Recargar o cerrar pierde tablas, consultas y puntos de restauración. No hay persistencia automática.
- **Detener** termina el Worker y reconstruye la última base completada. También se cancela automáticamente una tarea que supera 30 segundos.
- Se muestran hasta 1.000 filas por resultado, con aviso si hay más. Se presentan todos los conjuntos de resultados de un lote.
- Exportación CSV de las filas visibles: texto potencialmente interpretable como fórmula se prefija con apóstrofo. NULL se exporta como campo vacío.
- La interfaz renderiza texto de archivos, resultados y errores mediante textContent, nunca como HTML.

## Archivos

- `index.html`, `styles.css`: interfaz responsive y guía.
- `app.js`: estado de sesión, controles, recuperación y resultados.
- `worker.js`: importación, SQLite, transacciones y ejecución aislada.
- `core.js`: traducción T-SQL, nombres e inferencia de tipos.
- `tests/lab.test.cjs`: pruebas de regresión con el motor real y archivos Excel generados.

## Pruebas

Requiere Node.js 18 o superior. Descarga las mismas versiones fijadas que usa la página en una carpeta temporal:

```bash
mkdir -p /tmp/sql-lab-deps
curl -fL https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js -o /tmp/sql-lab-deps/sql-wasm.js
curl -fL https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm -o /tmp/sql-lab-deps/sql-wasm.wasm
curl -fL https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -o /tmp/sql-lab-deps/xlsx.full.min.js
LAB_SQLJS=/tmp/sql-lab-deps/sql-wasm.js LAB_XLSX=/tmp/sql-lab-deps/xlsx.full.min.js node --test tests/lab.test.cjs
```

Las pruebas cubren traducción y rechazos de TOP, literales y comentarios, nombres duplicados, tipos, 140.000 filas preparadas, carga de varias hojas XLSX, CSV entrecomillado/multilínea, ceros iniciales, JOIN, UPDATE/DELETE, reversión de lotes e importaciones fallidas, restauración y límite de resultados.
