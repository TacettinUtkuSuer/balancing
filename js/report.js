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

  function generate(state, processIds) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const font = setupFonts(doc);
    const procs = processIds.map((id) => state.processes.find((p) => p.id === id)).filter(Boolean);
    const total = state.processes.length;
    procs.forEach((p, i) => {
      if (i > 0) doc.addPage("a4", "portrait");
      const r = C.computeProcess(state, p);
      drawPage(doc, font, state, p, r, state.processes.indexOf(p) + 1, total, i + 1, procs.length);
    });
    doc.setProperties({ title: `Balans Raporu – ${state.meta.rotorId || ""}`, subject: "ISO 21940-11 balans toleransı", creator: "Kademeli Şaft Balans Hesabı" });
    return doc;
  }

  function drawPage(doc, font, state, p, r, stepNo, stepTotal, pageNo, pageCount) {
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

    // ---------------- Başlık (şablon: "Balancing report")
    txt("Balans Raporu", M, 20, { size: 22 });
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

    // ---------------- Hızlı bakış
    let y = 46;
    section("Tip verisi ve hızlı bakış", y);
    y += 4;
    const topH = 60;
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
    const sch = S.build(state, { process: p, result: r, w: 540, h: 265, print: true });
    S.toPDF(doc, sch, schX + 1.5, y + 1.5, schW - 3, topH - 3, font.name);
    y += topH + 4;

    // Tespit gerekçesi (en fazla 3 satır)
    {
      const reason = r.valid ? `Tespit gerekçesi: ${r.type.reason}` : "";
      doc.setFont(font.name, "normal");
      doc.setFontSize(8);
      let lines = reason ? doc.splitTextToSize(T(reason), CW) : [];
      if (lines.length > 3) lines = [...lines.slice(0, 2), fit(lines.slice(2).join(" "), CW, 8)];
      doc.setTextColor(...MUTED);
      lines.forEach((l, i) => doc.text(l, M, y + 3 + i * 3.6));
    }
    y += 14;

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
        txt(fit(`${pl.point.name} · ${pl.part.name} · r = ${f(pl.r, 1)} mm`, bw - 8, 7.5), bx + 4, y + 9.5, { size: 7.5, color: LABEL });
        const near = pl.nearDist < 0.05 ? `${pl.nearBearing.name} üzerinde` : `${pl.nearBearing.name} → ${f(pl.nearDist, 1)} mm · ${pl.nearSide}`;
        txt(fit(near, bw - 8, 8.5, true), bx + 4, y + 13.8, { size: 8.5, bold: true });
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

    // ---------------- Hız şeridi
    const pr = r.params;
    const src = (k) => (pr.sources[k] === "process" ? "prosese özel" : "genel");
    const chips = [
      ["Balans hızı", `${f(pr.balanceSpeed, 0)} rpm`, src("balanceSpeed")],
      ["Servis hızı", `${f(pr.serviceSpeed, 0)} rpm`, src("serviceSpeed")],
      ["Kalite sınıfı", `G ${fa(pr.G, 2)}`, src("G")],
      ["Rotor kütlesi", `${f(r.mass, 1)} g`, `X_cg = ${f(r.xcg, 1)} mm`],
    ];
    const cw = (CW - 3 * 3) / 4;
    chips.forEach(([k, v, s], i) => {
      const bx = M + i * (cw + 3);
      box(bx, y, cw, 12, [248, 250, 252]);
      txt(k, bx + 3, y + 4.2, { size: 7, color: LABEL });
      txt(v, bx + 3, y + 9.6, { size: 10.5, bold: true });
      txt(fit(s, cw / 2 - 3, 6.5), bx + cw - 3, y + 4.2, { size: 6.5, color: MUTED, align: "right" });
    });
    y += 12 + 7;

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
          ["Yatak açıklığı L", `${f(r.L, 1)} mm`, true],
          ...r.planes.map((pl, i) => [
            `${r.nPlanes === 1 ? "Düzlem" : `Düzlem ${i + 1}`} → ${pl.nearBearing.name}`,
            pl.nearDist < 0.05 ? "yatak üzerinde" : `${f(pl.nearDist, 1)} mm · ${pl.nearSide}`,
            true,
          ]),
          ...r.planes.map((pl, i) => [`Yarıçap ${r.nPlanes === 1 ? "" : i + 1}`.trim(), `${f(pl.r, 1)} mm`]),
        ]
      : [["Geometri", "eksik tanım"]];
    geo.forEach(([k, v, bold], i) => {
      txt(fit(k, 42, 8.5), M + 4, y + i * 4.3, { size: 8.5, color: LABEL });
      txt(fit(v, colW - 52, 8.5, bold), M + 48, y + i * 4.3, { size: 8.5, bold });
    });
    const iso = r.valid
      ? [
          ["Hesap esası", "Kalite sınıfı G"],
          ["Balans kalite sınıfı", `G ${fa(pr.G, 2)}`],
          ["Rotor kütlesi", `${f(r.mass, 1)} g`],
          ["Servis hızı", `${f(pr.serviceSpeed, 0)} rpm (Ω = ${f(r.omega, 2)} rad/s)`],
          ["U_per = G·m/Ω", `${fa(r.Uper)} g·mm`],
          ["Yatak payı A / B", `${f(r.alloc.kA * 100, 0)}% / ${f(r.alloc.kB * 100, 0)}%${r.transfer.s < 0.999 ? `, s = ${f(r.transfer.s, 3)}` : ""}`],
          ...r.planes.map((pl, i) => [`Dinamik tolerans ${r.nPlanes === 1 ? "" : i + 1}`.trim(), `${fa(pl.U)} g·mm  →  ${C.fmtMass(pl.m)}`]),
        ]
      : [["Durum", "hesap yapılamadı"]];
    iso.forEach(([k, v], i) => {
      txt(k, M + colW + 4, y + i * 4.3, { size: 8.5, color: LABEL });
      txt(fit(v, colW - 46, 8.5, i >= 6), M + colW + 42, y + i * 4.3, { size: 8.5, bold: i >= 6 });
    });
    y += Math.max(geo.length, iso.length) * 4.3 + 3;

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
