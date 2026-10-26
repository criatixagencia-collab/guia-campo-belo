#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePaths = [
  path.join(root, "dados-locais.js"),
  path.join(root, "dados-locais-resgatados.js"),
];
const outputPath = path.join(root, "drone", "dados.js");
const context = { window: {} };
vm.createContext(context);
for (const sourcePath of sourcePaths) {
  vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });
}

const records = [
  ...(context.window.DADOS_LOCAIS || []),
  ...(context.window.DADOS_LOCAIS_RESGATADOS || []),
];
if (!records.length) throw new Error("Nenhum estabelecimento encontrado nas bases do diretório");
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
const header = `/* DADOS DO DRONE GERADOS A PARTIR DAS BASES DO DIRETÓRIO\n` +
  `   Não editar manualmente. Execute: node scripts/build_drone_data.mjs\n` +
  `   Total: ${normalized.length}; com coordenadas: ${valid.length}. */\n\n`;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}const dados = ${JSON.stringify(normalized, null, 2)};\n`);
console.log(JSON.stringify({ ok: true, total: normalized.length, withCoordinates: valid.length, outputPath }));
