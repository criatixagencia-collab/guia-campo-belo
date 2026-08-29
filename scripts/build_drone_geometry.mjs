#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "drone", "simulador", "bairro3d.js");

/* Perimetro do bairro usado no guia, no mesmo formato de quatro vertices do
   Drone 3D da Vila Mascote. O bbox inclui apenas uma margem tecnica. */
const boundary = [
  [-46.6765568, -23.6085514], // Bandeirantes x Santo Amaro
  [-46.6612849, -23.6184376], // Bandeirantes x Washington Luis
  [-46.6690668, -23.6339792], // Roberto Marinho x Washington Luis
  [-46.6820928, -23.6193494], // Roberto Marinho x Santo Amaro
  [-46.6765568, -23.6085514],
];
const bbox = { south: -23.6355, west: -46.6836, north: -23.6070, east: -46.6598 };
const bboxWfs = `${bbox.west},${bbox.south},${bbox.east},${bbox.north},EPSG:4326`;
const bboxOverpass = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
const center = { lat: -23.62008, lng: -46.67225 };
const metersLat = 111320;
const metersLng = 111320 * Math.cos(center.lat * Math.PI / 180);
const toLocal = ([lon, lat]) => [(lon - center.lng) * metersLng, -(lat - center.lat) * metersLat];
const toGeo = ([x, z]) => [x / metersLng + center.lng, -z / metersLat + center.lat];

const feature = (type, coordinates, properties = {}) => ({
  type: "Feature",
  geometry: { type, coordinates },
  properties,
});
const collection = (features = []) => ({ type: "FeatureCollection", features });
const round = (value, precision = 6) => Number(value.toFixed(precision));
const hash = (value) => {
  let n = Number(value) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
};
const rngFor = (seed) => {
  let state = hash(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

function pointInRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > lat) !== (b[1] > lat) &&
        lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
  ));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function simplifyOpen(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let split = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      split = i;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = simplifyOpen(points.slice(0, split + 1), tolerance);
  const right = simplifyOpen(points.slice(split), tolerance);
  return left.slice(0, -1).concat(right);
}

function simplifyRing(input, tolerance = 0.0000015) {
  if (!Array.isArray(input) || input.length < 4) return [];
  let points = input.map(([lon, lat]) => [round(lon), round(lat)]);
  if (points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points = points.slice(0, -1);
  if (points.length > 4) points = simplifyOpen(points.concat([points[0]]), tolerance).slice(0, -1);
  if (points.length < 3) return [];
  points.push([...points[0]]);
  return points;
}

function explodePolygons(item, tolerance) {
  const geometry = item.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const ring = simplifyRing(geometry.coordinates[0], tolerance);
    return ring.length >= 4 ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => simplifyRing(polygon[0], tolerance))
      .filter((ring) => ring.length >= 4);
  }
  return [];
}

async function fetchJson(url, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "GuiaCampoBeloDrone/2.0 (GeoSampa geographic build)" },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw new Error(`${label}: ${lastError?.message || "falha desconhecida"}`);
}

