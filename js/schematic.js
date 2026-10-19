/*
 * Şematik gösterim: eksen üzerinde parçalar, yataklar ve balans noktaları.
 * Geometri bir kez "şekil listesi" olarak üretilir; hem SVG (ekran) hem de
 * jsPDF (rapor) için aynı liste kullanılır.
 */
(function (root) {
  "use strict";
  const C = root.BalCalc;

  const BASE_COL = {
    shaft: "#8796a8",
    part: "#cfd8e3",
    partStroke: "#6b7b8f",
    partOff: "#eef1f4",
    partOffStroke: "#c3cad3",
    plane: "#1e88e5",
    planeOff: "#b9d7f3",
    bearing: "#37474f",
    bearingOff: "#c3cad3",
    cg: "#e53935",
    dim: "#455a64",
    text: "#263238",
    muted: "#90a4ae",
  };

  /**
   * @param state  uygulama durumu
   * @param opts   { process?, result?, w?, h? }
   */
  // PDF baskısı için daha koyu tonlar
  const PRINT = {
    shaft: "#5f6f82",
    partStroke: "#4a5a6e",
    plane: "#1565c0",
    planeOff: "#90caf9",
    bearing: "#212b31",
    cg: "#c62828",
    dim: "#1f2a30",
    text: "#111111",
    muted: "#6b7c88",
  };

  function build(state, opts = {}) {
    const COL = opts.print ? { ...BASE_COL, ...PRINT } : BASE_COL;
    const W = opts.w || 760;
    const H = opts.h || 240;
    const shapes = [];
    const proc = opts.process || null;
    const res = opts.result || null;

    const parts = (state.parts || []).filter((p) => Number.isFinite(C.num(p.x)));
    const bearings = (state.bearings || []).filter((b) => Number.isFinite(C.num(b.x)));
    const points = C.allPoints(state).filter((pp) => Number.isFinite(C.num(pp.point.x)));

    const xs = [...parts.map((p) => C.num(p.x)), ...bearings.map((b) => C.num(b.x)), ...points.map((pp) => C.num(pp.point.x))];
    if (!xs.length) {
      shapes.push({ t: "text", x: W / 2, y: H / 2, s: "Şema için parça / yatak tanımlayın", size: 13, anchor: "middle", fill: COL.muted });
      return { w: W, h: H, shapes };
    }
    let lo = Math.min(...xs);
    let hi = Math.max(...xs);
    if (hi - lo < 1) {
      lo -= 50;
      hi += 50;
    }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const mL = 30;
    const mR = 30;
    const X = (x) => mL + ((x - lo) / (hi - lo)) * (W - mL - mR);
    const axisY = Math.round(H * 0.47);

    const partOn = (p) => !proc || (proc.partIds || []).includes(p.id);
    const bearingOn = (b) => !proc || (proc.bearingIds || []).includes(b.id);
    const planeIdx = (pt) => (proc ? (proc.pointIds || []).slice(0, proc.planes === 1 ? 1 : 2).indexOf(pt.id) : -1);

    // Şaft çizgisi (aktif elemanlar boyunca)
    const activeXs = [
      ...parts.filter(partOn).map((p) => C.num(p.x)),
      ...bearings.filter(bearingOn).map((b) => C.num(b.x)),
      ...points.filter((pp) => partOn(pp.part)).map((pp) => C.num(pp.point.x)),
    ];
    const sLo = activeXs.length ? Math.min(...activeXs) : lo;
    const sHi = activeXs.length ? Math.max(...activeXs) : hi;
    shapes.push({ t: "line", x1: X(lo) - 6, y1: axisY, x2: X(hi) + 6, y2: axisY, stroke: COL.muted, width: 0.8, dash: [6, 4] });
    shapes.push({ t: "rect", x: X(sLo) - 10, y: axisY - 4, w: X(sHi) - X(sLo) + 20, h: 8, fill: "#dde3ea", stroke: COL.shaft, width: 1, r: 3 });

    // Parçalar (kütle ∝ hacim → yükseklik ∝ ∛m)
    const maxCb = Math.max(1, ...parts.map((p) => Math.cbrt(Math.max(0, C.num(p.mass) || 0))));
    const maxR = Math.max(1, ...points.map((pp) => C.num(pp.point.r) || 0));
    const rScale = (r) => 8 + (Math.max(0, r) / maxR) * (H * 0.24);
    parts.forEach((p, i) => {
      const on = partOn(p);
      const k = Math.cbrt(Math.max(0, C.num(p.mass) || 0)) / maxCb;
      const h = 18 + k * H * 0.42;
      const w = 12 + k * 18;
      const cx = X(C.num(p.x));
      shapes.push({
        t: "rect", x: cx - w / 2, y: axisY - h / 2, w, h, r: 3,
        fill: on ? COL.part : COL.partOff, stroke: on ? COL.partStroke : COL.partOffStroke, width: 1,
      });
      if (proc && !on) return; // proses görünümünde montaj dışı parçalar etiketlenmez
      shapes.push({
        t: "text", x: cx, y: 14 + (i % 2) * 13, s: p.name || `Parça ${i + 1}`, size: 10.5, anchor: "middle",
        fill: on ? COL.text : COL.muted, bold: on && !!proc,
      });
      shapes.push({ t: "line", x1: cx, y1: 18 + (i % 2) * 13, x2: cx, y2: axisY - h / 2 - 2, stroke: on ? COL.muted : "#dfe4e9", width: 0.6, dash: [2, 2] });
    });

    // Balans noktaları (mavi halka, yükseklik ∝ r)
    points.forEach((pp) => {
      const idx = planeIdx(pp.point);
      const on = partOn(pp.part);
      const cx = X(C.num(pp.point.x));
      const rh = rScale(C.num(pp.point.r) || 0);
      const sel = idx >= 0;
      shapes.push({
        t: "rect", x: cx - (sel ? 3 : 2), y: axisY - rh, w: sel ? 6 : 4, h: rh * 2, r: 2,
        fill: sel ? COL.plane : on ? COL.planeOff : "#e3edf7", stroke: sel ? "#0d47a1" : "none", width: sel ? 0.8 : 0,
      });
      if (sel) {
        shapes.push({ t: "text", x: cx, y: axisY - rh - 4, s: `D${idx + 1}`, size: 10.5, anchor: "middle", fill: "#0d47a1", bold: true });
      } else if (!proc) {
        shapes.push({ t: "text", x: cx, y: axisY - rh - 4, s: pp.point.name || "P", size: 9, anchor: "middle", fill: COL.plane });
      }
    });

    // Yataklar (üçgen)
    bearings.forEach((b) => {
      const on = bearingOn(b);
      const cx = X(C.num(b.x));
      const top = axisY + 5;
      shapes.push({
        t: "poly", pts: [[cx, top], [cx - 10, top + 20], [cx + 10, top + 20]],
        fill: on ? COL.bearing : "#ffffff", stroke: on ? COL.bearing : COL.bearingOff, width: 1.2,
      });
      shapes.push({ t: "line", x1: cx - 14, y1: top + 22, x2: cx + 14, y2: top + 22, stroke: on ? COL.bearing : COL.bearingOff, width: 1.5 });
      shapes.push({ t: "text", x: cx, y: top + 35, s: b.name || "Yatak", size: 10, anchor: "middle", fill: on ? COL.text : COL.muted, bold: on && !!proc });
    });

    // Kütle merkezi
    let xcg = NaN;
    if (res && Number.isFinite(res.xcg)) xcg = res.xcg;
    else if (!proc) {
      let M = 0, Mx = 0;
      for (const p of parts) {
        const m = C.num(p.mass);
        if (m > 0) { M += m; Mx += m * C.num(p.x); }
      }
      if (M > 0) xcg = Mx / M;
    }
    if (Number.isFinite(xcg)) {
      const cx = X(xcg);
      shapes.push({ t: "circle", cx, cy: axisY, r: 6, fill: "#ffffff", stroke: COL.cg, width: 1.5 });
      shapes.push({ t: "poly", pts: [[cx, axisY], [cx, axisY - 6], [cx + 6, axisY]], fill: COL.cg, stroke: "none" });
      shapes.push({ t: "poly", pts: [[cx, axisY], [cx, axisY + 6], [cx - 6, axisY]], fill: COL.cg, stroke: "none" });
      shapes.push({ t: "text", x: cx + 9, y: axisY + 16, s: "CG", size: 9.5, anchor: "start", fill: COL.cg, bold: true });
    }

    // Ölçüler: yatak açıklığı L ve her düzlemin en yakın yatağa mesafesi
    if (res && res.valid) {
      const dimLine = (x1, x2, y, label, bold) => {
        const a = X(x1);
        const b = X(x2);
        shapes.push({ t: "line", x1: a, y1: y, x2: b, y2: y, stroke: COL.dim, width: 0.8 });
        [a, b].forEach((px) => shapes.push({ t: "line", x1: px, y1: y - 2, x2: px, y2: y + 5, stroke: COL.dim, width: 1 })); // yazının altında kalır
        shapes.push({ t: "text", x: (a + b) / 2, y: y - 4, s: label, size: 10, anchor: "middle", fill: COL.dim, bold });
      };
      res.planes.forEach((pl, i) => {
        const y = H - (res.nPlanes === 1 ? 28 : 44 - i * 17);
        const name = res.nPlanes === 1 ? "D" : `D${i + 1}`;
        if (pl.nearDist < 0.05) {
          shapes.push({ t: "text", x: X(pl.x), y: y - 4, s: `${name}: yatak üzerinde`, size: 10, anchor: "middle", fill: COL.dim, bold: true });
        } else dimLine(pl.nearBearing.xv, pl.x, y, `${name} – ${pl.nearBearing.name}: ${C.fmt(pl.nearDist, 1)} mm`, true);
      });
      dimLine(res.bearings[0].xv, res.bearings[1].xv, H - 8, `L = ${C.fmt(res.L, 1)} mm`, false);
    }
    if (opts.print) for (const sh of shapes) if (sh.t === "text") sh.size *= 1.12;
    return { w: W, h: H, shapes };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function toSVG(sch, cls = "schematic", label = "Rotor şeması") {
    const out = [`<svg viewBox="0 0 ${sch.w} ${sch.h}" xmlns="http://www.w3.org/2000/svg" class="${cls}" role="img" aria-label="${esc(label)}">`];
    for (const s of sch.shapes) {
      const st = `stroke="${s.stroke || "none"}" stroke-width="${s.width || 0}"${s.dash ? ` stroke-dasharray="${s.dash.join(" ")}"` : ""}`;
      if (s.t === "line") out.push(`<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${st}/>`);
      else if (s.t === "rect") out.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r || 0}" fill="${s.fill || "none"}" ${st}/>`);
      else if (s.t === "poly")
        out.push(`<${s.open ? "polyline" : "polygon"} points="${s.pts.map((p) => p.join(",")).join(" ")}" fill="${s.open ? "none" : s.fill || "none"}" stroke-linecap="round" stroke-linejoin="round" ${st}/>`);
      else if (s.t === "ellipse") out.push(`<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${s.fill || "none"}" ${st}/>`);
      else if (s.t === "circle") out.push(`<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill || "none"}" ${st}/>`);
      else if (s.t === "text")
        out.push(`<text x="${s.x}" y="${s.y}" font-size="${s.size}" text-anchor="${s.anchor || "start"}" fill="${s.fill}"${s.bold ? ' font-weight="700"' : ""}>${esc(s.s)}</text>`);
    }
    out.push("</svg>");
    return out.join("");
  }

  function hex(c) {
    const h = c.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /** Şekil listesini jsPDF belgesine (x0,y0) konumunda, w×h mm kutuya çizer. */
  function toPDF(doc, sch, x0, y0, w, h, fontName) {
    const k = Math.min(w / sch.w, h / sch.h);
    const ox = x0 + (w - sch.w * k) / 2;
    const oy = y0 + (h - sch.h * k) / 2;
    const P = (x, y) => [ox + x * k, oy + y * k];
    for (const s of sch.shapes) {
      const hasStroke = s.stroke && s.stroke !== "none" && (s.width || 0) > 0;
      const hasFill = s.fill && s.fill !== "none";
      if (hasStroke) {
        doc.setDrawColor(...hex(s.stroke));
        doc.setLineWidth(Math.max(0.1, s.width * k));
      }
      if (hasFill) doc.setFillColor(...hex(s.fill));
      const mode = hasFill && hasStroke ? "FD" : hasFill ? "F" : "S";
      if (s.t === "line") {
        if (s.dash) doc.setLineDashPattern(s.dash.map((d) => d * k), 0);
        doc.line(...P(s.x1, s.y1), ...P(s.x2, s.y2));
        if (s.dash) doc.setLineDashPattern([], 0);
      } else if (s.t === "rect") {
        if (!hasFill && !hasStroke) continue;
        const [x, y] = P(s.x, s.y);
        if (s.r) doc.roundedRect(x, y, s.w * k, s.h * k, s.r * k, s.r * k, mode);
        else doc.rect(x, y, s.w * k, s.h * k, mode);
      } else if (s.t === "circle") {
        doc.circle(...P(s.cx, s.cy), s.r * k, mode);
      } else if (s.t === "ellipse") {
        doc.ellipse(...P(s.cx, s.cy), s.rx * k, s.ry * k, mode);
      } else if (s.t === "poly") {
        const pts = s.pts.map(([x, y]) => P(x, y));
        const rel = [];
        for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
        if (s.open) {
          doc.setLineCap("round");
          doc.setLineJoin("round");
          doc.lines(rel, pts[0][0], pts[0][1], [1, 1], "S", false);
          doc.setLineCap("butt");
          doc.setLineJoin("miter");
        } else doc.lines(rel, pts[0][0], pts[0][1], [1, 1], mode, true);
      } else if (s.t === "text") {
        doc.setFont(fontName, s.bold ? "bold" : "normal");
        doc.setFontSize(s.size * k * 2.835);
        doc.setTextColor(...hex(s.fill));
        doc.text(String(s.s), ...P(s.x, s.y), { align: s.anchor === "middle" ? "center" : s.anchor === "end" ? "right" : "left" });
      }
    }
  }

  root.Schematic = { build, toSVG, toPDF, COL: BASE_COL };
})(typeof self !== "undefined" ? self : this);
