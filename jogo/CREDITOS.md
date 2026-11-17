# Créditos — Campo Belo ao volante

## Carro

**Car Concept**, modelo e texturas © 2024 Darmstadt Graphics Group GmbH, artista **Eric Chadwick**. Licença [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

Fonte: [Khronos glTF Sample Assets — CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept). Arquivo original `glTF-Binary/CarConcept.glb`, preservado em `assets/CarConcept.glb`. Metadados originais em `assets/car-license.json`.

Adaptações nesta prévia: pintura vermelha metálica com verniz, escala de jogo, rodas animadas, vidro simplificado, agrupamento de peças por material e ocultação de peças mecânicas internas para reduzir o custo de desenho. O original não foi sobrescrito. A licença permite essas adaptações com atribuição; os autores não endossam este projeto.

Os logotipos Khronos e 3D Commerce que integram o modelo mantêm suas regras próprias, copiadas em `assets/khronos-marks.txt`. Não são marcas deste jogo.

## Motor gráfico

[Three.js r158](https://github.com/mrdoob/three.js/tree/r158), © autores do Three.js, licença MIT em `vendor/THREE-LICENSE.txt`. O motor é reutilizado do arquivo local `site/drone/simulador/three.module.js`; GLTFLoader e BufferGeometryUtils são cópias oficiais da mesma versão, com ajuste do caminho de importação local.

## Cidade e estabelecimentos

Geometria já existente da mini cidade Campo Belo: GeoSampa/PMSP e © OpenStreetMap contributors. Malhas, relevo, vias, categorias e estabelecimentos vêm do protótipo local de 30/10/2026. Contornos de colisão vêm exclusivamente de `site/drone/simulador/bairro3d.js`. Procedência detalhada no README daquele protótipo.

As janelas e os materiais são tratamentos visuais ilustrativos, não fotos ou reprodução de fachadas reais. Não foram importados bairros, estabelecimentos ou coordenadas de outros projetos. O carro, as passagens da prova e a direção são ilustrativos e não representam trânsito observado.

Forza e GTA serviram apenas como referência de perspectiva e sensação de câmera. Nenhum código, modelo, textura, marca visual ou áudio desses jogos foi incorporado.

## Texturas e céu

Arquivos em `assets/texturas/`, todos do [Poly Haven](https://polyhaven.com/license), licença CC0: `clean_asphalt`, `concrete_pavement_03`, `plastered_wall`, `clay_roof_tiles_02` (difuso 1k) e o HDRI `canary_wharf` 1k (Andreas Mischok). `vendor/RGBELoader.js` é a cópia oficial do Three.js r158 (MIT). As texturas dão o detalhe de asfalto, calçada, reboco e telhas; o HDRI é usado só nos reflexos do carro (é uma rua de Londres, não uma imagem do Campo Belo).
