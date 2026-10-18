/*
 * Balans hesap motoru (saf fonksiyonlar, DOM bağımlılığı yok).
 * Tarayıcıda window.BalCalc, Node'da module.exports olarak kullanılır.
 *
 * Birimler: kütle [g], konum/yarıçap [mm], hız [rpm], G [mm/s],
 *           dengesizlik [g·mm], artık kütle [g].
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BalCalc = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ISO 21940-11 balans kalite sınıfları (G, mm/s)
  const G_GRADES = [0.4, 1, 2.5, 6.3, 16, 40, 100, 250, 630, 1600, 4000];
  const G_GRADES_EXT = [0.4, 1, 1.6, 2.5, 6.3, 16, 40, 100, 250, 630, 1600, 4000];

  // ISO 21940-11: yatak düzlemi payları en az %30, en çok %70
  const ALLOC_MIN = 0.3;
  const ALLOC_MAX = 0.7;

  const ROTOR_TYPES = {
    static: { key: "static", name: "Statik (Tek Düzlem)", nameEn: "Static", planes: 1 },
    centered: { key: "centered", name: "Yataklar Arası (Ortalanmış)", nameEn: "Centered", planes: 2 },
    "center-right": { key: "center-right", name: "Orta + Sağ Çıkıntı", nameEn: "Center + Right", planes: 2 },
    "overhung-right": { key: "overhung-right", name: "Sağ Çıkıntılı (Overhung)", nameEn: "Overhung Right", planes: 2 },
    polar: { key: "polar", name: "Polar (İki Uç Çıkıntılı)", nameEn: "Polar", planes: 2 },
    "center-left": { key: "center-left", name: "Orta + Sol Çıkıntı", nameEn: "Center + Left", planes: 2 },
    "overhung-left": { key: "overhung-left", name: "Sol Çıkıntılı (Overhung)", nameEn: "Overhung Left", planes: 2 },
  };

  const num = (v) => {
    if (v === null || v === undefined || v === "") return NaN;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  const isSet = (v) => Number.isFinite(num(v));

  /** Genel/proses değer mirası: proses değeri girilmişse o, yoksa genel değer. */
  function resolveParams(process, global) {
    const ov = (process && process.overrides) || {};
    const out = { sources: {} };
    for (const k of ["serviceSpeed", "balanceSpeed", "G"]) {
      if (isSet(ov[k])) {
        out[k] = num(ov[k]);
        out.sources[k] = "process";
      } else {
        out[k] = num(global && global[k]);
        out.sources[k] = "global";
      }
    }
    return out;
  }

  /** Tüm parçalardaki noktaları {point, part} çiftleri olarak döndürür. */
  function allPoints(state) {
    const list = [];
    for (const part of state.parts || []) {
      for (const pt of part.points || []) list.push({ point: pt, part });
    }
    return list;
  }

  function classify(x, xA, xB, eps) {
    if (x < xA - eps) return "left";
    if (x > xB + eps) return "right";
    return "between";
  }

  const SIDE_TR = { left: "sol yatağın dışında", right: "sağ yatağın dışında", between: "yataklar arasında" };

  function cgDescription(xcg, xA, xB, L) {
    const pct = ((xcg - xA) / L) * 100;
    let where;
    if (pct < 0) where = "sol yatağın dışında (çıkıntılı)";
    else if (pct > 100) where = "sağ yatağın dışında (çıkıntılı)";
    else if (pct >= 40 && pct <= 60) where = "ortada";
    else if (pct < 40) where = "sol yatağa yakın";
    else where = "sağ yatağa yakın";
    return { pct, where };
  }

  /**
   * Otomatik rotor tipi tespiti.
   * Girdi: yatak konumları (xA < xB), düzlem konumları, X_cg, düzlem sayısı.
   */
  function detectType({ xA, xB, planesX, xcg }) {
    const L = xB - xA;
    const eps = Math.max(0.5, Math.abs(L) * 0.005);
    const f = (v) => fmt(v, 1);
    const cg = cgDescription(xcg, xA, xB, L);
    const cgTxt = `X_cg = ${f(xcg)} mm (yatak açıklığının %${fmt(cg.pct, 0)} konumu, ${cg.where})`;
    const notes = [];

    if (planesX.length === 1) {
      const side = classify(planesX[0], xA, xB, eps);
      const t = ROTOR_TYPES.static;
      const reason =
        `Tek düzeltme düzlemi seçildiği için statik (tek düzlem) balans uygulanır. ` +
        `Düzlem x_p = ${f(planesX[0])} mm ile ${SIDE_TR[side]}; ${cgTxt}. ` +
        `Bu nedenle '${t.name}' olarak belirlendi.`;
      const off = Math.abs(planesX[0] - xcg);
      if (off > Math.abs(L) * 0.15)
        notes.push(
          `Düzlem kütle merkezinden ${f(off)} mm uzakta: tek düzlem düzeltmesi bir çift (couple) dengesizlik bırakabilir; 2 düzlem önerilir.`
        );
      return { ...t, reason, notes, sides: [side] };
    }

    const [p1, p2] = planesX.slice().sort((a, b) => a - b);
    const s1 = classify(p1, xA, xB, eps);
    const s2 = classify(p2, xA, xB, eps);
    const key =
      {
        "between|between": "centered",
        "between|right": "center-right",
        "right|right": "overhung-right",
        "left|right": "polar",
        "left|between": "center-left",
        "left|left": "overhung-left",
      }[`${s1}|${s2}`] || "centered";
    const t = ROTOR_TYPES[key];
    const geo = `x_b1 = ${f(xA)}, x_b2 = ${f(xB)}; x_p1 = ${f(p1)} (${SIDE_TR[s1]}), x_p2 = ${f(p2)} (${SIDE_TR[s2]})`;
    const lead = {
      centered: "Her iki düzlem yataklar arasında",
      "center-right": "Düzlem 1 yataklar arasında, düzlem 2 sağ yatağın dışında",
      "overhung-right": "Her iki düzlem sağ yatağın dışında",
      polar: "Düzlemler iki yatağın dışında, zıt uçlarda",
      "center-left": "Düzlem 1 sol yatağın dışında, düzlem 2 yataklar arasında",
      "overhung-left": "Her iki düzlem sol yatağın dışında",
    }[key];
    const reason = `${lead} (${geo}) ve ${cgTxt} olduğu için '${t.name}' olarak belirlendi.`;

    if (key === "centered" && (cg.pct < 0 || cg.pct > 100))
      notes.push("Düzlemler yataklar arasında ancak kütle merkezi yatak dışında; yatak payları ISO sınırlarına kırpıldı.");
    if ((key === "overhung-right" && cg.pct < 100) || (key === "overhung-left" && cg.pct > 0))
      notes.push("Çıkıntılı düzlem yerleşimi; kütle merkezi yataklar arasında kalıyor.");
    if (Math.abs(p2 - p1) < Math.abs(L) * 0.1)
      notes.push("Düzlemler birbirine çok yakın (b < L/10); çift dengesizlik düzeltme kabiliyeti zayıftır.");
    return { ...t, reason, notes, sides: [s1, s2] };
  }

  /**
   * Bir prosesin tüm hesabını yapar. Dönen nesne hem özet hem detay panelini besler.
   */
  function computeProcess(state, process) {
    const errors = [];
    const warnings = [];
    const params = resolveParams(process, state.global);
    const res = { processId: process.id, params, errors, warnings, valid: false };

    // --- Parçalar & kütle merkezi entegrasyonu
    const selParts = (state.parts || []).filter((p) => (process.partIds || []).includes(p.id));
    res.parts = selParts;
    if (!selParts.length) errors.push("Prosese en az bir parça seçilmelidir.");
    const cgRows = [];
    let M = 0;
    let Mx = 0;
    for (const p of selParts) {
      const m = num(p.mass);
      const x = num(p.x);
      if (!(m > 0)) errors.push(`'${p.name || "?"}' parçasının kütlesi geçersiz.`);
      if (!Number.isFinite(x)) errors.push(`'${p.name || "?"}' parçasının x konumu geçersiz.`);
      if (m > 0 && Number.isFinite(x)) {
        M += m;
        Mx += m * x;
        cgRows.push({ part: p, m, x, mx: m * x, cumM: M, cumMx: Mx, cumX: Mx / M });
      }
    }
    res.cgRows = cgRows;
    res.mass = M;
    res.xcg = M > 0 ? Mx / M : NaN;
    res.momentSum = Mx;

    // --- Yataklar
    const selBearings = (state.bearings || [])
      .filter((b) => (process.bearingIds || []).includes(b.id))
      .map((b) => ({ ...b, xv: num(b.x) }));
    if (selBearings.length !== 2) errors.push("Proseste tam olarak 2 referans yatak seçilmelidir.");
    selBearings.sort((a, b) => a.xv - b.xv);
    const [bA, bB] = selBearings;
    res.bearings = selBearings;
    if (selBearings.length === 2) {
      if (!selBearings.every((b) => Number.isFinite(b.xv))) errors.push("Yatak konumları geçersiz.");
      else if (bB.xv - bA.xv <= 0) errors.push("İki yatak aynı konumda olamaz.");
    }

    // --- Düzeltme düzlemleri
    const nPlanes = process.planes === 1 ? 1 : 2;
    res.nPlanes = nPlanes;
    const pts = allPoints(state);
    const allowed = pts.filter((pp) => selParts.includes(pp.part));
    const chosen = (process.pointIds || [])
      .slice(0, nPlanes)
      .map((id) => allowed.find((pp) => pp.point.id === id))
      .filter(Boolean);
    if (chosen.length !== nPlanes)
      errors.push(`${nPlanes} düzlem için seçili parçalara ait ${nPlanes} balans noktası seçilmelidir.`);
    const planes = chosen
      .map((pp) => ({ point: pp.point, part: pp.part, x: num(pp.point.x), r: num(pp.point.r) }))
      .sort((a, b) => a.x - b.x);
    for (const pl of planes) {
      if (!Number.isFinite(pl.x)) errors.push(`'${pl.point.name}' noktasının x konumu geçersiz.`);
      if (!(pl.r > 0)) errors.push(`'${pl.point.name}' noktasının yarıçapı (r) sıfırdan büyük olmalıdır.`);
    }
    if (planes.length === 2 && planes[0].x === planes[1].x) errors.push("İki düzeltme düzlemi aynı eksenel konumda olamaz.");
    res.planes = planes;

    // --- Hız / kalite
    if (!(params.serviceSpeed > 0)) errors.push("Operasyonel (servis) hız tanımlı olmalıdır.");
    if (!(params.G > 0)) errors.push("Balans kalite sınıfı (G) tanımlı olmalıdır.");
    if (!(params.balanceSpeed > 0)) warnings.push("Balans hızı tanımlı değil.");
    if (params.balanceSpeed > params.serviceSpeed)
      warnings.push("Balans hızı servis hızından büyük.");

    if (errors.length) return res;

    const xA = bA.xv;
    const xB = bB.xv;
    const L = xB - xA;
    const xcg = res.xcg;
    res.L = L;
    res.LA = xcg - xA;
    res.LB = xB - xcg;

    // --- Statik yatak yükleri (moment dengesi)
    res.reactions = { A: (M * (xB - xcg)) / L, B: (M * (xcg - xA)) / L };

    // --- ISO 21940-11: U_per = 1000·G·M[kg]/Ω = G·M[g]/Ω
    const omega = (2 * Math.PI * params.serviceSpeed) / 60;
    const Uper = (params.G * M) / omega;
    res.omega = omega;
    res.Uper = Uper;
    res.eper = Uper / M; // özgül dengesizlik [g·mm/g = mm] → µm için ×1000

    // --- Yatak düzlemlerine dağıtım
    const rawA = res.LB / L;
    const rawB = res.LA / L;
    const kA = Math.min(ALLOC_MAX, Math.max(ALLOC_MIN, rawA));
    const kB = Math.min(ALLOC_MAX, Math.max(ALLOC_MIN, rawB));
    res.alloc = { rawA, rawB, kA, kB, clamped: kA !== rawA || kB !== rawB, UA: Uper * kA, UB: Uper * kB };

    // --- Tip tespiti
    res.type = detectType({ xA, xB, planesX: planes.map((p) => p.x), xcg });
    warnings.push(...res.type.notes);

    // --- Düzeltme düzlemlerine transfer
    if (nPlanes === 1) {
      const pl = planes[0];
      pl.U = Uper;
      pl.m = Uper / pl.r;
      res.transfer = { mode: "static" };
      res.abc = { a: pl.x - xA, b: null, c: xB - pl.x };
    } else {
      const [p1, p2] = planes;
      const cA1 = (xB - p1.x) / L;
      const cA2 = (xB - p2.x) / L;
      const cB1 = (p1.x - xA) / L;
      const cB2 = (p2.x - xA) / L;
      const { UA, UB } = res.alloc;
      const dA = Math.abs(cA1) * UA + Math.abs(cA2) * UB;
      const dB = Math.abs(cB1) * UA + Math.abs(cB2) * UB;
      const sA = UA / dA;
      const sB = UB / dB;
      // ISO 21940-11: düzlemler yataklar arasında ve yeterince açık (b ≥ L/3) ise
      // yatak düzlemi toleransları doğrudan düzeltme düzlemlerine alınır.
      const direct = res.type.key === "centered" && p2.x - p1.x >= L / 3;
      const s = direct ? 1 : Math.min(1, sA, sB);
      p1.U = s * UA;
      p2.U = s * UB;
      p1.m = p1.U / p1.r;
      p2.m = p2.U / p2.r;
      res.transfer = { mode: "dynamic", direct, cA1, cA2, cB1, cB2, dA, dB, sA, sB, s };
      res.abc = { a: p1.x - xA, b: p2.x - p1.x, c: xB - p2.x };
      if (s < 0.999)
        warnings.push(
          `Düzlem geometrisi nedeniyle düzlem toleransları yatak paylarına göre %${fmt((1 - s) * 100, 0)} azaltıldı (s = ${fmt(s, 3)}).`
        );
    }
    res.valid = true;
    return res;
  }

  function fmt(v, d = 2) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    return v.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** Değer büyüklüğüne göre anlamlı basamak sayısı. */
  function fmtAuto(v, sig = 3) {
    if (!Number.isFinite(v)) return "–";
    if (v === 0) return "0";
    const d = Math.max(0, Math.min(6, sig - 1 - Math.floor(Math.log10(Math.abs(v)))));
    return fmt(v, d);
  }

  return {
    G_GRADES,
    G_GRADES_EXT,
    ROTOR_TYPES,
    ALLOC_MIN,
    ALLOC_MAX,
    num,
    isSet,
    resolveParams,
    allPoints,
    detectType,
    computeProcess,
    fmt,
    fmtAuto,
  };
});