async function fetchWfsLayer(name, sortBy) {
  const endpoint = "https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/ows";
  const pageSize = 10000;
  const features = [];
  let matched = Infinity;
  for (let startIndex = 0; startIndex < matched; startIndex += pageSize) {
    const url = new URL(endpoint);
    const params = {
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: `geoportal:${name}`,
      bbox: bboxWfs,
      srsName: "EPSG:4326",
      count: String(pageSize),
      startIndex: String(startIndex),
      sortBy,
      outputFormat: "application/json",
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const page = await fetchJson(url, `${name} pagina ${startIndex / pageSize + 1}`);
    matched = Number(page.numberMatched ?? page.totalFeatures ?? 0);
    features.push(...(page.features || []));
    console.log(`[GeoSampa] ${name}: ${features.length}/${matched}`);
    if (!page.features?.length || features.length >= matched) break;
  }
  return features;
}

async function fetchOsm() {
  const query = `[out:json][timeout:180];(
    way["highway"~"^(primary|secondary|tertiary|residential|living_street|unclassified|service)$"](${bboxOverpass});
    way["leisure"~"^(park|garden|playground|pitch)$"](${bboxOverpass});
    way["landuse"~"^(grass|recreation_ground|forest|meadow)$"](${bboxOverpass});
    way["natural"~"^(wood|water)$"](${bboxOverpass});
    node["natural"="tree"](${bboxOverpass});
  );out tags geom;`;
  const endpoint = new URL("https://overpass-api.de/api/interpreter");
  endpoint.searchParams.set("data", query);
  const osm = await fetchJson(endpoint, "OpenStreetMap");
  console.log(`[OSM] elementos: ${osm.elements.length}`);
  return osm;
}

const [edificacaoRaw, lotesRaw, calcadasRaw, vegetacaoRaw, cotasRaw, osm] = await Promise.all([
  fetchWfsLayer("edificacao", "cd_identificador"),
  fetchWfsLayer("lote_cidadao", "cd_identificador"),
  fetchWfsLayer("calcada", "cd_identificador_calcada"),
  fetchWfsLayer("cobertura_vegetal", "cd_identificador_vegetacao"),
  fetchWfsLayer("ponto_cotado", "cd_identificador"),
  fetchOsm(),
]);

const facadePalette = ["#dcd5c5", "#e8dfae", "#ded7c8", "#e6e0d2", "#d8d0c0", "#efe9dc", "#e3ddd0"];
const terracotta = ["#8b4b2f", "#a85d35", "#bd6f42", "#7c4533", "#c47a4e", "#94543a"];
const concrete = ["#8f8c85", "#a3a099", "#b0aaa1", "#777a78", "#9b958d", "#c0bab0"];
const edificacoes = [];
for (const item of edificacaoRaw) {
  const id = Number(item.properties?.cd_identificador || edificacoes.length + 1);
  const random = rngFor(id);
  for (const ring of explodePolygons(item, 0.0000012)) {
    let height = Number(item.properties?.qt_altura_edificacao);
    if (!Number.isFinite(height) || height < 2.5) height = 3 + random() * 5;
    height = round(Math.max(3, Math.min(180, height)), 1);
    const body = round(Math.max(2.4, height - (height >= 24 ? 2.6 : height >= 9 ? 1.2 : 0.6)), 1);
    const roofPool = height < 9 && random() < 0.72 ? terracotta : concrete;
    edificacoes.push(feature("Polygon", [ring], {
      h: height,
      b: body,
      col: roofPool[Math.floor(random() * roofPool.length)],
      cw: facadePalette[Math.floor(random() * facadePalette.length)],
    }));
  }
}

const lotes = [];
for (const item of lotesRaw) {
  const id = Number(item.properties?.cd_identificador || lotes.length);
  for (const ring of explodePolygons(item, 0.0000025)) {
    lotes.push(feature("Polygon", [ring], { t: hash(id) % 6 }));
  }
}

const calcadas = [];
for (const item of calcadasRaw) {
  for (const ring of explodePolygons(item, 0.0000025)) calcadas.push(feature("Polygon", [ring]));
}

const ways = osm.elements.filter((item) => item.type === "way" && Array.isArray(item.geometry));
const vias = [];
const verdes = [];
for (const way of ways) {
  const tags = way.tags || {};
  const coordinates = way.geometry.map((node) => [round(node.lon), round(node.lat)]);
  if (tags.highway) {
    if (coordinates.length < 2) continue;
    const cls = tags.highway === "primary" ? "prim" :
      (["secondary", "tertiary"].includes(tags.highway) ? "sec" : "res");
    vias.push(feature("LineString", coordinates, { cls, nome: tags.name || "", osmId: way.id }));
  } else if (tags.leisure || tags.landuse || tags.natural) {
    const ring = simplifyRing(coordinates, 0.0000025);
    if (ring.length < 4) continue;
    const kind = tags.natural === "water" ? "agua" : tags.leisure === "pitch" ? "quadra" : "verde";
    verdes.push(feature("Polygon", [ring], { kind }));
  }
}

const roadSegments = [];
for (const road of vias) {
  const half = road.properties.cls === "prim" ? 10 : road.properties.cls === "sec" ? 7.5 : 5.5;
  const points = road.geometry.coordinates.map(toLocal);
  for (let i = 0; i < points.length - 1; i += 1) {
    roadSegments.push({ a: points[i], b: points[i + 1], half, cls: road.properties.cls, id: road.properties.osmId });
  }
  delete road.properties.osmId;
}
const distanceToRoad = ([x, z]) => {
  let best = Infinity;
  for (const segment of roadSegments) {
    const distance = perpendicularDistance([x, z], segment.a, segment.b) - segment.half;
    if (distance < best) best = distance;
    if (best < 0) break;
  }
  return best;
};

const treeColors = ["#4c7a3f", "#456f38", "#517c42", "#557f45", "#5c8a4b", "#63925a"];
const arvores = [];
const makeTree = (lon, lat, radiusMeters, height, id) => {
  const ring = [];
  for (let i = 0; i <= 6; i += 1) {
    const angle = Math.PI * 2 * i / 6;
    ring.push([
      round(lon + Math.cos(angle) * radiusMeters / metersLng),
      round(lat + Math.sin(angle) * radiusMeters / metersLat),
    ]);
  }
  arvores.push(feature("Polygon", [ring], {
    h: round(height, 1),
    b: round(height * 0.38, 1),
    col: treeColors[hash(id) % treeColors.length],
  }));
};

for (const item of vegetacaoRaw) {
  const id = Number(item.properties?.cd_identificador_vegetacao || arvores.length + 1);
  const description = String(item.properties?.tx_descricao_categoria_subcategoria || "").toLowerCase();
  const area = Math.max(1, Number(item.properties?.qt_area_vegetacao) || 1);
  const category = Number(item.properties?.cd_categoria_vegetacao || 0);
  for (const ring of explodePolygons(item, 0.000003)) {
    if (description.includes("herbácea") || category < 10) {
      arvores.push(feature("Polygon", [ring], { h: 0.25, b: 0, col: "#8aab68" }));
      continue;
    }
    const xs = ring.slice(0, -1).map((point) => point[0]);
    const ys = ring.slice(0, -1).map((point) => point[1]);
    const random = rngFor(id);
    const density = category >= 13 ? 1.25 : category >= 12 ? 0.95 : 0.7;
    const wanted = Math.max(1, Math.min(14, Math.round(area / 75 * density)));
    let placed = 0;
    for (let attempt = 0; attempt < wanted * 18 && placed < wanted; attempt += 1) {
      const lon = Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs));
      const lat = Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys));
      if (!pointInRing([lon, lat], ring)) continue;
      if (distanceToRoad(toLocal([lon, lat])) < 1.6) continue;
      const height = 5.2 + random() * 5.2;
      makeTree(lon, lat, 1.8 + random() * 2.0, height, id + placed * 7919);
      placed += 1;
    }
  }
}

