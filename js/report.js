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
  const M = 14; // kenar boşluğu
  const CW = PAGE_W - 2 * M;
  const INK = [31, 42, 51];
  const MUTED = [100, 116, 139]; // ikincil bilgiler
  const LABEL = [51, 65, 85]; // önemli etiketler (baskıda okunur kalsın)
  const ACCENT = [13, 71, 161];
  const ACCENT_BG = [237, 245, 253];
  const LINE = [195, 202, 211];
  const AMBER = [180, 83, 9]; // opsiyonel adım
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
    doc.setProperties({ title: `Balans Raporu – ${state.meta.rotorId || ""}`, subject: "ISO 21940-11 balans toleransı", creator: "Kademeli Şaft Balans Hesabı" });
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
    const rotorName = m.rotorId || m.rotorModel || "Rotor";
    const totalMass = state.parts.reduce((a, pt) => a + (C.num(pt.mass) > 0 ? C.num(pt.mass) : 0), 0);
    const g = state.global;

    // Kapak çerçevesi ve başlık bandı
    const FX = 8;
    const FW = PAGE_W - 2 * FX;
    const bandH = 40;
    doc.setFillColor(...ACCENT);
    doc.roundedRect(FX, FX, FW, bandH, 3, 3, "F");
    doc.rect(FX, FX + 4, FW, bandH - 4, "F");
    txt("BALANS PROSES ÖZETİ", M, FX + 9, { size: 9, bold: true, color: [187, 214, 247] });
    {
      const title = (m.title || "").trim() || rotorName;
      doc.setFont(font.name, "bold");
      doc.setFontSize(20);
      let lines = doc.splitTextToSize(T(title), CW);
      if (lines.length > 2) lines = [lines[0], fit(lines.slice(1).join(" "), CW, 20, true)];
      doc.setTextColor(255, 255, 255);
      const ty = lines.length === 1 ? FX + 22 : FX + 18.5;
      lines.forEach((l, i) => doc.text(l, M, ty + i * 8.5));
    }
    txt(fit([m.rotorId, m.rotorModel].filter(Boolean).join("  ·  ") || " ", CW, 9.5), M, FX + bandH - 4.5, { size: 9.5, color: [220, 233, 250] });
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.8);
    doc.roundedRect(FX, FX, FW, PAGE_H - 2 * FX, 3, 3, "S");

    const ky = FX + bandH + 8;
    kv(
      [
        ["Sipariş no", m.orderNo || "–"],
        ["Rotor ID", m.rotorId || "–", true],
        ["Rotor modeli", m.rotorModel || "–"],
      ],
      M + 4, ky, 28
    );
    kv(
      [
        ["Rapor tarihi", dateStr],
        ["Proses adımı", nOpt ? `${procs.length}  (${nOpt} opsiyonel)` : `${procs.length}`, true],
        ["Hazırlayan", m.operator || "–"],
      ],
      112, ky, 28
    );

    // Ne yapılacak?
    let y = ky + 19;
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
        `${nOpt === 1 ? "Bir adım" : `${nOpt} adım`} opsiyonel olarak işaretlenmiştir (OPS.): bu adımların yapılması ` +
          `tercihe bağlıdır; gerekli görülmezse atlanabilir.`
      );

    // Ürün: şema + birkaç temel bilgi
    y += 2;
    section("Rotor", y);
    y += 4;
    const schH = 46;
    const schW = CW * 0.64;
    box(M, y, schW, schH, [255, 255, 255]);
    S.toPDF(doc, S.build(state, { w: 600, h: 230, print: true }), M + 1.5, y + 1.5, schW - 3, schH - 3, font.name);
    const ix = M + schW + 6;
    [
      ["Parça sayısı", `${state.parts.length}`],
      ["Toplam kütle", `${f(totalMass, 1)} g`],
      ["Servis hızı", `${f(C.num(g.serviceSpeed), 0)} rpm`],
      ["Kalite sınıfı", `G ${C.fmtAuto(C.num(g.G), 2)}`],
    ].forEach(([k, v], i) => {
      txt(k, ix, y + 7 + i * 10, { size: 8.5, color: LABEL });
      txt(v, ix, y + 12 + i * 10, { size: 12, bold: true });
    });
    y += schH + 9;

    // Adımlar
    section("Proses adımları", y);
    y += 4;
    const cols = [
      { h: "Adım", w: 19, a: "left" },
      { h: "Proses", w: 40, a: "left" },
      { h: "Montajdaki parçalar", w: 33, a: "left" },
      { h: "Balans", w: 44, a: "left" },
      { h: "İzin verilen artık kütle", w: CW - 136, a: "right" },
    ];
    const rowH = 7;
    const footerY = PAGE_H - 19; // kapak çerçevesinin içinde
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
      if (i % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(M, y, CW, rowH, "F");
      }
      const parts = state.parts.filter((pt) => p.partIds.includes(pt.id)).map((pt) => pt.name).join(", ") || "–";
      const how = r.valid ? `${r.nPlanes} düzlem · ${r.type.nameEn}` : `${p.planes === 1 ? 1 : 2} düzlem`;
      const tol = r.valid ? r.planes.map((pl, k) => `${r.nPlanes === 1 ? "" : `D${k + 1} `}${C.fmtMass(pl.m)}`).join("  ") : "tanım eksik";
      const vals = [String(state.processes.indexOf(p) + 1), p.name || "–", parts, how, tol];
      let x = M;
      if (p.optional) pill(M + 7, y + 4.6, "OPS.", [255, 237, 204], AMBER, 7);
      cols.forEach((c, j) => {
        const bold = j === 1 || j === 4;
        txt(fit(vals[j], c.w - 4, 9, bold), c.a === "right" ? x + c.w - 2 : x + 2, y + 4.8, {
          size: 9, bold, align: c.a, color: j === 4 && !r.valid ? [198, 40, 40] : INK,
        });
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
      txt("OPS. = opsiyonel adım (yapılması tercihe bağlı)", M + 2, y + 4, { size: 7.5, color: AMBER });
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
    txt(fit(`Hazırlayan: ${m.operator || "................................"}     Kontrol: ................................     ${m.notes || ""}`, CW - 30, 7.5), M, footerY + 4, { size: 7.5, color: MUTED });
    txt(`Sayfa 1 / ${pageCount}`, PAGE_W - M, footerY + 4, { size: 7.5, color: MUTED, align: "right" });
    txt(`Kademeli Şaft Balans Hesabı · ISO 21940-11 · ${dateStr}`, M, footerY + 7.5, { size: 6.5, color: MUTED });
  }

  function drawPage(doc, font, state, p, r, stepNo, stepTotal, pageNo, pageCount) {
    const { T, f, fa, txt, fit, hline, section, box, kv, pill } = kit(doc, font);

    // ---------------- Başlık (şablon: "Balancing report")
    txt("Balans Raporu", M, 20, { size: 22 });
    if (p.optional) {
      doc.setFont(font.name, "normal");
      doc.setFontSize(22);
      const tw = doc.getTextWidth(T("Balans Raporu"));
      pill(M + tw + 5, 19, "OPSİYONEL ADIM – yapılması tercihe bağlı", [255, 237, 204], AMBER, 8.5);
    }
    txt(`Proses ${stepNo} / ${stepTotal}`, PAGE_W - M, 20, { size: 9, color: MUTED, align: "right" });
    hline(23, M, PAGE_W - M, 0.6);
    const m = state.meta;
    const now = new Date();
    const dateStr = now.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
    kv(
      [
        ["Sipariş no", m.orderNo || "–"],
        ["Rotor ID", m.rotorId || "–", true],
        ["Proses", fit(p.name || `Proses ${stepNo}`, 58, 9, true), true],
      ],
      M + 4, 28.5, 28
    );
    kv(
      [
        ["Rotor modeli", m.rotorModel || "–"],
        ["Rapor tarihi", dateStr],
        ["Dönüş yönü", m.direction || "–"],
      ],
      112, 28.5, 28
    );

    // ---------------- Proses notu (varsa, başlığın hemen altında)
    let y = 46;
    const note = (p.note || "").trim();
    if (note) {
      doc.setFont(font.name, "normal");
      doc.setFontSize(9.5);
      let lines = doc.splitTextToSize(T(note), CW - 30);
      if (lines.length > 3) lines = [...lines.slice(0, 2), fit(lines.slice(2).join(" "), CW - 30, 9.5)];
      const nh = 4 + lines.length * 4.3;
      box(M, 41.5, CW, nh, NOTE_BG, NOTE_LINE, 0.5);
      txt("PROSES NOTU", M + 3, 46.3, { size: 8, bold: true, color: AMBER });
      doc.setFont(font.name, "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      lines.forEach((l, i) => doc.text(l, M + 27, 46.3 + i * 4.3));
      y = 41.5 + nh + 7;
    }

    // ---------------- Hızlı bakış
    section("Tip verisi ve hızlı bakış", y);
    y += 4;
    const topH = note ? 48 : 54; // not varsa sayfaya sığması için biraz kısalır
    // Sol: temsil görseli + tip adı
    const leftW = 58;
    box(M, y, leftW, topH, [255, 255, 255]);
    if (r.valid) {
      const art = root.TypeArt.build(r.type.key);
      const iw = leftW - 4;
      const ih = Math.min(42, (iw * art.h) / art.w);
      S.toPDF(doc, art, M + 2, y + 2, iw, ih, font.name);
      txt(fit(r.type.name, leftW - 4, 10.5, true), M + leftW / 2, y + ih + 7, { size: 10.5, bold: true, color: ACCENT, align: "center" });
      txt(`${r.type.nameEn} · otomatik tespit`, M + leftW / 2, y + ih + 11.5, { size: 7.5, color: MUTED, align: "center" });
    } else {
      txt("Tip belirlenemedi", M + leftW / 2, y + topH / 2, { size: 10, color: MUTED, align: "center" });
    }
    // Sağ: şema
    const schX = M + leftW + 4;
    const schW = CW - leftW - 4;
    box(schX, y, schW, topH, [255, 255, 255]);
    const sch = S.build(state, { process: p, result: r, w: 540, h: 240, print: true });
    S.toPDF(doc, sch, schX + 1.5, y + 1.5, schW - 3, topH - 3, font.name);
    y += topH + 4;

    // Tespit gerekçesi (en fazla 3 satır)
    {
      // Not varsa yer açmak için gerekçe raporda atlanır (ekranda ve detaylarda durur)
      const reason = r.valid && !note ? `Tespit gerekçesi: ${r.type.reason}` : "";
      doc.setFont(font.name, "normal");
      doc.setFontSize(8);
      let lines = reason ? doc.splitTextToSize(T(reason), CW) : [];
      if (lines.length > 3) lines = [...lines.slice(0, 2), fit(lines.slice(2).join(" "), CW, 8)];
      doc.setTextColor(...MUTED);
      lines.forEach((l, i) => doc.text(l, M, y + 3 + i * 3.4));
    }
    y += note ? 2 : 11;

    // ---------------- Tolerans kutuları (g ve g·mm)
    const tolH = 34;
    if (r.valid) {
      const n = r.planes.length;
      const gap = 4;
      const bw = n === 1 ? (CW - gap) * 0.62 : (CW - gap) / 2;
      r.planes.forEach((pl, i) => {
        const bx = M + i * (bw + gap);
        box(bx, y, bw, tolH, ACCENT_BG, ACCENT, 0.9);
        txt(n === 1 ? "DÜZLEM (STATİK)" : `DÜZLEM ${i + 1}`, bx + 4, y + 5.5, { size: 8.5, bold: true, color: ACCENT });
        txt(fit(`${pl.point.name} · ${pl.part.name}`, bw - 8, 7.5), bx + 4, y + 9.5, { size: 7.5, color: LABEL });
        const rLbl = `Yarıçap r${n === 1 ? "" : i + 1} = `;
        txt(rLbl, bx + 4, y + 14.5, { size: 10, color: LABEL });
        doc.setFont(font.name, "normal");
        doc.setFontSize(10);
        txt(`${f(pl.r, 1)} mm`, bx + 4 + doc.getTextWidth(T(rLbl)), y + 14.5, { size: 10.5, bold: true });
        const mp = C.massParts(pl.m);
        txt(mp.v, bx + 4, y + 25, { size: 26, bold: true });
        doc.setFont(font.name, "bold");
        doc.setFontSize(26);
        const wNum = doc.getTextWidth(T(mp.v));
        txt(mp.unit, bx + 5.5 + wNum, y + 25, { size: 13, bold: true, color: LABEL });
        txt(`${fa(pl.U)} g·mm`, bx + bw - 4, y + 25, { size: 14, bold: true, align: "right" });
        txt("izin verilen artık kütle", bx + 4, y + 30.5, { size: 6.8, color: MUTED });
        txt("izin verilen artık dengesizlik", bx + bw - 4, y + 30.5, { size: 6.8, color: MUTED, align: "right" });
      });
      if (n === 1) {
        const bx = M + bw + gap;
        const w2 = CW - bw - gap;
        box(bx, y, w2, tolH, [248, 250, 252]);
        txt("TOPLAM U_per", bx + 4, y + 5.5, { size: 8.5, bold: true, color: LABEL });
        txt(`${fa(r.Uper)} g·mm`, bx + 4, y + 18, { size: 16, bold: true });
        txt(`e_per = ${fa(r.eper * 1000)} µm`, bx + 4, y + 25, { size: 8, color: MUTED });
      }
    } else {
      box(M, y, CW, tolH, [253, 236, 234], [198, 40, 40], 0.5);
      txt("Hesap yapılamadı – eksik veya hatalı tanım:", M + 4, y + 6, { size: 9, bold: true, color: [198, 40, 40] });
      r.errors.slice(0, 5).forEach((e, i) => txt(fit(`• ${e}`, CW - 8, 8), M + 4, y + 11 + i * 3.8, { size: 8, color: [198, 40, 40] }));
    }
    y += tolH + 4;

    // ---------------- Ana parametreler (kütle ve G vurgulu; balans hızı yalnızca referans)
    const pr = r.params;
    const src = (k) => (pr.sources[k] === "process" ? "prosese özel" : "genel");
    const chips = [
      ["Rotor kütlesi", `${f(r.mass, 1)} g`, `X_cg = ${f(r.xcg, 1)} mm`, true],
      ["Kalite sınıfı", `G ${fa(pr.G, 2)}`, src("G"), true],
      ["Servis hızı", `${f(pr.serviceSpeed, 0)} rpm`, src("serviceSpeed"), false],
    ];
    const cw = (CW - 2 * 3) / 3;
    chips.forEach(([k, v, s, strong], i) => {
      const bx = M + i * (cw + 3);
      box(bx, y, cw, 13, strong ? [255, 255, 255] : [248, 250, 252], strong ? [96, 125, 139] : LINE, strong ? 0.6 : 0.3);
      txt(k, bx + 3, y + 4.4, { size: 7.5, color: LABEL, bold: strong });
      txt(v, bx + 3, y + 10.6, { size: strong ? 13 : 11, bold: true });
      txt(fit(s, cw / 2 - 3, 6.5), bx + cw - 3, y + 4.4, { size: 6.5, color: MUTED, align: "right" });
    });
    y += 13 + 6;

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
    if (grades.length) {
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
          doc.setFillColor(...ACCENT_BG);
          doc.rect(M, y, CW, gh, "F");
        }
        const tag = g.current ? `  (seçili${g.standard ? "" : " · standart dışı"})` : "";
        const vals = [`G ${fa(g.G, 2)}${tag}`, fa(g.Uper), ...g.planes.map((x) => `${C.fmtMass(x.m)} · ${fa(x.U)}`)];
        let cx3 = M;
        vals.forEach((v, j) => {
          txt(fit(v, gcols[j] - 3, 8, g.current), j === 0 ? cx3 + 1.5 : cx3 + gcols[j] - 1.5, y + gh - 1.1, {
            size: 8, bold: g.current, color: g.current ? (j === 0 ? ACCENT : INK) : LABEL, align: j === 0 ? "left" : "right",
          });
          cx3 += gcols[j];
        });
        y += gh;
      });
      hline(y, M, PAGE_W - M, 0.25, LINE);
      y += 5.5;
    }

    // ---------------- Kompakt detay tablosu (kalan alana sığdırılır)
    const footerY = PAGE_H - 12;
    const tableBottom = footerY - 10; // yatak satırı için yer
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
    let maxRows = Math.floor((avail - rowH) / rowH);
    if (rows.length > maxRows) {
      size = 6.8;
      rowH = 3.6;
      maxRows = Math.floor((avail - rowH) / rowH);
    }
    let shown = rows;
    let hidden = 0;
    if (rows.length > maxRows) {
      shown = rows.slice(0, maxRows - 1);
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
    txt(fit(`Yataklar — ${brg || "tanımsız"}`, CW, 8), M, Math.min(y + 4.5, footerY - 4), { size: 8 });

    // ---------------- Alt bilgi
    hline(footerY, M, PAGE_W - M, 0.3, LINE);
    txt(fit(`Hazırlayan: ${m.operator || "................................"}     Kontrol: ................................     ${m.notes || ""}`, CW - 30, 7.5), M, footerY + 4, { size: 7.5, color: MUTED });
    txt(`Sayfa ${pageNo} / ${pageCount}`, PAGE_W - M, footerY + 4, { size: 7.5, color: MUTED, align: "right" });
    txt(`Kademeli Şaft Balans Hesabı · ISO 21940-11 · ${dateStr}`, M, footerY + 7.5, { size: 6.5, color: MUTED });
  }

  root.Report = { generate };
})(typeof self !== "undefined" ? self : this);
