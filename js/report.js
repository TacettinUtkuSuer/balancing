/*
 * PDF rapor üretimi (jsPDF). Her proses tam olarak 1 A4 sayfadır:
 * tüm bloklar sabit yükseklikte yerleştirilir, değişken uzunluktaki
 * tablo ve metinler ayrılan alana sığacak şekilde küçültülür / kırpılır.
 */
(function (root) {
  "use strict";
  const C = root.BalCalc;
  const S = root.Schematic;

  const PAGE_W = 210;
  const PAGE_H = 297;
  const M = 14; // içerik kenar boşluğu
  // Yazıcıların basamadığı kenar bölgesi (~4–6 mm) için güvenli sınır: hiçbir çizim kenara
  // bundan daha fazla yaklaşmaz.
  const SAFE = 10;
  const CW = PAGE_W - 2 * M;
  const INK = [31, 42, 51];
  const MUTED = [100, 116, 139]; // ikincil bilgiler
  const LABEL = [51, 65, 85]; // önemli etiketler (baskıda okunur kalsın)
  const LINE = [195, 202, 211];
  // Şirket renkleri: füme / siyah ana tonlar, sarı yalnızca ince vurgu (şema mavi kalır)
  const CHAR = [43, 47, 51];
  const BLACK = [17, 17, 17];
  const YELLOW = [242, 183, 5];
  const YELLOW_SOFT = [255, 244, 209];
  const PAPER = [250, 250, 248];
  const AMBER = [150, 90, 0]; // opsiyonel adım
  const NOTE_BG = [255, 249, 225];
  const NOTE_LINE = [217, 170, 60];

  const TRANSLIT = { ş: "s", Ş: "S", ğ: "g", Ğ: "G", ı: "i", İ: "I", "−": "-", "≤": "<=", "≥": ">=", "…": "..." };

  function setupFonts(doc) {
    const F = root.REPORT_FONTS;
    if (F && F.regular && F.bold) {
      doc.addFileToVFS("LS-Regular.ttf", F.regular);
      doc.addFont("LS-Regular.ttf", "LS", "normal");
      doc.addFileToVFS("LS-Bold.ttf", F.bold);
      doc.addFont("LS-Bold.ttf", "LS", "bold");
      return { name: "LS", t: (s) => String(s ?? "") };
    }
    return { name: "helvetica", t: (s) => String(s ?? "").replace(/[şŞğĞıİ−≤≥…]/g, (c) => TRANSLIT[c]) };
  }

  /**
   * @param opts.summary  true ise ilk sayfa proses özeti olur (tüm raporlar çıktısı)
   */
  function generate(state, processIds, opts = {}) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const font = setupFonts(doc);
    const procs = processIds.map((id) => state.processes.find((p) => p.id === id)).filter(Boolean);
    const total = state.processes.length;
    const offset = opts.summary ? 1 : 0;
    const pageCount = procs.length + offset;
    if (opts.summary) drawSummary(doc, font, state, procs, pageCount);
    procs.forEach((p, i) => {
      if (i + offset > 0) doc.addPage("a4", "portrait");
      const r = C.computeProcess(state, p);
      drawPage(doc, font, state, p, r, state.processes.indexOf(p) + 1, total, i + 1 + offset, pageCount);
    });
    doc.setProperties({ title: `Balans Talimatnamesi – ${state.meta.rotorId || ""}`, subject: "ISO 21940-11 balans talimatı", creator: "Balans Talimatnamesi" });
    return doc;
  }

  /** Sayfa çizim yardımcıları (metin, kırpma, çizgi, kutu, anahtar–değer). */
  function kit(doc, font) {
    const T = font.t;
    const f = C.fmt;
    const fa = C.fmtAuto;
    const txt = (s, x, y, o = {}) => {
      doc.setFont(font.name, o.bold ? "bold" : "normal");
      doc.setFontSize(o.size || 9);
      doc.setTextColor(...(o.color || INK));
      doc.text(T(s), x, y, { align: o.align || "left", baseline: o.baseline || "alphabetic" });
    };
    /** Metni genişliğe sığdır (gerekirse "…" ile kırp). */
    const fit = (s, w, size, bold) => {
      doc.setFont(font.name, bold ? "bold" : "normal");
      doc.setFontSize(size);
      let str = T(s);
      if (doc.getTextWidth(str) <= w) return str;
      while (str.length > 1 && doc.getTextWidth(str + "…") > w) str = str.slice(0, -1);
      return str + T("…");
    };
    const hline = (y, x1 = M, x2 = PAGE_W - M, w = 0.4, col = INK) => {
      doc.setDrawColor(...col);
      doc.setLineWidth(w);
      doc.line(x1, y, x2, y);
    };
    const section = (title, y) => {
      txt(title, M, y, { size: 12.5, bold: false });
      hline(y + 1.6, M, PAGE_W - M, 0.35);
    };
    const box = (x, y, w, h, fill, stroke = LINE, lw = 0.3) => {
      doc.setDrawColor(...stroke);
      doc.setLineWidth(lw);
      if (fill) doc.setFillColor(...fill);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, fill ? "FD" : "S");
    };
    const kv = (rows, x, y, labelW, step = 4.6, size = 9) => {
      rows.forEach(([k, v, bold], i) => {
        txt(k, x, y + i * step, { size, color: LABEL });
        doc.setFont(font.name, bold ? "bold" : "normal");
        txt(fit(v, 999, size, bold), x + labelW, y + i * step, { size, bold });
      });
    };
    /** Küçük etiket (rozet); genişliğini döndürür. */
    const pill = (x, y, text, bg, fg, size = 7.5) => {
      doc.setFont(font.name, "bold");
      doc.setFontSize(size);
      const w = doc.getTextWidth(T(text)) + 3.6;
      const h = size * 0.5;
      doc.setFillColor(...bg);
      doc.roundedRect(x, y - h + 0.9, w, h, 1, 1, "F");
      txt(text, x + 1.8, y, { size, bold: true, color: fg });
      return w;
    };
    return { T, f, fa, txt, fit, hline, section, box, kv, pill };
  }

  /**
   * Özet (kapak) sayfası: ürün ve yapılacak işin sade, genel tanımı + adım listesi.
   * Metinler sabit şablondur; verilerden yalnızca adlar ve temel sonuçlar eklenir.
   */
  function drawSummary(doc, font, state, procs, pageCount) {
    const { T, f, txt, fit, hline, section, box, kv, pill } = kit(doc, font);
    const m = state.meta;
    const dateStr = new Date().toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
    const R = procs.map((p) => ({ p, r: C.computeProcess(state, p) }));
    const nOpt = procs.filter((p) => p.optional).length;
    const rotorName = m.rotorId || "şaft";
    const g = state.global;

    // Kapak çerçevesi ve başlık bandı
    const FX = SAFE;
    const FW = PAGE_W - 2 * FX;
    const bandH = 40;
    doc.setFillColor(...CHAR);
    doc.roundedRect(FX, FX, FW, bandH, 3, 3, "F");
    doc.rect(FX, FX + 4, FW, bandH - 4, "F");
    doc.setFillColor(...YELLOW);
    doc.rect(FX, FX + bandH, FW, 1.4, "F");
    // Bantta yalnızca proje başlığı
    {
      const title = (m.title || "").trim() || rotorName;
      doc.setFont(font.name, "bold");
      doc.setFontSize(22);
      let lines = doc.splitTextToSize(T(title), CW);
      if (lines.length > 2) lines = [lines[0], fit(lines.slice(1).join(" "), CW, 22, true)];
      doc.setTextColor(255, 255, 255);
      const ty = lines.length === 1 ? FX + bandH / 2 + 3 : FX + bandH / 2 - 1.5;
      lines.forEach((l, i) => doc.text(l, M, ty + i * 9));
    }
    doc.setDrawColor(...CHAR);
    doc.setLineWidth(0.8);
    doc.roundedRect(FX, FX, FW, PAGE_H - 2 * FX, 3, 3, "S");

    const ky = FX + bandH + 9;
    kv(
      [
        ["SAT / SAS Kodu", m.orderNo || "–"],
        ["Şaft Adı", m.rotorId || "–", true],
        ["Tanım", fit(m.rotorModel || "–", 60, 9)],
      ],
      M + 4, ky, 30
    );
    kv(
      [
        ["Hazırlanma Tarihi", dateStr],
        ["Proses Adımı", nOpt ? `${procs.length}  (${nOpt} opsiyonel)` : `${procs.length}`, true],
        ["Hazırlayan / Operatör", fit(m.operator || "–", 40, 9)],
      ],
      112, ky, 38
    );

    // Genel not (varsa)
    let y = ky + 19;
    if ((m.notes || "").trim()) {
      txt("Not", M + 4, y - 4, { size: 9, color: LABEL });
      doc.setFont(font.name, "normal");
      doc.setFontSize(9);
      let nl = doc.splitTextToSize(T(m.notes.trim()), CW - 38);
      if (nl.length > 2) nl = [nl[0], fit(nl.slice(1).join(" "), CW - 38, 9)];
      doc.setTextColor(...INK);
      nl.forEach((l, i) => doc.text(l, M + 34, y - 4 + i * 4));
      y += nl.length * 4 + 1;
    }

    // Ne yapılacak?
    section("Bu doküman ne anlatıyor?", y);
    y += 7;
    const para = (text, size = 10) => {
      doc.setFont(font.name, "normal");
      doc.setFontSize(size);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(T(text), CW);
      lines.forEach((l, i) => doc.text(l, M, y + i * size * 0.45));
      y += lines.length * size * 0.45 + 2.5;
    };
    para(
      `Bu doküman, ${rotorName} için montaj sırasında uygulanacak balans işlemlerini özetler. ` +
        `Rotor tek seferde değil, ${procs.length} adımda balanslanır: her adımda o ana kadar takılmış parçalarla ` +
        `birlikte balans alınır ve kalan dengesizlik izin verilen sınırın altına indirilir. ` +
        `Böylece her yeni parça takıldığında rotor dengeli kalır.`
    );
    para(
      `İzin verilen sınırlar ISO 21940-11 standardına göre, rotorun kütlesi, çalışma hızı ve istenen ` +
        `balans kalitesinden (G sınıfı) hesaplanır. Operatör için sonuç, her düzeltme düzleminde ` +
        `bırakılabilecek en fazla artık kütledir (mg / g).`
    );
    if (nOpt)
      para(
        `${nOpt === 1 ? "Bir adım" : `${nOpt} adım`} opsiyonel olarak işaretlenmiştir: bu adımların yapılması ` +
          `tercihe bağlıdır; gerekli görülmezse atlanabilir.`
      );

    // Ürün: tam genişlikte rotor şeması + nominal hız
    y += 2;
    section("Rotor", y);
    y += 4;
    const schH = 62;
    box(M, y, CW, schH, [255, 255, 255]);
    S.toPDF(doc, S.build(state, { w: Math.round((240 * (CW - 3)) / (schH - 3)), h: 240, print: true }), M + 1.5, y + 1.5, CW - 3, schH - 3, font.name);
    y += schH + 5;
    txt("Nominal (servis) hızı:", M + 2, y, { size: 9.5, color: LABEL });
    doc.setFont(font.name, "normal");
    doc.setFontSize(9.5);
    txt(`${f(C.num(g.serviceSpeed), 0)} rpm`, M + 4 + doc.getTextWidth(T("Nominal (servis) hızı:")), y, { size: 10, bold: true, color: BLACK });
    y += 9;

    // Adımlar
    section("Proses adımları", y);
    y += 4;
    const cols = [
      { h: "Adım", w: 24, a: "left" },
      { h: "Proses", w: CW - 24 - 28 - 26 - 34, a: "left" },
      { h: "Düzlem", w: 28, a: "left" },
      { h: "Kalite", w: 26, a: "right" },
      { h: "Toplam kütle", w: 34, a: "right" },
    ];
    const rowH = 7;
    const footerY = PAGE_H - SAFE - 11; // kapak çerçevesinin içinde
    const bottom = footerY - 30; // okuma rehberi için yer
    doc.setFillColor(236, 240, 244);
    doc.rect(M, y, CW, 6, "F");
    let cx = M;
    cols.forEach((c) => {
      txt(c.h, c.a === "right" ? cx + c.w - 2 : cx + 2, y + 4.2, { size: 8, bold: true, color: LABEL, align: c.a });
      cx += c.w;
    });
    y += 6;
    const maxRows = Math.max(1, Math.floor((bottom - y) / rowH));
    const shown = R.length > maxRows ? R.slice(0, maxRows - 1) : R;
    shown.forEach(({ p, r }, i) => {
      if (p.optional) {
        // Opsiyonel satır: açık sarı zemin + kesikli çerçeve
        doc.setFillColor(...YELLOW_SOFT);
        doc.rect(M, y + 0.4, CW, rowH - 0.8, "F");
        doc.setDrawColor(...CHAR);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1.2, 1], 0);
        doc.rect(M, y + 0.4, CW, rowH - 0.8, "S");
        doc.setLineDashPattern([], 0);
      } else if (i % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(M, y, CW, rowH, "F");
      }
      const vals = [
        String(state.processes.indexOf(p) + 1),
        p.name || "–",
        `${p.planes === 1 ? 1 : 2} düzlem`,
        Number.isFinite(r.params.G) ? `G ${C.fmtAuto(r.params.G, 2)}` : "–",
        r.mass > 0 ? `${f(r.mass, 1)} g` : "–",
      ];
      let x = M;
      if (p.optional) pill(M + 6, y + 4.6, "OPSİYONEL", CHAR, [255, 255, 255], 6.5);
      cols.forEach((c, j) => {
        const bold = j === 1 || j === 3;
        txt(fit(vals[j], c.w - 4, 9.5, bold), c.a === "right" ? x + c.w - 2 : x + 2, y + 4.8, { size: 9.5, bold, align: c.a, color: INK });
        x += c.w;
      });
      y += rowH;
    });
    if (shown.length < R.length) {
      txt(`… ve ${R.length - shown.length} adım daha (ayrıntılar sonraki sayfalarda)`, M + 2, y + 4.8, { size: 8.5, color: MUTED });
      y += rowH;
    }
    hline(y, M, PAGE_W - M, 0.25, LINE);
    if (nOpt) {
      const pw = pill(M + 2, y + 4.4, "OPSİYONEL", CHAR, [255, 255, 255], 6.5);
      txt("kesikli çerçeveli satırlar opsiyonel adımlardır; yapılması tercihe bağlıdır.", M + 4 + pw, y + 4.4, { size: 7.5, color: LABEL });
      y += 4;
    }

    // Okuma rehberi
    y += 10;
    txt("Sonraki sayfalarda", M, y, { size: 11 });
    hline(y + 1.2, M, PAGE_W - M, 0.25);
    [
      "Her proses adımı için ayrı bir sayfa: rotor tipi, şema ve her düzlem için izin verilen artık kütle ile dengesizlik.",
      "Balans geometrisi: yataktan yatağa ve yataktan düzleme mesafeler, düzeltme yarıçapları.",
      "ISO 21940-11 hesap özeti ve komşu standart G sınıflarıyla karşılaştırma.",
      "Proses notları ilgili adımın sayfasında, başlığın hemen altında yer alır.",
    ].forEach((l, i) => txt(fit(`•  ${l}`, CW, 8.5), M + 2, y + 6 + i * 4.6, { size: 8.5, color: LABEL }));

    hline(footerY, M, PAGE_W - M, 0.3, LINE);
    txt(fit(`Hazırlayan / Operatör: ${m.operator || "................................"}     Kontrol: ................................     ${m.notes || ""}`, CW - 30, 7.5), M, footerY + 4, { size: 7.5, color: MUTED });
    txt(`Sayfa 1 / ${pageCount}`, PAGE_W - M, footerY + 4, { size: 7.5, color: MUTED, align: "right" });
    txt(`Balans Talimatnamesi · ISO 21940-11 · ${dateStr}`, M, footerY + 7.5, { size: 6.5, color: MUTED });
  }

  function drawPage(doc, font, state, p, r, stepNo, stepTotal, pageNo, pageCount) {
    const { T, f, fa, txt, fit, hline, section, box, kv, pill } = kit(doc, font);

    // Proses notu ölçüsü (üst bölüm yerleşimi ve opsiyonel zemin için önceden hesaplanır)
    const note = (p.note || "").trim();
    let noteLines = [];
    if (note) {
      doc.setFont(font.name, "normal");
      doc.setFontSize(9.5);
      noteLines = doc.splitTextToSize(T(note), CW - 30);
      if (noteLines.length > 3) noteLines = [...noteLines.slice(0, 2), fit(noteLines.slice(2).join(" "), CW - 30, 9.5)];
    }
    const noteH = note ? 4 + noteLines.length * 4.3 : 0;
    const rowY = note ? 41.5 + noteH + 4.5 : 46; // üst sıranın (tip görseli + kutular) başladığı yer
    const topRowH = note ? 34 : 38;

    // Opsiyonel sayfa: yalnızca şemanın üstündeki bölüm açık renkli zeminle ayrılır (toner tasarrufu)
    if (p.optional) {
      doc.setFillColor(255, 248, 224);
      doc.roundedRect(M - 3.5, SAFE + 2.5, CW + 7, rowY + topRowH + 2.5 - (SAFE + 2.5), 2.5, 2.5, "F");
    }

    // ---------------- Başlık (şablon: "Balancing report")
    txt("Balans Talimatı", M, 20, { size: 22 });
    if (p.optional) {
      // Opsiyonel sayfa: belirgin koyu rozet ve kesikli sayfa çerçevesi
      doc.setFont(font.name, "normal");
      doc.setFontSize(22);
      const tw = doc.getTextWidth(T("Balans Talimatı"));
      const pw = pill(M + tw + 5, 19.3, "OPSİYONEL ADIM", CHAR, [255, 255, 255], 11);
      txt("yapılması tercihe bağlıdır", M + tw + 7 + pw, 19.3, { size: 8.5, bold: true, color: CHAR });
      doc.setDrawColor(...CHAR);
      doc.setLineWidth(0.6);
      doc.setLineDashPattern([3, 2], 0);
      doc.roundedRect(SAFE, SAFE, PAGE_W - 2 * SAFE, PAGE_H - 2 * SAFE, 2.5, 2.5, "S");
      doc.setLineDashPattern([], 0);
    }
    txt(`Proses ${stepNo} / ${stepTotal}`, PAGE_W - M, 20, { size: 9, color: MUTED, align: "right" });
    hline(23, M, PAGE_W - M, 0.6);
    const m = state.meta;
    const now = new Date();
    const dateStr = now.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
    kv(
      [
        ["SAT / SAS Kodu", m.orderNo || "–"],
        ["Şaft Adı", fit(m.rotorId || "–", 58, 9, true), true],
        ["Tanım", fit(m.rotorModel || "–", 58, 9)],
      ],
      M + 4, 28.5, 30
    );
    kv(
      [
        ["Proses", fit(p.name || `Proses ${stepNo}`, 52, 9, true), true],
        ["Hazırlanma Tarihi", dateStr],
        ["Balans Tarihi", ""],
      ],
      112, 28.5, 32
    );
    // Balans tarihi: elle doldurulacak boş alan
    doc.setDrawColor(...CHAR);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([0.6, 0.9], 0);
    doc.line(112 + 32, 28.5 + 2 * 4.6 + 0.8, PAGE_W - M, 28.5 + 2 * 4.6 + 0.8);
    doc.setLineDashPattern([], 0);

    // ---------------- Proses notu (varsa, başlığın hemen altında)
    let y = rowY;
    if (note) {
      const lines = noteLines;
      const nh = noteH;
      box(M, 41.5, CW, nh, NOTE_BG, NOTE_LINE, 0.5);
      txt("PROSES NOTU", M + 3, 46.3, { size: 8, bold: true, color: BLACK });
      doc.setFont(font.name, "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      lines.forEach((l, i) => doc.text(l, M + 27, 46.3 + i * 4.3));
    }

    // ---------------- Üst sıra: tip görseli + ana parametreler (kütle, G, hız)
    const pr = r.params;
    const src = (k) => (pr.sources[k] === "process" ? "prosese özel" : "genel");
    const leftW = 62;
    box(M, y, leftW, topRowH, [255, 255, 255]);
    if (r.valid) {
      const art = root.TypeArt.build(r.type.key);
      const iw = leftW - 6;
      const ih = Math.min(topRowH - 12, (iw * art.h) / art.w);
      S.toPDF(doc, art, M + 3, y + 1.5, iw, ih, font.name);
      txt(fit(r.type.name, leftW - 4, 10, true), M + leftW / 2, y + topRowH - 5.2, { size: 10, bold: true, color: CHAR, align: "center" });
      txt(`${r.type.nameEn} · otomatik tespit`, M + leftW / 2, y + topRowH - 1.8, { size: 6.8, color: MUTED, align: "center" });
    } else {
      txt("Tip belirlenemedi", M + leftW / 2, y + topRowH / 2, { size: 10, color: MUTED, align: "center" });
    }
    const chips = [
      ["Rotor kütlesi", `${f(r.mass, 1)} g`, `X_cg = ${f(r.xcg, 1)} mm`],
      ["Kalite sınıfı", `G ${fa(pr.G, 2)}`, src("G")],
      ["Servis hızı", `${f(pr.serviceSpeed, 0)} rpm`, src("serviceSpeed")],
    ];
    const chX = M + leftW + 4;
    const chW = CW - leftW - 4;
    const chH = (topRowH - 4) / 3;
    chips.forEach(([k, v, sub], i) => {
      const cy = y + i * (chH + 2);
      box(chX, cy, chW, chH, [255, 255, 255], CHAR, 0.6);
      doc.setFillColor(...YELLOW);
      doc.rect(chX + 0.3, cy + 1.2, 1.8, chH - 2.4, "F");
      txt(k, chX + 6, cy + chH / 2 + 0.2, { size: 10, bold: true, color: CHAR });
      txt(sub, chX + 6, cy + chH / 2 + 3.6, { size: 6.8, color: MUTED });
      txt(v, chX + chW - 5, cy + chH / 2 + 2.3, { size: 16, bold: true, color: BLACK, align: "right" });
    });
    y += topRowH + 4;

    // ---------------- Şema (tam genişlik)
    const schH = note ? 48 : 54;
    box(M, y, CW, schH, [255, 255, 255]);
    {
      const H = 256;
      const sch = S.build(state, { process: p, result: r, w: Math.round((H * (CW - 3)) / (schH - 3)), h: H, print: true });
      S.toPDF(doc, sch, M + 1.5, y + 1.5, CW - 3, schH - 3, font.name);
    }
    y += schH + 4;

    // ---------------- Tolerans kutuları (g ve g·mm)
    const tolH = 34;
    if (r.valid) {
      const n = r.planes.length;
      const gap = 4;
      const bw = n === 1 ? (CW - gap) * 0.62 : (CW - gap) / 2;
      r.planes.forEach((pl, i) => {
        const bx = M + i * (bw + gap);
        if (p.optional) doc.setLineDashPattern([2.5, 1.5], 0);
        box(bx, y, bw, tolH, PAPER, CHAR, 0.9);
        doc.setLineDashPattern([], 0);
        doc.setFillColor(...YELLOW);
        doc.rect(bx + 4, y + 2.6, 10, 1, "F");
        txt(n === 1 ? "DÜZLEM (STATİK)" : `DÜZLEM ${i + 1}`, bx + 4, y + 8, { size: 8.5, bold: true, color: BLACK });
        txt(fit(`${pl.point.name} · ${pl.part.name}`, bw - 40, 7.5), bx + bw - 4, y + 8, { size: 7.5, color: LABEL, align: "right" });
        const rLbl = `Yarıçap r${n === 1 ? "" : i + 1} = `;
        txt(rLbl, bx + 4, y + 14, { size: 10, color: LABEL });
        doc.setFont(font.name, "normal");
        doc.setFontSize(10);
        txt(`${f(pl.r, 1)} mm`, bx + 4 + doc.getTextWidth(T(rLbl)), y + 14, { size: 10.5, bold: true, color: BLACK });
        const mp = C.massParts(pl.m);
        txt(mp.v, bx + 4, y + 25, { size: 26, bold: true, color: BLACK });
        doc.setFont(font.name, "bold");
        doc.setFontSize(26);
        const wNum = doc.getTextWidth(T(mp.v));
        txt(mp.unit, bx + 5.5 + wNum, y + 25, { size: 13, bold: true, color: LABEL });
        txt(`${fa(pl.U)} g·mm`, bx + bw - 4, y + 25, { size: 14, bold: true, color: BLACK, align: "right" });
        txt("izin verilen artık kütle", bx + 4, y + 30.5, { size: 6.8, color: MUTED });
        txt("izin verilen artık dengesizlik", bx + bw - 4, y + 30.5, { size: 6.8, color: MUTED, align: "right" });
      });
      if (n === 1) {
        const bx = M + bw + gap;
        const w2 = CW - bw - gap;
        box(bx, y, w2, tolH, [255, 255, 255]);
        txt("TOPLAM U_per", bx + 4, y + 8, { size: 8.5, bold: true, color: LABEL });
        txt(`${fa(r.Uper)} g·mm`, bx + 4, y + 20, { size: 16, bold: true, color: BLACK });
        txt(`e_per = ${fa(r.eper * 1000)} µm`, bx + 4, y + 27, { size: 8, color: MUTED });
      }
    } else {
      box(M, y, CW, tolH, [253, 236, 234], [198, 40, 40], 0.5);
      txt("Hesap yapılamadı – eksik veya hatalı tanım:", M + 4, y + 6, { size: 9, bold: true, color: [198, 40, 40] });
      r.errors.slice(0, 5).forEach((e, i) => txt(fit(`• ${e}`, CW - 8, 8), M + 4, y + 11 + i * 3.8, { size: 8, color: [198, 40, 40] }));
    }
    y += tolH + 7;

    // ---------------- Balans geometrisi + ISO 21940-11 hesabı
    const colW = CW / 2;
    txt("Balans geometrisi", M, y, { size: 11 });
    hline(y + 1.2, M, M + colW - 6, 0.25);
    txt("DIN ISO 21940-11 hesabı", M + colW, y, { size: 11 });
    hline(y + 1.2, M + colW, PAGE_W - M, 0.25);
    y += 5.5;
    const dash = "–";
    const geo = r.valid
      ? [
          ["Düzeltme düzlemi konumu", r.type.nameEn],
          ["Yataktan yatağa (L)", `${f(r.L, 1)} mm`, true],
          ...r.planes.map((pl, i) => [
            `Yataktan ${r.nPlanes === 1 ? "düzleme" : `D${i + 1}`}`,
            pl.nearDist < 0.05 ? "yatak üzerinde" : `${f(pl.nearDist, 1)} mm · ${pl.nearSide}`,
            true,
          ]),
          ...r.planes.map((pl, i) => [`Yarıçap r${r.nPlanes === 1 ? "" : i + 1}`, `${f(pl.r, 1)} mm`, true]),
          ["Balans hızı (referans)", `${f(pr.balanceSpeed, 0)} rpm · ${src("balanceSpeed")}`, false, true],
        ]
      : [["Geometri", "eksik tanım"]];
    geo.forEach(([k, v, bold, minor], i) => {
      txt(fit(k, 42, 8.5), M + 4, y + i * 4, { size: 8.5, color: minor ? MUTED : LABEL });
      txt(fit(v, colW - 52, 8.5, bold), M + 48, y + i * 4, { size: 8.5, bold, color: minor ? MUTED : INK });
    });
    const iso = r.valid
      ? [
          ["Balans kalite sınıfı", `G ${fa(pr.G, 2)}`],
          ["Rotor kütlesi", `${f(r.mass, 1)} g`],
          ["Servis hızı", `${f(pr.serviceSpeed, 0)} rpm (Ω = ${f(r.omega, 2)} rad/s)`],
          ["U_per = G·m/Ω", `${fa(r.Uper)} g·mm`],
          ["Yatak payı A / B", `${f(r.alloc.kA * 100, 0)}% / ${f(r.alloc.kB * 100, 0)}%${r.transfer.s < 0.999 ? `, s = ${f(r.transfer.s, 3)}` : ""}`],
          ...r.planes.map((pl, i) => [`Dinamik tolerans ${r.nPlanes === 1 ? "" : i + 1}`.trim(), `${fa(pl.U)} g·mm  →  ${C.fmtMass(pl.m)}`]),
        ]
      : [["Durum", "hesap yapılamadı"]];
    iso.forEach(([k, v], i) => {
      const bold = /^(Dinamik|Balans kalite|Rotor kütlesi)/.test(k);
      txt(k, M + colW + 4, y + i * 4, { size: 8.5, color: LABEL });
      txt(fit(v, colW - 46, 8.5, bold), M + colW + 42, y + i * 4, { size: 8.5, bold });
    });
    y += Math.max(geo.length, iso.length) * 4 + 3;

    // ---------------- Komşu standart G sınıfları (bilgi amaçlı)
    const grades = C.gradeComparison(r);
    // Montajdaki parçaların tabloya sığması önceliklidir; sığmıyorsa G karşılaştırması tek satıra iner
    const onParts = state.parts.filter((pt) => p.partIds.includes(pt.id)).length;
    const partsNeed = 3.5 + 3.6 * (onParts + 1) + 11;
    const fullGH = 2.5 + 3.8 * (grades.length + 1) + 5.5;
    const compactG = grades.length && PAGE_H - SAFE - 9 - 10 - (y + fullGH) < partsNeed;
    if (compactG) {
      txt("Komşu standart G sınıfları", M, y, { size: 9.5 });
      txt("bilgi amaçlı", PAGE_W - M, y, { size: 7, color: MUTED, align: "right" });
      y += 4.2;
      let gx = M;
      grades.forEach((g) => {
        const t = `G ${fa(g.G, 2)}${g.current ? " (seçili)" : ""}: ${g.planes.map((x) => C.fmtMass(x.m)).join(" / ")}`;
        doc.setFont(font.name, g.current ? "bold" : "normal");
        doc.setFontSize(8);
        const w = doc.getTextWidth(T(t));
        if (g.current) {
          doc.setFillColor(...YELLOW_SOFT);
          doc.rect(gx - 1, y - 3, w + 2, 4, "F");
        }
        txt(t, gx, y, { size: 8, bold: g.current, color: g.current ? BLACK : LABEL });
        gx += w + 6;
      });
      y += 5.5;
    } else if (grades.length) {
      txt("Komşu standart G sınıfları", M, y, { size: 11 });
      txt("bilgi amaçlı · seçili G vurgulu", PAGE_W - M, y, { size: 7, color: MUTED, align: "right" });
      hline(y + 1.2, M, PAGE_W - M, 0.25);
      y += 2.5;
      const gh = 3.8;
      const gcols = [42, 30, ...r.planes.map(() => (CW - 72) / r.planes.length)];
      const ghead = ["Sınıf", "U_per [g·mm]", ...r.planes.map((_, i) => (r.nPlanes === 1 ? "Düzlem" : `D${i + 1}  (mg · g·mm)`))];
      doc.setFillColor(236, 240, 244);
      doc.rect(M, y, CW, gh, "F");
      let gx = M;
      ghead.forEach((h, j) => {
        txt(h, j === 0 ? gx + 1.5 : gx + gcols[j] - 1.5, y + gh - 1.1, { size: 7.5, bold: true, color: LABEL, align: j === 0 ? "left" : "right" });
        gx += gcols[j];
      });
      y += gh;
      grades.forEach((g) => {
        if (g.current) {
          doc.setFillColor(...YELLOW_SOFT);
          doc.rect(M, y, CW, gh, "F");
        }
        const tag = g.current ? `  (seçili${g.standard ? "" : " · standart dışı"})` : "";
        const vals = [`G ${fa(g.G, 2)}${tag}`, fa(g.Uper), ...g.planes.map((x) => `${C.fmtMass(x.m)} · ${fa(x.U)}`)];
        let cx3 = M;
        vals.forEach((v, j) => {
          txt(fit(v, gcols[j] - 3, 8, g.current), j === 0 ? cx3 + 1.5 : cx3 + gcols[j] - 1.5, y + gh - 1.1, {
            size: 8, bold: g.current, color: g.current ? BLACK : LABEL, align: j === 0 ? "left" : "right",
          });
          cx3 += gcols[j];
        });
        y += gh;
      });
      hline(y, M, PAGE_W - M, 0.25, LINE);
      y += 5.5;
    }

    // ---------------- Kompakt detay tablosu (kalan alana sığdırılır)
    const footerY = PAGE_H - SAFE - 9; // alt bilgi yazıları güvenli sınırın içinde
    // Tespit gerekçesi (ikincil bilgi) sayfanın altında; not varsa yer açmak için atlanır
    let reasonLines = [];
    if (r.valid && !note) {
      doc.setFont(font.name, "normal");
      doc.setFontSize(7.2);
      reasonLines = doc.splitTextToSize(T(`Tespit gerekçesi: ${r.type.reason}`), CW);
      if (reasonLines.length > 2) reasonLines = [reasonLines[0], fit(reasonLines.slice(1).join(" "), CW, 7.2)];
    }
    // Montajdaki parçalara sığacak yer yoksa ikincil bilgi olan gerekçe raporda atlanır
    const onCount = state.parts.filter((pt) => p.partIds.includes(pt.id)).length;
    const bottomFor = (lines) => (lines.length ? footerY - 2.2 - (lines.length - 1) * 3.1 - 4 : footerY) - 10;
    if (reasonLines.length && bottomFor(reasonLines) - (y + 3.5) < (onCount + 1) * 3.6) reasonLines = [];
    const reasonY = footerY - 2.2 - (reasonLines.length - 1) * 3.1;
    const tableBottom = bottomFor(reasonLines); // yatak satırı için yer
    txt("Parça listesi ve referans yataklar", M, y, { size: 11 });
    hline(y + 1.2, M, PAGE_W - M, 0.25);
    y += 3.5;
    const cols = [
      { h: "No", w: 9, a: "left" },
      { h: "Parça", w: 38, a: "left" },
      { h: "Kütle [g]", w: 20, a: "right" },
      { h: "x_cg [mm]", w: 20, a: "right" },
      { h: "Montajda", w: 17, a: "center" },
      { h: "Balans noktaları (ad: x / r [mm]; D = seçili düzlem)", w: CW - 104, a: "left" },
    ];
    const chosen = new Map((r.planes || []).map((pl, i) => [pl.point.id, i + 1]));
    const rowsAll = state.parts.map((pt, i) => ({
      no: String(i + 1),
      name: pt.name,
      on: p.partIds.includes(pt.id),
      mass: f(C.num(pt.mass), 1),
      x: f(C.num(pt.x), 1),
      pts:
        pt.points
          .map((q) => `${chosen.has(q.id) ? `[D${chosen.get(q.id)}] ` : ""}${q.name}: ${f(C.num(q.x), 1)} / ${f(C.num(q.r), 1)}`)
          .join(";  ") || "–",
    }));
    // Montajdaki parçalar öncelikli; sayfa sınırı aşılırsa kalanlar özetlenir
    const rows = [...rowsAll.filter((x) => x.on), ...rowsAll.filter((x) => !x.on)];
    const avail = tableBottom - y;
    let size = 8;
    let rowH = 4.4;
    let maxRows = Math.max(0, Math.floor((avail - rowH) / rowH));
    if (rows.length > maxRows) {
      size = 6.8;
      rowH = 3.6;
      maxRows = Math.max(1, Math.floor((avail - rowH) / rowH));
    }
    let shown = rows;
    let hidden = 0;
    if (rows.length > maxRows) {
      // son satır "… ve N parça daha" özetine ayrılır; asla sayfa dışına taşmaz
      shown = rows.slice(0, Math.max(0, maxRows - 1));
      hidden = rows.length - shown.length;
    }
    doc.setFillColor(236, 240, 244);
    doc.rect(M, y, CW, rowH, "F");
    let cx = M;
    cols.forEach((c) => {
      const tx = c.a === "right" ? cx + c.w - 1.5 : c.a === "center" ? cx + c.w / 2 : cx + 1.5;
      txt(fit(c.h, c.w - 2, size - 0.5, true), tx, y + rowH - 1.2, { size: size - 0.5, bold: true, color: LABEL, align: c.a });
      cx += c.w;
    });
    y += rowH;
    shown.forEach((row, i) => {
      if (i % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(M, y, CW, rowH, "F");
      }
      const vals = [row.no, row.name, row.mass, row.x, "", row.pts];
      let cx2 = M;
      cols.forEach((c, j) => {
        const tx = c.a === "right" ? cx2 + c.w - 1.5 : c.a === "center" ? cx2 + c.w / 2 : cx2 + 1.5;
        const v = j === 4 ? (row.on ? "evet" : "hayır") : vals[j];
        txt(fit(v, c.w - 3, size, j === 1 && row.on), tx, y + rowH - 1.1, { size, bold: j === 1 && row.on, color: row.on ? INK : MUTED, align: c.a });
        cx2 += c.w;
      });
      y += rowH;
    });
    if (hidden) {
      txt(`… ve ${hidden} parça daha (tam liste JSON dosyasında)`, M + 1.5, y + rowH - 1.1, { size, color: MUTED });
      y += rowH;
    }
    hline(y, M, PAGE_W - M, 0.25, LINE);
    const brg = state.bearings
      .map((b) => `${b.name}: x = ${f(C.num(b.x), 1)} mm${p.bearingIds.includes(b.id) ? " (referans)" : ""}`)
      .join("   ·   ");
    txt(fit(`Yataklar — ${brg || "tanımsız"}`, CW, 8), M, Math.min(y + 4.5, tableBottom + 6), { size: 8 });
    if (reasonLines.length) {
      doc.setFont(font.name, "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...MUTED);
      reasonLines.forEach((l, i) => doc.text(l, M, reasonY + i * 3.1));
    }

    // ---------------- Alt bilgi
    hline(footerY, M, PAGE_W - M, 0.3, LINE);
    txt(fit(`Hazırlayan / Operatör: ${m.operator || "................................"}     Kontrol: ................................     ${m.notes || ""}`, CW - 30, 7.5), M, footerY + 4, { size: 7.5, color: MUTED });
    txt(`Sayfa ${pageNo} / ${pageCount}`, PAGE_W - M, footerY + 4, { size: 7.5, color: MUTED, align: "right" });
    txt(`Balans Talimatnamesi · ISO 21940-11 · ${dateStr}`, M, footerY + 7.5, { size: 6.5, color: MUTED });
  }

  root.Report = { generate };
})(typeof self !== "undefined" ? self : this);