for (const tree of osm.elements.filter((item) => item.type === "node" && item.tags?.natural === "tree")) {
  const local = toLocal([tree.lon, tree.lat]);
  if (distanceToRoad(local) < 1.2) continue;
  const random = rngFor(tree.id);
  makeTree(tree.lon, tree.lat, 1.8 + random() * 1.5, 5.5 + random() * 4.5, tree.id);
}

const carColors = ["#ececec", "#c6c8ca", "#8d9298", "#494c52", "#202226", "#7d2c24", "#244b78", "#a88742"];
const carros = [];
for (const segment of roadSegments) {
  if (carros.length >= 460 || segment.cls !== "res") continue;
  const dx = segment.b[0] - segment.a[0];
  const dz = segment.b[1] - segment.a[1];
  const length = Math.hypot(dx, dz);
  if (length < 28) continue;
  const seed = hash(segment.id + Math.round(segment.a[0] * 17) + Math.round(segment.a[1] * 31));
  if (seed % 5 > 1) continue;
  const random = rngFor(seed);
  const t = 0.25 + random() * 0.5;
  const ux = dx / length;
  const uz = dz / length;
  const side = random() < 0.5 ? -1 : 1;
  const cx = segment.a[0] + dx * t - uz * side * 5.4;
  const cz = segment.a[1] + dz * t + ux * side * 5.4;
  const geoCenter = toGeo([cx, cz]);
  if (!pointInRing(geoCenter, boundary)) continue;
  const halfLength = 2.15;
  const halfWidth = 0.9;
  const ringLocal = [
    [cx - ux * halfLength - uz * halfWidth, cz - uz * halfLength + ux * halfWidth],
    [cx + ux * halfLength - uz * halfWidth, cz + uz * halfLength + ux * halfWidth],
    [cx + ux * halfLength + uz * halfWidth, cz + uz * halfLength - ux * halfWidth],
    [cx - ux * halfLength + uz * halfWidth, cz - uz * halfLength - ux * halfWidth],
  ];
  const ring = ringLocal.map((point) => toGeo(point).map((value) => round(value)));
  ring.push([...ring[0]]);
  carros.push(feature("Polygon", [ring], { h: 1.45, col: carColors[Math.floor(random() * carColors.length)] }));
}

