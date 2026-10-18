/*
 * Rotor tipi temsil görselleri – vektörel çizim.
 * Referans görsel kütüphanesindeki (Static, Centered, Center + Right, ...) sahneleri
 * aynı şekil listesi biçiminde üretir; Schematic.toSVG (ekran) ve Schematic.toPDF (rapor)
 * ile her çözünürlükte keskin basılır.
 */
(function (root) {
  "use strict";

  const W = 400;
  const CY = 84; // şaft ekseni
  const BASE = CY + 102; // kızak üst kenarı
  const H = BASE + 40;
  const OBL = 0.28; // eğik görünüş: elips yatay yarıçap oranı

  const COL = {
    railTop: "#eef1f4",
    railSide: "#dfe4e9",
    railLine: "#cfd6dd",
    stand: "#f6f8fa",
    standSide: "#e9edf1",
    standLine: "#cdd4dc",
    body: "#c3cedb",
    bodyHi: "#e3e9ef",
    bodyLo: "#a7b4c3",
    face: "#d9e1e9",
    line: "#8e9caf",
    ring: "#1e88e5",
    ringBack: "#1565c0",
    ringHi: "#90caf9",
  };

  // Sahne tanımları (sağ yönlü); sol varyantlar aynalanarak üretilir.
  const SCENES = {
    static: {
      bearings: [92, 308],
      shaft: [28, 372, 7],
      journals: [[60, 140, 11], [260, 340, 11]],
      discs: [[140, 262, 44]],
      rings: [[200, 54, 11]],
    },
    centered: {
      bearings: [118, 292],
      shaft: [44, 356, 6],
      journals: [[95, 150, 9], [250, 310, 9]],
      discs: [[160, 192, 26], [210, 252, 33]],
      rings: [[176, 34, 7], [231, 41, 7]],
    },
    "center-right": {
      bearings: [108, 262],
      shaft: [34, 372, 6],
      journals: [[130, 160, 9], [215, 290, 9]],
      discs: [[160, 196, 25], [298, 344, 36]],
      rings: [[178, 33, 7], [321, 44, 7]],
    },
    "overhung-right": {
      bearings: [92, 232],
      shaft: [26, 362, 6],
      journals: [[200, 270, 9]],
      discs: [[272, 306, 32], [306, 350, 37]],
      rings: [[289, 40, 7], [328, 45, 7]],
    },
    polar: {
      bearings: [112, 288],
      shaft: [40, 372, 6],
      journals: [[85, 130, 10], [262, 318, 9]],
      discs: [[46, 86, 28], [318, 360, 36]],
      rings: [[66, 36, 7], [339, 44, 7]],
    },
  };
  const mirror = (sc) => {
    const m = (x) => W - x;
    const seg = ([a, b, r]) => [m(b), m(a), r];
    return {
      bearings: sc.bearings.map(m).sort((a, b) => a - b),
      shaft: seg(sc.shaft),
      journals: sc.journals.map(seg),
      discs: sc.discs.map(seg),
      rings: sc.rings.map(([x, r, w]) => [m(x), r, w]),
    };
  };
  SCENES["center-left"] = mirror(SCENES["center-right"]);
  SCENES["overhung-left"] = mirror(SCENES["overhung-right"]);

  /** Elips yayı noktaları (açılar radyan; 0 = sağ, π/2 = alt). */
  function arc(cx, cy, rx, ry, a0, a1, n = 28) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([+(cx + rx * Math.cos(a)).toFixed(2), +(cy + ry * Math.sin(a)).toFixed(2)]);
    }
    return pts;
  }

  /** Eksen boyunca silindir: gövde gölgelendirmesi + sağda görünen alın yüzeyi. */
  function cylinder(shapes, x0, x1, R) {
    const rx = R * OBL;
    shapes.push({ t: "ellipse", cx: x0, cy: CY, rx, ry: R, fill: COL.bodyLo, stroke: COL.line, width: 0.8 });
    shapes.push({ t: "rect", x: x0, y: CY - R, w: x1 - x0, h: 2 * R, fill: COL.body, stroke: "none" });
    shapes.push({ t: "rect", x: x0, y: CY - R * 0.62, w: x1 - x0, h: R * 0.42, fill: COL.bodyHi, stroke: "none" });
    shapes.push({ t: "rect", x: x0, y: CY + R * 0.5, w: x1 - x0, h: R * 0.5, fill: COL.bodyLo, stroke: "none" });
    shapes.push({ t: "line", x1: x0, y1: CY - R, x2: x1, y2: CY - R, stroke: COL.line, width: 0.8 });
    shapes.push({ t: "line", x1: x0, y1: CY + R, x2: x1, y2: CY + R, stroke: COL.line, width: 0.8 });
    shapes.push({ t: "ellipse", cx: x1, cy: CY, rx, ry: R, fill: COL.face, stroke: COL.line, width: 0.8 });
    if (R > 14) shapes.push({ t: "ellipse", cx: x1 + rx * 0.08, cy: CY, rx: rx * 0.45, ry: R * 0.45, fill: "none", stroke: "#b6c2cf", width: 0.8 });
  }

  function stand(shapes, x) {
    const top = CY + 4;
    const base = BASE;
    // yan (derinlik) yüzü
    shapes.push({ t: "poly", pts: [[x + 16, top - 4], [x + 26, top - 12], [x + 26, base - 8], [x + 16, base]], fill: COL.standSide, stroke: COL.standLine, width: 0.8 });
    // gövde
    shapes.push({ t: "poly", pts: [[x - 16, top - 4], [x + 16, top - 4], [x + 16, base], [x - 16, base]], fill: COL.stand, stroke: COL.standLine, width: 0.8 });
    // pencere
    shapes.push({ t: "rect", x: x - 8, y: top + 28, w: 16, h: base - top - 44, r: 3, fill: "#eceff3", stroke: COL.standLine, width: 0.6 });
    // V yataklı başlık
    shapes.push({
      t: "poly",
      pts: [[x - 22, CY - 8], [x - 7, CY - 8], [x, CY + 2], [x + 7, CY - 8], [x + 22, CY - 8], [x + 22, CY + 14], [x - 22, CY + 14]],
      fill: COL.stand, stroke: COL.standLine, width: 0.9,
    });
    shapes.push({ t: "poly", pts: [[x + 22, CY - 8], [x + 30, CY - 15], [x + 30, CY + 7], [x + 22, CY + 14]], fill: COL.standSide, stroke: COL.standLine, width: 0.8 });
  }

  function build(key) {
    const sc = SCENES[key] || SCENES.centered;
    const shapes = [];
    // Kızaklar
    shapes.push({ t: "poly", pts: [[6, BASE], [394, BASE], [394, BASE + 10], [6, BASE + 10]], fill: COL.railTop, stroke: COL.railLine, width: 0.8 });
    shapes.push({ t: "poly", pts: [[6, BASE + 10], [394, BASE + 10], [394, BASE + 20], [6, BASE + 20]], fill: COL.railSide, stroke: COL.railLine, width: 0.8 });
    shapes.push({ t: "poly", pts: [[6, BASE + 26], [394, BASE + 26], [394, BASE + 34], [6, BASE + 34]], fill: COL.railTop, stroke: COL.railLine, width: 0.8 });
    shapes.push({ t: "line", x1: 6, y1: BASE + 5, x2: 394, y2: BASE + 5, stroke: "#ffffff", width: 1.2 });

    sc.bearings.forEach((x) => stand(shapes, x));

    // Halkaların arka yarıları (rotorun arkasında kalır)
    sc.rings.forEach(([x, R, w]) => {
      shapes.push({ t: "poly", open: true, pts: arc(x, CY, R * OBL, R, Math.PI / 2, (3 * Math.PI) / 2), stroke: COL.ringBack, width: w * 1.25 });
    });

    // Şaft ve muylular
    const [s0, s1, sr] = sc.shaft;
    cylinder(shapes, s0, s1, sr);
    sc.journals.forEach(([a, b, r]) => cylinder(shapes, a, b, r));
    // Diskler soldan sağa (sağdaki disk soldakinin alın yüzünü örter)
    sc.discs
      .slice()
      .sort((a, b) => a[0] - b[0])
      .forEach(([a, b, r]) => cylinder(shapes, a, b, r));

    // Halkaların ön yarıları + parlak kenar
    sc.rings.forEach(([x, R, w]) => {
      shapes.push({ t: "poly", open: true, pts: arc(x, CY, R * OBL, R, -Math.PI / 2, Math.PI / 2), stroke: COL.ring, width: w * 1.25 });
      shapes.push({ t: "poly", open: true, pts: arc(x + w * 0.18, CY, R * OBL, R - w * 0.3, -Math.PI / 2.4, Math.PI / 6), stroke: COL.ringHi, width: Math.max(1, w * 0.22) });
    });
    return { w: W, h: H, shapes };
  }

  root.TypeArt = { build, SCENES };
})(typeof self !== "undefined" ? self : this);
