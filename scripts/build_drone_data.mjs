#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "index.html");
const outputPath = path.join(root, "drone", "dados.js");
const source = fs.readFileSync(sourcePath, "utf8");
const startMarker = "const dados = [";
const start = source.indexOf(startMarker);

if (start < 0) throw new Error("Lista 'const dados' não encontrada em index.html");

let cursor = start + "const dados = ".length;
let depth = 0;
let quote = "";
let escaped = false;
let end = -1;

for (; cursor < source.length; cursor += 1) {
  const char = source[cursor];
  if (quote) {
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === quote) quote = "";
    continue;
  }
  if (char === '"' || char === "'" || char === "`") {
    quote = char;
  } else if (char === "[") {
    depth += 1;
  } else if (char === "]") {
    depth -= 1;
    if (depth === 0) {
      end = cursor + 1;
      break;
    }
  }
}

if (end < 0) throw new Error("Fim da lista de estabelecimentos não encontrado");

const records = vm.runInNewContext(`(${source.slice(start + "const dados = ".length, end)})`);
const normalized = records.map((item) => ({
  id: item.id,
  nome: item.nome,
  categoriaPrincipal: item.cats?.[0] || "Outros",
  categorias: item.cats || [],
  subcategoria: item.sub || "",
  endereco: item.end || "",
  lat: Number.isFinite(item.lat) ? item.lat : null,
  lng: Number.isFinite(item.lng) ? item.lng : null,
  telefones: [item.wp, item.tel].filter(Boolean),
  instagram: item.ig || "",
  site: item.site || "",
  descricao: item.desc || "",
  promocao: item.beneficio || "",
  termosBusca: [item.dest, item.obs].filter(Boolean),
}));

const valid = normalized.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
const header = `/* DADOS DO DRONE GERADOS A PARTIR DE index.html\n` +
  `   Não editar manualmente. Execute: node scripts/build_drone_data.mjs\n` +
  `   Total: ${normalized.length}; com coordenadas: ${valid.length}. */\n\n`;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}const dados = ${JSON.stringify(normalized, null, 2)};\n`);
console.log(JSON.stringify({ ok: true, total: normalized.length, withCoordinates: valid.length, outputPath }));