const quotedPoints = cotasRaw
  .filter((item) => item.geometry?.type === "Point" && Number.isFinite(Number(item.properties?.cd_altitude)))
  .map((item) => ({ lon: item.geometry.coordinates[0], lat: item.geometry.coordinates[1], altitude: Number(item.properties.cd_altitude) }));
if (!quotedPoints.length) throw new Error("GeoSampa nao retornou pontos cotados para o relevo");
const terrainSize = 64;
const terrainBase = Math.floor(Math.min(...quotedPoints.map((point) => point.altitude)) * 100) / 100;
const terrain = [];
for (let y = 0; y < terrainSize; y += 1) {
  const lat = bbox.south + (bbox.north - bbox.south) * y / (terrainSize - 1);
  const row = [];
  for (let x = 0; x < terrainSize; x += 1) {
    const lon = bbox.west + (bbox.east - bbox.west) * x / (terrainSize - 1);
    let numerator = 0;
    let denominator = 0;
    let exact = null;
    for (const point of quotedPoints) {
      const dx = (lon - point.lon) * metersLng;
      const dy = (lat - point.lat) * metersLat;
      const distance2 = dx * dx + dy * dy;
      if (distance2 < 1) {
        exact = point.altitude;
        break;
      }
      const weight = 1 / distance2;
      numerator += point.altitude * weight;
      denominator += weight;
    }
    const altitude = exact ?? numerator / denominator;
    row.push(round(altitude - terrainBase, 2));
  }
  terrain.push(row);
}
const relevo = {
  lon0: bbox.west,
  lon1: bbox.east,
  lat0: bbox.south,
  lat1: bbox.north,
  n: terrainSize,
  base: terrainBase,
  g: terrain,
};

const lines = [
  "/* Reconstrucao 3D do Campo Belo — dados reais.",
  "   GeoSampa (PMSP): edificacoes, lotes, calcadas, vegetacao e relevo.",
  "   OpenStreetMap: vias, areas verdes e arvores complementares.",
  "   Gerado por scripts/build_drone_geometry.mjs. */",
  `const BAIRRO_EDIF=${JSON.stringify(collection(edificacoes))};`,
  `const BAIRRO_VIAS=${JSON.stringify(collection(vias))};`,
  `const BAIRRO_VERDE=${JSON.stringify(collection(verdes))};`,
  `const BAIRRO_LOTES=${JSON.stringify(collection(lotes))};`,
  `const BAIRRO_CALCADAS=${JSON.stringify(collection(calcadas))};`,
  `const BAIRRO_ARVORES=${JSON.stringify(collection(arvores))};`,
  `const BAIRRO_CARROS=${JSON.stringify(collection(carros))};`,
  `const BAIRRO_RELEVO=${JSON.stringify(relevo)};`,
  `const BAIRRO_LIMITE=${JSON.stringify(boundary)};`,
  "",
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));
console.log(JSON.stringify({
  ok: true,
  buildings: edificacoes.length,
  streets: vias.length,
  greenAreas: verdes.length,
  lots: lotes.length,
  sidewalks: calcadas.length,
  vegetation: arvores.length,
  cars: carros.length,
  quotedPoints: quotedPoints.length,
  terrain: `${terrainSize}x${terrainSize}`,
  outputMB: round(fs.statSync(outputPath).size / 1048576, 2),
  outputPath,
}, null, 2));
