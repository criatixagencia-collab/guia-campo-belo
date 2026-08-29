# Drone 3D — Guia Campo Belo SP

Versão independente do simulador 3D do Campo Belo.

## Estrutura

- `index.html`: página pública que incorpora o simulador.
- `simulador/`: motor 3D, geometria do bairro e Three.js.
- `dados.js`: estabelecimentos convertidos do `index.html` principal.
- `assets/`: logotipo do Guia Campo Belo.
- `termos.html`: termos de uso e atribuição cartográfica.

## Atualização

Na raiz do projeto:

```bash
node scripts/build_drone_data.mjs
node scripts/build_drone_geometry.mjs
```

O primeiro comando sincroniza os estabelecimentos do guia. O segundo reconstrói
o perímetro Campo Belo (Bandeirantes, Washington Luís, Roberto Marinho e Santo
Amaro) com edificações, alturas, lotes, calçadas, vegetação e relevo oficiais do
GeoSampa. Ruas e elementos cartográficos complementares vêm do OpenStreetMap.

## Fonte cartográfica

Edificações, lotes, calçadas, vegetação e relevo: GeoSampa/PMSP. Ruas e dados
complementares: © OpenStreetMap contributors, disponíveis sob ODbL.
