// Çalıştırma: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");

const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

function rotor({ planes = 2, pts = ["p1", "p2"], bearings = ["A", "B"], overrides = {} } = {}) {
  return {
    global: { serviceSpeed: 7200, balanceSpeed: 2000, G: 1.6 },
    parts: [
      { id: "s", name: "Şaft", mass: 315, x: 67.5, points: [{ id: "p0", name: "S", x: 67.5, r: 10 }] },
      { id: "h", name: "Göbek", mass: 500, x: 40, points: [{ id: "p1", name: "G", x: 23, r: 20 }, { id: "pL", name: "GL", x: -30, r: 20 }] },
      { id: "c", name: "Çark", mass: 500, x: 95, points: [{ id: "p2", name: "C", x: 103.5, r: 20 }, { id: "pR", name: "CR", x: 170, r: 20 }, { id: "pR2", name: "CR2", x: 200, r: 25 }] },
    ],
    bearings: [{ id: "A", name: "A", x: 0 }, { id: "B", name: "B", x: 135 }, { id: "B2", name: "B2", x: 60 }],
    processes: [{ id: "x", partIds: ["s", "h", "c"], bearingIds: bearings, planes, pointIds: pts, overrides }],
  };
}

test("referans rapor: G1,6 · 1315 g · 7200 rpm → 2×1,4 g·mm", () => {
  const st = rotor();
  const r = C.computeProcess(st, st.processes[0]);
  assert.equal(r.valid, true, r.errors.join());
  close(r.mass, 1315);
  close(r.xcg, 67.5);
  close(r.Uper, (1.6 * 1315) / ((2 * Math.PI * 7200) / 60));
  close(r.planes[0].U, 1.395, 0.005);
  close(r.planes[1].U, 1.395, 0.005);
  close(r.planes[0].m, r.planes[0].U / 20);
  assert.equal(r.type.key, "centered");
  close(r.abc.a, 23);
  close(r.abc.b, 80.5);
  close(r.abc.c, 31.5);
});

test("otomatik tip tespiti", () => {
  const cases = [
    [["p1", "pR"], "center-right"],
    [["pR", "pR2"], "overhung-right"],
    [["pL", "pR"], "polar"],
    [["pL", "p2"], "center-left"],
  ];
  for (const [pts, key] of cases) {
    const st = rotor({ pts });
    const r = C.computeProcess(st, st.processes[0]);
    assert.equal(r.type.key, key, pts.join());
    assert.ok(r.type.reason.includes("belirlendi"));
  }
  const st = rotor({ planes: 1, pts: ["p0"] });
  assert.equal(C.computeProcess(st, st.processes[0]).type.key, "static");
  // Sol çıkıntı: yataklar sağa kaydırıldığında
  const st2 = rotor({ pts: ["pL", "p1"] });
  st2.bearings = [{ id: "A", name: "A", x: 60 }, { id: "B", name: "B", x: 135 }];
  assert.equal(C.computeProcess(st2, st2.processes[0]).type.key, "overhung-left");
});

test("çıkıntılı düzlemler toleransı azaltır, tek düzlem tüm U_per'i alır", () => {
  const st = rotor({ pts: ["pR", "pR2"] });
  const r = C.computeProcess(st, st.processes[0]);
  assert.ok(r.transfer.s < 1);
  assert.ok(r.planes[0].U < r.alloc.UA);
  const s1 = rotor({ planes: 1, pts: ["p0"] });
  const r1 = C.computeProcess(s1, s1.processes[0]);
  close(r1.planes[0].U, r1.Uper);
  close(r1.planes[0].m, r1.Uper / 10);
});

test("miras / yerel geçersiz kılma", () => {
  const st = rotor({ overrides: { G: 6.3, balanceSpeed: null } });
  const p = C.resolveParams(st.processes[0], st.global);
  assert.equal(p.G, 6.3);
  assert.equal(p.sources.G, "process");
  assert.equal(p.balanceSpeed, 2000);
  assert.equal(p.sources.balanceSpeed, "global");
  st.global.balanceSpeed = 2500;
  assert.equal(C.resolveParams(st.processes[0], st.global).balanceSpeed, 2500);
});

test("doğrulama hataları", () => {
  const st = rotor({ bearings: ["A"] });
  const r = C.computeProcess(st, st.processes[0]);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("2 referans yatak")));
  const st2 = rotor({ pts: ["p1"] });
  assert.equal(C.computeProcess(st2, st2.processes[0]).valid, false);
});

test("kütle gösterimi: 1 g altı otomatik mg", () => {
  assert.deepEqual(C.massParts(0.0698), { v: "69,8", unit: "mg" });
  assert.deepEqual(C.massParts(0.001), { v: "1,00", unit: "mg" });
  assert.deepEqual(C.massParts(0.00042), { v: "0,420", unit: "mg" });
  assert.deepEqual(C.massParts(2.5), { v: "2,50", unit: "g" });
  assert.equal(C.massParts(0.99996).unit, "g"); // 1000 mg'a yuvarlanırsa g
  assert.equal(C.fmtMass(0.275), "275 mg");
});

test("en yakın yatak mesafesi", () => {
  const st = rotor({ pts: ["pL", "pR"] }); // polar: -30 ve 170, yataklar 0 / 135
  const r = C.computeProcess(st, st.processes[0]);
  assert.equal(r.planes[0].nearBearing.id, "A");
  close(r.planes[0].nearDist, 30);
  assert.equal(r.planes[0].nearSide, "dışarıda");
  assert.equal(r.planes[1].nearBearing.id, "B");
  close(r.planes[1].nearDist, 35);
  const st2 = rotor(); // 23 ve 103,5 → A'dan 23 içeride, B'den 31,5 içeride
  const r2 = C.computeProcess(st2, st2.processes[0]);
  close(r2.planes[0].nearDist, 23);
  close(r2.planes[1].nearDist, 31.5);
  assert.equal(r2.planes[1].nearSide, "içeride");
});

test("komşu standart G karşılaştırması", () => {
  const st = rotor({ overrides: { G: 0.6 } });
  const r = C.computeProcess(st, st.processes[0]);
  const rows = C.gradeComparison(r);
  assert.deepEqual(rows.map((x) => x.G), [0.4, 0.6, 1, 2.5]);
  assert.equal(rows[1].current, true);
  assert.equal(rows[1].standard, false);
  close(rows[2].Uper, (r.Uper * 1) / 0.6);
  close(rows[0].planes[0].m, (r.planes[0].m * 0.4) / 0.6);
  const st2 = rotor({ overrides: { G: 1 } });
  assert.deepEqual(C.gradeComparison(C.computeProcess(st2, st2.processes[0])).map((x) => x.G), [0.4, 1, 2.5, 6.3]);
});
