/*
 * Arayüz ve durum yönetimi. Tüm veri tarayıcıda tutulur; JSON ile dışa/içe aktarılır.
 */
(function () {
  "use strict";
  const C = window.BalCalc;
  const S = window.Schematic;
  const SCHEMA = "shaft-balance/v1";
  const STORE_KEY = "shaft-balance-state";

  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const numOrNull = (v) => {
    const n = C.num(v);
    return Number.isFinite(n) ? n : null;
  };

  // ------------------------------------------------------------------ durum
  function emptyState() {
    return {
      schema: SCHEMA,
      meta: { title: "", orderNo: "", rotorId: "", rotorModel: "", operator: "", direction: "İleri", notes: "" },
      global: { serviceSpeed: null, balanceSpeed: null, G: 2.5 },
      parts: [],
      bearings: [],
      processes: [],
      ui: { tab: "definition", activeProcessId: null },
    };
  }

  function exampleState() {
    const s = emptyState();
    s.meta = { title: "Pompa rotoru kademeli montaj balansı", orderNo: "00001", rotorId: "POMPA ROTORU 1", rotorModel: "ANOVA", operator: "", direction: "İleri", notes: "Örnek: 3 kademeli montaj balansı" };
    s.global = { serviceSpeed: 7200, balanceSpeed: 2000, G: 1.6 };
    const shaft = { id: "p-saft", name: "Şaft", mass: 315, x: 67.5, points: [{ id: "pt-s1", name: "Ş-orta", x: 67.5, r: 8 }] };
    const hub = { id: "p-gobek", name: "Göbek", mass: 500, x: 40, points: [{ id: "pt-g1", name: "G-ön", x: 23, r: 20 }] };
    const imp = { id: "p-cark", name: "Çark", mass: 500, x: 95, points: [{ id: "pt-c1", name: "Ç-arka", x: 103.5, r: 20 }, { id: "pt-c2", name: "Ç-dış", x: 160, r: 30 }] };
    s.parts = [hub, shaft, imp];
    s.bearings = [
      { id: "b-a", name: "Yatak A", x: 0 },
      { id: "b-b", name: "Yatak B", x: 135 },
      { id: "b-b2", name: "Yatak B'", x: 120 },
    ];
    s.processes = [
      { id: "pr-1", name: "Adım 1 – Çıplak şaft", partIds: ["p-saft"], bearingIds: ["b-a", "b-b"], planes: 1, pointIds: ["pt-s1"], overrides: { serviceSpeed: null, balanceSpeed: null, G: 2.5 } },
      { id: "pr-2", name: "Adım 2 – Şaft + Göbek", partIds: ["p-saft", "p-gobek"], bearingIds: ["b-a", "b-b"], planes: 2, pointIds: ["pt-g1", "pt-s1"], overrides: { serviceSpeed: null, balanceSpeed: null, G: null } },
      { id: "pr-3", name: "Adım 3 – Komple rotor", partIds: ["p-saft", "p-gobek", "p-cark"], bearingIds: ["b-a", "b-b"], planes: 2, pointIds: ["pt-g1", "pt-c1"], overrides: { serviceSpeed: null, balanceSpeed: null, G: null } },
      { id: "pr-4", name: "Adım 4 – Çark dış düzlem", partIds: ["p-saft", "p-gobek", "p-cark"], bearingIds: ["b-a", "b-b2"], planes: 2, pointIds: ["pt-g1", "pt-c2"], overrides: { serviceSpeed: null, balanceSpeed: 1500, G: null }, optional: true, note: "Yalnızca çark dış düzlemine erişim varsa uygulanır." },
    ];
    s.ui = { tab: "processes", activeProcessId: "pr-3" };
    return s;
  }

  /** İçe aktarılan JSON'u doğrular ve eksik alanları tamamlar. */
  function normalize(raw) {
    if (!raw || typeof raw !== "object") throw new Error("Geçersiz JSON içeriği.");
    if (!Array.isArray(raw.parts) || !Array.isArray(raw.processes)) throw new Error("Dosya bu uygulamaya ait bir proje değil (parts / processes bulunamadı).");
    const s = emptyState();
    Object.assign(s.meta, raw.meta || {});
    for (const k of ["serviceSpeed", "balanceSpeed", "G"]) s.global[k] = numOrNull(raw.global?.[k]);
    s.parts = raw.parts.map((p) => ({
      id: String(p.id || uid()),
      name: String(p.name ?? ""),
      mass: numOrNull(p.mass),
      x: numOrNull(p.x),
      points: (p.points || []).map((pt) => ({ id: String(pt.id || uid()), name: String(pt.name ?? ""), x: numOrNull(pt.x), r: numOrNull(pt.r) })),
    }));
    s.bearings = (raw.bearings || []).map((b) => ({ id: String(b.id || uid()), name: String(b.name ?? ""), x: numOrNull(b.x) }));
    s.processes = raw.processes.map((pr) => ({
      id: String(pr.id || uid()),
      name: String(pr.name ?? ""),
      partIds: (pr.partIds || []).map(String),
      bearingIds: (pr.bearingIds || []).map(String),
      planes: pr.planes === 1 ? 1 : 2,
      pointIds: (pr.pointIds || []).map(String),
      optional: !!pr.optional,
      note: String(pr.note ?? ""),
      overrides: {
        serviceSpeed: numOrNull(pr.overrides?.serviceSpeed),
        balanceSpeed: numOrNull(pr.overrides?.balanceSpeed),
        G: numOrNull(pr.overrides?.G),
      },
    }));
    if (raw.ui)
      s.ui = { tab: raw.ui.tab === "processes" ? "processes" : "definition", activeProcessId: raw.ui.activeProcessId || null, detailsOpen: !!raw.ui.detailsOpen };
    if (!s.processes.some((p) => p.id === s.ui.activeProcessId)) s.ui.activeProcessId = s.processes[0]?.id || null;
    return s;
  }

  let state = loadStored() || exampleState();

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* depolama yoksa sessizce geç */
    }
  }

  const results = () => new Map(state.processes.map((p) => [p.id, C.computeProcess(state, p)]));
  const findPart = (id) => state.parts.find((p) => p.id === id);
  const findProc = (id) => state.processes.find((p) => p.id === id);

  // ------------------------------------------------------------------ yardımcılar
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 3200);
  }

  function numInput(attrs, value, placeholder = "") {
    return `<input type="number" step="any" inputmode="decimal" ${attrs} value="${value ?? ""}" placeholder="${esc(placeholder)}" />`;
  }

  const gList = `<datalist id="gGrades">${C.G_GRADES_EXT.map((g) => `<option value="${g}">G ${g}</option>`).join("")}</datalist>`;

  // ------------------------------------------------------------------ Rotor tanımı
  function renderDefinition() {
    const m = state.meta;
    const g = state.global;
    return `
    <div class="grid def-grid">
      <section class="card">
        <div class="card-h"><h2>Rapor bilgileri</h2></div>
        <div class="card-b fields">
          <label class="field span-all"><span>Proje başlığı <span class="unit">(tüm iş için; özet sayfasında başlık olarak görünür)</span></span><input data-f="meta.title" value="${esc(m.title)}" placeholder="Örn. E-motor rotoru kademeli balans planı" /></label>
          <label class="field"><span>Sipariş no</span><input data-f="meta.orderNo" value="${esc(m.orderNo)}" /></label>
          <label class="field"><span>Rotor ID</span><input data-f="meta.rotorId" value="${esc(m.rotorId)}" /></label>
          <label class="field"><span>Rotor modeli</span><input data-f="meta.rotorModel" value="${esc(m.rotorModel)}" /></label>
          <label class="field"><span>Dönüş yönü</span>
            <select data-f="meta.direction">${["İleri", "Geri"].map((d) => `<option ${m.direction === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label class="field"><span>Hazırlayan / operatör</span><input data-f="meta.operator" value="${esc(m.operator)}" /></label>
          <label class="field"><span>Not</span><input data-f="meta.notes" value="${esc(m.notes)}" /></label>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h2>Genel parametreler</h2><span class="hint">Tüm proseslere miras olarak aktarılır</span></div>
        <div class="card-b fields">
          <label class="field"><span>Operasyonel (servis) hız <span class="unit">[rpm]</span></span>${numInput('data-f="global.serviceSpeed" min="0"', g.serviceSpeed)}</label>
          <label class="field"><span>Genel balans hızı <span class="unit">[rpm]</span></span>${numInput('data-f="global.balanceSpeed" min="0"', g.balanceSpeed)}</label>
          <label class="field"><span>Balans kalite sınıfı <span class="unit">G [mm/s]</span></span>${numInput('data-f="global.G" min="0" list="gGrades"', g.G)}</label>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h2>Yatak bölgeleri</h2><button type="button" class="btn small" data-action="add-bearing">+ Yatak ekle</button></div>
        <div class="card-b">
          ${state.bearings.length ? `<div class="list-h b-row"><span>Ad</span><span>x [mm]</span><span></span></div>` : `<p class="hint">Henüz yatak yok.</p>`}
          ${state.bearings
            .map(
              (b) => `<div class="b-row">
                <input class="cell" data-bearing="${b.id}" data-k="name" value="${esc(b.name)}" aria-label="Yatak adı" />
                ${numInput(`class="cell" data-bearing="${b.id}" data-k="x" aria-label="Yatak x"`, b.x)}
                <button type="button" class="btn icon danger" data-action="del-bearing" data-id="${b.id}" title="Yatağı sil">✕</button>
              </div>`
            )
            .join("")}
          <p class="hint">Koordinatlar ortak eksenel referansa göre (mm). Her proseste 2 yatak seçilir.</p>
        </div>
      </section>
      <section class="card span-all">
        <div class="card-h"><h2>Şema</h2><span class="hint">Tüm parçalar, balans noktaları ve yataklar · CG = toplam kütle merkezi</span></div>
        <div class="card-b"><div class="schem-box" data-live="def-schematic">${S.toSVG(S.build(state, { h: 230 }))}</div></div>
      </section>
      <section class="card span-all">
        <div class="card-h"><h2>Parçalar</h2><button type="button" class="btn small" data-action="add-part">+ Parça ekle</button></div>
        <div class="card-b">
          ${state.parts.length ? "" : `<p class="hint">Henüz parça yok. Şaftı istediğiniz kadar parçaya ayırın.</p>`}
          ${state.parts.map(renderPart).join("")}
        </div>
      </section>
    </div>${gList}`;
  }

  function renderPart(p, i) {
    return `<div class="part">
      <div class="part-row">
        <label class="field"><span>Parça ${i + 1} adı / no</span><input data-part="${p.id}" data-k="name" value="${esc(p.name)}" /></label>
        <label class="field"><span>Kütle m <span class="unit">[g]</span></span>${numInput(`data-part="${p.id}" data-k="mass" min="0"`, p.mass)}</label>
        <label class="field"><span>Ağırlık merk. x <span class="unit">[mm]</span></span>${numInput(`data-part="${p.id}" data-k="x"`, p.x)}</label>
        <button type="button" class="btn icon danger" data-action="del-part" data-id="${p.id}" title="Parçayı sil">✕</button>
      </div>
      <div class="pt-list">
        ${p.points.length ? `<div class="list-h pt-row"><span>Balans noktası</span><span class="m-hide">x [mm]</span><span class="m-hide">r [mm]</span><span class="m-hide"></span></div>` : ""}
        ${p.points
          .map(
            (pt) => `<div class="pt-row">
              <input class="cell" data-point="${pt.id}" data-part="${p.id}" data-k="name" value="${esc(pt.name)}" aria-label="Nokta adı" />
              <label class="field"><span class="m-lbl">x [mm]</span>${numInput(`class="cell" data-point="${pt.id}" data-part="${p.id}" data-k="x" aria-label="Nokta x"`, pt.x)}</label>
              <label class="field"><span class="m-lbl">r [mm]</span>${numInput(`class="cell" data-point="${pt.id}" data-part="${p.id}" data-k="r" min="0" aria-label="Nokta r"`, pt.r)}</label>
              <button type="button" class="btn icon danger" data-action="del-point" data-part="${p.id}" data-id="${pt.id}" title="Noktayı sil">✕</button>
            </div>`
          )
          .join("")}
        <button type="button" class="btn small ghost" data-action="add-point" data-id="${p.id}">+ Balans noktası</button>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ Prosesler
  function renderProcesses() {
    if (!state.processes.length) {
      return `<div class="card empty"><h2>Henüz balans prosesi yok</h2>
        <p>Montaj adımlarını modelleyen kademeli prosesler tanımlayın.</p>
        <button type="button" class="btn primary" data-action="add-proc">+ Proses ekle</button></div>`;
    }
    const R = results();
    const active = findProc(state.ui.activeProcessId) || state.processes[0];
    state.ui.activeProcessId = active.id;
    return `<div class="proc-layout">
      <aside class="card proc-list">
        <div class="card-h"><h2>Proses adımları</h2><button type="button" class="btn small" data-action="add-proc">+ Ekle</button></div>
        <ol data-live="proc-list">${renderProcList(R)}</ol>
      </aside>
      <section class="card">${renderProcCard(active, R.get(active.id))}</section>
    </div>${gList}`;
  }

  function renderProcList(R) {
    return state.processes
      .map((p, i) => {
        const r = R.get(p.id);
        const sub = r.valid
          ? `${esc(r.type.nameEn)} · ${r.planes.map((pl) => C.fmtMass(pl.m)).join(" / ")}`
          : `<span class="bad">Eksik tanım</span>`;
        return `<li class="proc-item ${p.id === state.ui.activeProcessId ? "active" : ""}" data-action="select-proc" data-id="${p.id}">
          <span class="num">${i + 1}</span>
          <span><div class="t">${esc(p.name || `Proses ${i + 1}`)}${p.optional ? ` <span class="opt-tag">opsiyonel</span>` : ""}</div><div class="s">${sub}</div></span></li>`;
      })
      .join("");
  }

  function renderProcCard(p, r) {
    const idx = state.processes.indexOf(p);
    return `
      <div class="card-h">
        <input class="cell" style="font-weight:700;font-size:15px;max-width:420px" data-proc="${p.id}" data-k="name" value="${esc(p.name)}" aria-label="Proses adı" />
        <div class="actions">
          <label class="chip opt-chip ${p.optional ? "on" : ""}" title="Yapılması tercihe bağlı adım; raporda belirtilir"><input type="checkbox" data-proc="${p.id}" data-k="optional" ${p.optional ? "checked" : ""}/>Opsiyonel</label>
          <button type="button" class="btn small icon" data-action="move-proc" data-dir="-1" ${idx === 0 ? "disabled" : ""} title="Yukarı taşı">↑</button>
          <button type="button" class="btn small icon" data-action="move-proc" data-dir="1" ${idx === state.processes.length - 1 ? "disabled" : ""} title="Aşağı taşı">↓</button>
          <button type="button" class="btn small" data-action="dup-proc">Kopyala</button>
          <button type="button" class="btn small danger" data-action="del-proc">Sil</button>
          <button type="button" class="btn small primary" data-action="pdf-one">PDF raporu</button>
        </div>
      </div>
      <div class="card-b" data-live="summary">${renderSummary(p, r)}</div>
      <details class="sec" open>
        <summary>Proses ayarları <span class="hint">parçalar, yataklar, düzlemler, hız / G</span></summary>
        <div class="sec-b">${renderConfig(p)}</div>
      </details>
      <details class="sec" data-k="details" ${state.ui.detailsOpen ? "open" : ""}>
        <summary>Mühendislik detayları <span class="hint">formüller, moment dengesi, kütle merkezi, ham parametreler</span></summary>
        <div class="sec-b" data-live="details">${renderDetails(p, r)}</div>
      </details>`;
  }

  function srcBadge(src) {
    return src === "process" ? `<span class="src own">prosese özel</span>` : `<span class="src">genel</span>`;
  }

  function renderSummary(p, r) {
    const pr = r.params;
    const kpis = `<div class="kpis">
      <div class="kpi strong">Rotor kütlesi <b>${C.fmt(r.mass, 1)}</b> g</div>
      <div class="kpi strong">Kalite <b>G ${C.fmtAuto(pr.G, 2)}</b> ${srcBadge(pr.sources.G)}</div>
      <div class="kpi">Servis hızı <b>${C.fmt(pr.serviceSpeed, 0)}</b> rpm ${srcBadge(pr.sources.serviceSpeed)}</div>
      <div class="kpi">X<sub>cg</sub> <b>${C.fmt(r.xcg, 1)}</b> mm</div>
      ${r.valid ? `<div class="kpi">U<sub>per</sub> toplam <b>${C.fmtAuto(r.Uper)}</b> g·mm</div>` : ""}
    </div>
    <div class="ref-note">Balans hızı (referans, toleransı etkilemez): ${C.fmt(pr.balanceSpeed, 0)} rpm · ${pr.sources.balanceSpeed === "process" ? "prosese özel" : "genel"}</div>`;
    const schem = `<div class="schem-box">${S.toSVG(S.build(state, { process: p, result: r, h: 260 }))}</div>`;
    const flags =
      (p.optional ? `<div class="alert opt"><b>Opsiyonel adım</b> – yapılması tercihe bağlıdır; raporda böyle belirtilir.</div>` : "") +
      (p.note && p.note.trim() ? `<div class="alert note"><b>Proses notu:</b> ${esc(p.note).replace(/\n/g, "<br>")}</div>` : "");
    const warn = flags + (r.warnings.length ? `<div class="alert warn">${r.warnings.map(esc).join("<br>")}</div>` : "");
    if (!r.valid) {
      return `<div class="alert err"><b>Hesap yapılamadı:</b><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>${warn}${kpis}<div style="height:10px"></div>${schem}`;
    }
    const tiles = r.planes
      .map(
        (pl, i) => `<div class="tol">
          <div class="lbl">${r.nPlanes === 1 ? "Düzlem (statik)" : `Düzlem ${i + 1}`}</div>
          <div class="where">${esc(pl.point.name)} · ${esc(pl.part.name)}</div>
          <div class="rad">Yarıçap r${r.nPlanes === 1 ? "" : i + 1} = <b>${C.fmt(pl.r, 1)} mm</b></div>
          <div class="big">${C.massParts(pl.m).v}<small>${C.massParts(pl.m).unit}</small></div>
          <div class="mid">${C.fmtAuto(pl.U)} <small>g·mm</small></div>
        </div>`
      )
      .join("");
    return `${warn}<div class="op-panel">
        <div class="type-box">
          ${S.toSVG(window.TypeArt.build(r.type.key), "type-art", `${r.type.nameEn} temsili görsel`)}
          <div>
            <div class="type-name">${esc(r.type.name)}</div>
            <div class="type-en">${esc(r.type.nameEn)} · otomatik tespit</div>
            <div class="reason">${esc(r.type.reason)}</div>
          </div>
        </div>
        <div class="tol-wrap">
          <div class="hint" style="font-weight:600">İzin verilen artık dengesizlik (ISO 21940-11)</div>
          <div class="tol-grid">${tiles}</div>
          ${kpis}
          ${schem}
          ${renderGradeCompare(r)}
        </div>
      </div>`;
  }

  /** Komşu standart G sınıfları (bilgi amaçlı, sade tablo). */
  function renderGradeCompare(r) {
    const rows = C.gradeComparison(r);
    if (!rows.length) return "";
    const head = r.planes.map((_, i) => `<th>${r.nPlanes === 1 ? "Düzlem" : `D${i + 1}`}</th>`).join("");
    const body = rows
      .map(
        (row) => `<tr class="${row.current ? "cur" : ""}">
          <td>G ${C.fmtAuto(row.G, 2)}${row.current ? ` <span class="sel-tag">seçili${row.standard ? "" : " · standart dışı"}</span>` : ""}</td>
          <td>${C.fmtAuto(row.Uper)}</td>
          ${row.planes.map((x) => `<td>${C.fmtMass(x.m)} <span class="hint">· ${C.fmtAuto(x.U)} g·mm</span></td>`).join("")}
        </tr>`
      )
      .join("");
    return `<div class="gcmp">
      <div class="gcmp-h">Komşu standart G sınıflarıyla karşılaştırma <span class="hint">(bilgi amaçlı)</span></div>
      <table class="tbl"><thead><tr><th>Sınıf</th><th>U<sub>per</sub> [g·mm]</th>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
  }

  function renderConfig(p) {
    const selParts = state.parts.filter((x) => p.partIds.includes(x.id));
    const avail = C.allPoints(state).filter((pp) => selParts.includes(pp.part));
    const pr = C.resolveParams(p, state.global);
    const pointSel = (i) => `<label class="field"><span>Düzlem ${i + 1}${p.planes === 1 ? " (statik)" : ""}</span>
        <select data-proc="${p.id}" data-k="point" data-i="${i}">
          <option value="">— seçiniz —</option>
          ${avail
            .map(
              (pp) => `<option value="${pp.point.id}" ${p.pointIds[i] === pp.point.id ? "selected" : ""} ${p.pointIds.includes(pp.point.id) && p.pointIds[i] !== pp.point.id ? "disabled" : ""}>
                ${esc(pp.part.name)} › ${esc(pp.point.name)} (x=${C.fmt(C.num(pp.point.x), 1)}, r=${C.fmt(C.num(pp.point.r), 1)})</option>`
            )
            .join("")}
        </select></label>`;
    const ov = (k, label, unit) => {
      const own = C.isSet(p.overrides[k]);
      const g = state.global[k];
      return `<div class="ov-row">
        <label class="field"><span>${label} <span class="unit">${unit}</span> <span class="badge ${own ? "own" : ""}" data-live="badge-${k}">${own ? "prosese özel" : `genelden: ${C.isSet(g) ? g : "–"}`}</span></span>
          ${numInput(`data-proc="${p.id}" data-ov="${k}" min="0" ${k === "G" ? 'list="gGrades"' : ""}`, p.overrides[k], C.isSet(g) ? String(g) : "")}</label>
        <button type="button" class="btn small" data-action="reset-ov" data-k="${k}" ${own ? "" : "disabled"} title="Genel değere dön">Genel</button>
      </div>`;
    };
    return `<div class="cfg-grid">
      <div class="cfg-block">
        <h4>Montajdaki parçalar</h4>
        <div class="chips">${state.parts
          .map(
            (x) => `<label class="chip ${p.partIds.includes(x.id) ? "on" : ""}"><input type="checkbox" data-proc="${p.id}" data-k="part" value="${x.id}" ${p.partIds.includes(x.id) ? "checked" : ""}/>${esc(x.name || "?")}</label>`
          )
          .join("") || `<span class="hint">Önce Rotor Tanımı'nda parça ekleyin.</span>`}</div>
        <h4 style="margin-top:14px">Referans yataklar <span class="hint">(2 adet)</span></h4>
        <div class="chips">${state.bearings
          .map(
            (b) => `<label class="chip ${p.bearingIds.includes(b.id) ? "on" : ""}"><input type="checkbox" data-proc="${p.id}" data-k="bearing" value="${b.id}" ${p.bearingIds.includes(b.id) ? "checked" : ""}/>${esc(b.name || "?")} <span class="hint">x=${C.fmt(C.num(b.x), 1)}</span></label>`
          )
          .join("") || `<span class="hint">Önce yatak tanımlayın.</span>`}</div>
      </div>
      <div class="cfg-block">
        <h4>Düzlem tipi</h4>
        <div class="seg" role="group">
          <button type="button" class="${p.planes === 1 ? "on" : ""}" data-action="set-planes" data-n="1">1 Düzlem</button>
          <button type="button" class="${p.planes === 2 ? "on" : ""}" data-action="set-planes" data-n="2">2 Düzlem</button>
        </div>
        <h4 style="margin-top:14px">Düzeltme noktaları</h4>
        ${avail.length ? pointSel(0) + (p.planes === 2 ? `<div style="height:8px"></div>${pointSel(1)}` : "") : `<span class="hint">Seçili parçalarda balans noktası yok.</span>`}
      </div>
      <div class="cfg-block">
        <h4>Hız ve kalite <span class="hint">(boş = genelden miras)</span></h4>
        ${ov("balanceSpeed", "Balans hızı", "[rpm]")}
        ${ov("serviceSpeed", "Servis hızı", "[rpm]")}
        ${ov("G", "Kalite sınıfı G", "[mm/s]")}
        <p class="hint">Geçerli: ${C.fmt(pr.balanceSpeed, 0)} rpm balans · ${C.fmt(pr.serviceSpeed, 0)} rpm servis · G ${C.fmtAuto(pr.G, 2)}</p>
      </div>
      <div class="cfg-block span-all">
        <h4>Proses notu <span class="hint">(raporda bu prosesin sayfasında gösterilir)</span></h4>
        <textarea class="cell note-input" rows="2" data-proc="${p.id}" data-k="note" placeholder="Örn. bu adımda dikkat edilecek nokta, kullanılacak ağırlık tipi…">${esc(p.note)}</textarea>
      </div>
    </div>`;
  }

  function renderDetails(p, r) {
    const f = C.fmt;
    const fa = C.fmtAuto;
    const cgTable = `<table class="tbl"><thead><tr><th>Parça</th><th>m [g]</th><th>x [mm]</th><th>m·x [g·mm]</th><th>Σm [g]</th><th>X<sub>cg</sub> kümülatif</th></tr></thead><tbody>
      ${r.cgRows.map((row) => `<tr><td>${esc(row.part.name)}</td><td>${f(row.m, 1)}</td><td>${f(row.x, 2)}</td><td>${f(row.mx, 1)}</td><td>${f(row.cumM, 1)}</td><td>${f(row.cumX, 2)}</td></tr>`).join("")}
      <tr class="sum"><td>Toplam</td><td>${f(r.mass, 1)}</td><td></td><td>${f(r.momentSum, 1)}</td><td></td><td>${f(r.xcg, 2)}</td></tr></tbody></table>
      <div class="formula">X_cg = Σ(mᵢ·xᵢ) / Σmᵢ = ${f(r.momentSum, 1)} / ${f(r.mass, 1)} = ${f(r.xcg, 3)} mm</div>`;
    const raw = `<pre class="raw">${esc(JSON.stringify({ process: p, resolved: r.params }, null, 2))}</pre>`;
    if (!r.valid) {
      return `<div class="det-grid"><div><h4>Kütle merkezi entegrasyonu</h4>${cgTable}</div><div><h4>Ham parametreler</h4>${raw}</div></div>`;
    }
    const a = r.alloc;
    const [bA, bB] = r.bearings;
    const moment = `<table class="tbl"><thead><tr><th>Büyüklük</th><th>Değer</th></tr></thead><tbody>
      <tr><td>Yatak A (${esc(bA.name)}) x<sub>b1</sub></td><td>${f(bA.xv, 2)} mm</td></tr>
      <tr><td>Yatak B (${esc(bB.name)}) x<sub>b2</sub></td><td>${f(bB.xv, 2)} mm</td></tr>
      <tr><td>Yatak açıklığı L</td><td>${f(r.L, 2)} mm</td></tr>
      <tr><td>L<sub>A</sub> = X<sub>cg</sub> − x<sub>b1</sub></td><td>${f(r.LA, 2)} mm</td></tr>
      <tr><td>L<sub>B</sub> = x<sub>b2</sub> − X<sub>cg</sub></td><td>${f(r.LB, 2)} mm</td></tr>
      <tr><td>Statik yük payı A = m·L<sub>B</sub>/L</td><td>${f(r.reactions.A, 1)} g</td></tr>
      <tr><td>Statik yük payı B = m·L<sub>A</sub>/L</td><td>${f(r.reactions.B, 1)} g</td></tr>
      </tbody></table>
      <div class="formula">ΣM_A = 0 → F_B·L = m·L_A → F_B = ${f(r.mass, 1)}·${f(r.LA, 2)}/${f(r.L, 2)} = ${f(r.reactions.B, 2)} g
ΣF = 0 → F_A = m − F_B = ${f(r.reactions.A, 2)} g</div>`;
    const iso = `<div class="formula">Ω = 2π·n/60 = 2π·${f(r.params.serviceSpeed, 0)}/60 = ${f(r.omega, 3)} rad/s
U_per = 1000·G·M/Ω  (M [kg]) = G·m/Ω  (m [g])
      = ${fa(r.params.G, 3)} · ${f(r.mass, 1)} / ${f(r.omega, 3)} = ${fa(r.Uper, 4)} g·mm
e_per = U_per / m = ${fa(r.eper * 1000, 4)} µm</div>`;
    const alloc = `<div class="formula">Yatak düzlemlerine dağıtım (ISO 21940-11, sınırlar ${C.ALLOC_MIN}…${C.ALLOC_MAX}):
k_A = L_B/L = ${f(a.rawA, 3)} → ${f(a.kA, 3)}${a.clamped ? "  (sınıra kırpıldı)" : ""}
k_B = L_A/L = ${f(a.rawB, 3)} → ${f(a.kB, 3)}
U_per,A = ${fa(a.UA, 4)} g·mm    U_per,B = ${fa(a.UB, 4)} g·mm</div>`;
    let transfer;
    if (r.transfer.mode === "static") {
      const pl = r.planes[0];
      transfer = `<div class="formula">Tek düzlem (statik): U_düzlem = U_per = ${fa(pl.U, 4)} g·mm
m_per = U / r = ${fa(pl.U, 4)} / ${f(pl.r, 2)} = ${fa(pl.m, 4)} g${pl.m < 1 ? ` = ${C.fmtMass(pl.m, 4)}` : ""}
ABC: a = ${f(r.abc.a, 2)} mm, c = ${f(r.abc.c, 2)} mm</div>`;
    } else {
      const t = r.transfer;
      const [p1, p2] = r.planes;
      transfer = `<div class="formula">Düzlem → yatak etki katsayıları (kaldıraç kuralı):
c_A1 = (x_b2 − x_p1)/L = ${f(t.cA1, 3)}   c_A2 = (x_b2 − x_p2)/L = ${f(t.cA2, 3)}
c_B1 = (x_p1 − x_b1)/L = ${f(t.cB1, 3)}   c_B2 = (x_p2 − x_b1)/L = ${f(t.cB2, 3)}
${
        t.direct
          ? `Düzlemler yataklar arasında ve b = ${f(r.abc.b, 1)} ≥ L/3 = ${f(r.L / 3, 1)} mm →
ISO 21940-11: yatak düzlemi toleransları doğrudan düzlemlere alınır (s = 1).
(Bilgi: en kötü faz kontrolü s_A = ${f(t.sA, 3)}, s_B = ${f(t.sB, 3)})`
          : `En kötü faz durumu: |c_A1|·U₁ + |c_A2|·U₂ ≤ U_per,A ve |c_B1|·U₁ + |c_B2|·U₂ ≤ U_per,B
U₁ = s·U_per,A, U₂ = s·U_per,B →
s_A = ${f(t.sA, 3)}, s_B = ${f(t.sB, 3)} → s = min(1, s_A, s_B) = ${f(t.s, 3)}`
      }
U₁ = ${fa(p1.U, 4)} g·mm → m₁ = U₁/r₁ = ${fa(p1.U, 4)}/${f(p1.r, 2)} = ${fa(p1.m, 4)} g${p1.m < 1 ? ` = ${C.fmtMass(p1.m, 4)}` : ""}
U₂ = ${fa(p2.U, 4)} g·mm → m₂ = U₂/r₂ = ${fa(p2.U, 4)}/${f(p2.r, 2)} = ${fa(p2.m, 4)} g${p2.m < 1 ? ` = ${C.fmtMass(p2.m, 4)}` : ""}
ABC: a = ${f(r.abc.a, 2)}, b = ${f(r.abc.b, 2)}, c = ${f(r.abc.c, 2)} mm</div>`;
    }
    return `<div class="det-grid">
      <div><h4>Kütle merkezi entegrasyonu</h4>${cgTable}</div>
      <div><h4>Eksenel moment dengesi</h4>${moment}</div>
      <div><h4>ISO 21940-11 izin verilen dengesizlik</h4>${iso}${alloc}</div>
      <div><h4>Düzeltme düzlemlerine transfer</h4>${transfer}</div>
      <div><h4>Tip tespiti</h4><div class="formula">${esc(r.type.reason)}${r.type.notes.length ? "\n\n" + r.type.notes.map(esc).join("\n") : ""}</div></div>
      <div><h4>Ham parametreler</h4>${raw}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ çizim
  function render() {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.ui.tab)));
    const app = document.getElementById("app");
    app.innerHTML = state.ui.tab === "definition" ? renderDefinition() : renderProcesses();
    save();
  }

  /** Giriş alanlarını yeniden çizmeden sadece hesaplanan bölgeleri tazeler (odak kaybolmaz). */
  function refresh() {
    save();
    const app = document.getElementById("app");
    if (state.ui.tab === "definition") {
      const el = app.querySelector('[data-live="def-schematic"]');
      if (el) el.innerHTML = S.toSVG(S.build(state, { h: 230 }));
      return;
    }
    const p = findProc(state.ui.activeProcessId);
    if (!p) return;
    const r = C.computeProcess(state, p);
    const R = results();
    const set = (k, html) => {
      const el = app.querySelector(`[data-live="${k}"]`);
      if (el) el.innerHTML = html;
    };
    set("proc-list", renderProcList(R));
    set("summary", renderSummary(p, r));
    set("details", renderDetails(p, r));
    for (const k of ["serviceSpeed", "balanceSpeed", "G"]) {
      const own = C.isSet(p.overrides[k]);
      const g = state.global[k];
      const b = app.querySelector(`[data-live="badge-${k}"]`);
      if (b) {
        b.className = `badge ${own ? "own" : ""}`;
        b.textContent = own ? "prosese özel" : `genelden: ${C.isSet(g) ? g : "–"}`;
      }
      const btn = app.querySelector(`[data-action="reset-ov"][data-k="${k}"]`);
      if (btn) btn.disabled = !own;
    }
  }

  // ------------------------------------------------------------------ olaylar
  function onInput(e) {
    const t = e.target;
    const d = t.dataset;
    const val = t.type === "number" ? numOrNull(t.value) : t.value;
    if (d.f) {
      const [grp, k] = d.f.split(".");
      state[grp][k] = val;
    } else if (d.point) {
      const pt = findPart(d.part)?.points.find((x) => x.id === d.point);
      if (pt) pt[d.k] = val;
    } else if (d.part && d.k && !d.proc) {
      const p = findPart(d.part);
      if (p) p[d.k] = val;
    } else if (d.bearing) {
      const b = state.bearings.find((x) => x.id === d.bearing);
      if (b) b[d.k] = val;
    } else if (d.proc && d.ov) {
      findProc(d.proc).overrides[d.ov] = val;
    } else if (d.proc && (d.k === "name" || d.k === "note")) {
      findProc(d.proc)[d.k] = val;
    } else return;
    refresh();
  }

  function onChange(e) {
    const t = e.target;
    const d = t.dataset;
    if (!d.proc || !["part", "bearing", "point", "optional"].includes(d.k)) return;
    const p = findProc(d.proc);
    if (d.k === "optional") p.optional = t.checked;
    if (d.k === "part") {
      p.partIds = t.checked ? [...new Set([...p.partIds, t.value])] : p.partIds.filter((x) => x !== t.value);
      const allowed = new Set(C.allPoints(state).filter((pp) => p.partIds.includes(pp.part.id)).map((pp) => pp.point.id));
      p.pointIds = p.pointIds.map((id) => (allowed.has(id) ? id : ""));
    } else if (d.k === "bearing") {
      if (t.checked) {
        p.bearingIds = [...p.bearingIds.filter((x) => x !== t.value), t.value];
        if (p.bearingIds.length > 2) p.bearingIds = p.bearingIds.slice(-2);
      } else p.bearingIds = p.bearingIds.filter((x) => x !== t.value);
    } else if (d.k === "point") {
      const i = +d.i;
      const ids = p.pointIds.slice(0, 2);
      while (ids.length < 2) ids.push("");
      ids[i] = t.value;
      p.pointIds = ids;
    }
    render();
  }

  function addProcess() {
    const prev = state.processes[state.processes.length - 1];
    const p = {
      id: uid(),
      name: `Adım ${state.processes.length + 1}`,
      partIds: prev ? [...prev.partIds] : state.parts.map((x) => x.id),
      bearingIds: prev ? [...prev.bearingIds] : state.bearings.slice(0, 2).map((b) => b.id),
      planes: prev ? prev.planes : 2,
      pointIds: [],
      overrides: { serviceSpeed: null, balanceSpeed: null, G: null },
      optional: false,
      note: "",
    };
    state.processes.push(p);
    state.ui.activeProcessId = p.id;
    state.ui.tab = "processes";
  }

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        state.ui.tab = tab.dataset.tab;
        render();
      }
      return;
    }
    const a = el.dataset.action;
    const p = findProc(state.ui.activeProcessId);
    switch (a) {
      case "new":
        if (!confirm("Mevcut proje temizlensin mi? (Önce JSON olarak dışa aktarmanız önerilir.)")) return;
        state = emptyState();
        break;
      case "example":
        if (!confirm("Örnek proje yüklensin mi? Mevcut veriler değiştirilecek.")) return;
        state = exampleState();
        break;
      case "export":
        exportJSON();
        return;
      case "pdf-all":
        makePDF(state.processes.map((x) => x.id), { summary: true });
        return;
      case "pdf-one":
        makePDF([p.id]);
        return;
      case "add-part": {
        const last = state.parts[state.parts.length - 1];
        state.parts.push({ id: uid(), name: `Parça ${state.parts.length + 1}`, mass: null, x: last ? C.num(last.x) + 50 || null : 0, points: [] });
        break;
      }
      case "del-part": {
        const part = findPart(el.dataset.id);
        if (!confirm(`'${part.name}' parçası ve balans noktaları silinsin mi?`)) return;
        const ptIds = part.points.map((x) => x.id);
        state.parts = state.parts.filter((x) => x !== part);
        for (const pr of state.processes) {
          pr.partIds = pr.partIds.filter((x) => x !== part.id);
          pr.pointIds = pr.pointIds.map((x) => (ptIds.includes(x) ? "" : x));
        }
        break;
      }
      case "add-point": {
        const part = findPart(el.dataset.id);
        part.points.push({ id: uid(), name: `${part.name || "P"}-${part.points.length + 1}`, x: C.num(part.x) || null, r: null });
        break;
      }
      case "del-point": {
        const part = findPart(el.dataset.part);
        part.points = part.points.filter((x) => x.id !== el.dataset.id);
        for (const pr of state.processes) pr.pointIds = pr.pointIds.map((x) => (x === el.dataset.id ? "" : x));
        break;
      }
      case "add-bearing": {
        const last = state.bearings[state.bearings.length - 1];
        state.bearings.push({ id: uid(), name: `Yatak ${String.fromCharCode(65 + state.bearings.length)}`, x: last ? C.num(last.x) + 100 || null : 0 });
        break;
      }
      case "del-bearing":
        state.bearings = state.bearings.filter((x) => x.id !== el.dataset.id);
        for (const pr of state.processes) pr.bearingIds = pr.bearingIds.filter((x) => x !== el.dataset.id);
        break;
      case "add-proc":
        addProcess();
        break;
      case "select-proc":
        state.ui.activeProcessId = el.dataset.id;
        break;
      case "dup-proc": {
        const c = JSON.parse(JSON.stringify(p));
        c.id = uid();
        c.name = `${p.name} (kopya)`;
        state.processes.splice(state.processes.indexOf(p) + 1, 0, c);
        state.ui.activeProcessId = c.id;
        break;
      }
      case "del-proc":
        if (!confirm(`'${p.name}' prosesi silinsin mi?`)) return;
        state.processes = state.processes.filter((x) => x !== p);
        state.ui.activeProcessId = state.processes[0]?.id || null;
        break;
      case "move-proc": {
        const i = state.processes.indexOf(p);
        const j = i + +el.dataset.dir;
        if (j < 0 || j >= state.processes.length) return;
        [state.processes[i], state.processes[j]] = [state.processes[j], state.processes[i]];
        break;
      }
      case "set-planes":
        p.planes = +el.dataset.n;
        break;
      case "reset-ov":
        p.overrides[el.dataset.k] = null;
        break;
      default:
        return;
    }
    render();
  }

  function onToggle(e) {
    const t = e.target;
    if (t.matches && t.matches('details[data-k="details"]')) {
      state.ui.detailsOpen = t.open;
      save();
    }
  }

  // ------------------------------------------------------------------ JSON & PDF
  function fileStamp() {
    const base = (state.meta.rotorId || state.meta.orderNo || "balans").replace(/[^\p{L}\p{N}_-]+/gu, "_");
    return `${base}_${new Date().toISOString().slice(0, 10)}`;
  }

  function exportJSON() {
    const R = results();
    const out = {
      ...state,
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      // Bilgi amaçlı: içe aktarmada yeniden hesaplanır
      computed: state.processes.map((p) => {
        const r = R.get(p.id);
        return r.valid
          ? { processId: p.id, type: r.type.key, mass: r.mass, xcg: r.xcg, Uper: r.Uper, planes: r.planes.map((pl) => ({ pointId: pl.point.id, U: pl.U, m: pl.m })) }
          : { processId: p.id, errors: r.errors };
      }),
    };
    download(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), `${fileStamp()}.json`);
    toast("Proje JSON olarak kaydedildi.");
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function importJSON(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        state = normalize(JSON.parse(rd.result));
        render();
        toast(`'${file.name}' yüklendi: ${state.parts.length} parça, ${state.bearings.length} yatak, ${state.processes.length} proses.`);
      } catch (err) {
        alert(`JSON yüklenemedi: ${err.message}`);
      }
    };
    rd.readAsText(file);
  }

  function makePDF(ids, opts = {}) {
    if (!ids.length) return toast("Rapor için proses yok.");
    try {
      const doc = window.Report.generate(state, ids, opts);
      const suffix = ids.length === 1 ? `_${(findProc(ids[0]).name || "proses").replace(/[^\p{L}\p{N}_-]+/gu, "_")}` : "_tum_prosesler";
      doc.save(`${fileStamp()}${suffix}.pdf`);
    } catch (err) {
      console.error(err);
      alert(`PDF oluşturulamadı: ${err.message}`);
    }
  }

  // ------------------------------------------------------------------ başlat
  document.addEventListener("input", onInput);
  document.addEventListener("change", (e) => {
    if (e.target.id === "importFile") {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
      return;
    }
    onChange(e);
  });
  document.addEventListener("click", onClick);
  document.addEventListener("toggle", onToggle, true);
  render();
  window.__balance = { get state() { return state; }, normalize, exampleState };
})();
