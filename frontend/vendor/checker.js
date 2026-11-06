"use strict";
var CounterCheck = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // rules.json
  var require_rules = __commonJS({
    "rules.json"(exports, module) {
      module.exports = {
        _note: "ILLUSTRATIVE rules mirrored from frontend/app.js. Replace with the BPI guidebook and fill `source` with the guidebook page. One row per requirement.",
        forms: {
          application_form: {
            mandatory: ["business_name", "owner_name", "address", "tin", "contact", "signature"],
            ifMarried: ["spouse_name", "spouse_signature"]
          }
        },
        requirements: [
          { id: "application_form", title: "Signed loan application form", docType: "application_form", when: {}, source: "illustrative" },
          { id: "gov_id", title: "Valid government-issued ID (front and back)", docType: "gov_id", when: {}, source: "illustrative" },
          { id: "registration_dti", title: "DTI business registration", docType: "registration", when: { type: ["Sole proprietorship"] }, source: "illustrative" },
          { id: "registration_sec", title: "SEC registration and corporate documents", docType: "registration", when: { type: ["Corporation"] }, source: "illustrative" },
          { id: "registration_sec_partner", title: "SEC partnership registration", docType: "registration", when: { type: ["Partnership"] }, source: "illustrative" },
          { id: "business_permit", title: "Latest business permit", docType: "business_permit", when: {}, source: "illustrative" },
          { id: "financials", title: "Financial statements and income tax return", docType: "financials", when: {}, source: "illustrative" },
          { id: "bank_statements", title: "Bank statements (latest 6 months)", docType: "bank_statements", when: {}, source: "illustrative" },
          { id: "sanitary_permit", title: "Sanitary or health permit", docType: "sanitary_permit", when: { industry: ["Food & beverage"] }, source: "illustrative conditional example" },
          { id: "audited_fs", title: "Audited financial statements", docType: "audited_fs", when: { minAmount: 5e6 }, source: "illustrative conditional example" }
        ]
      };
    }
  });

  // rules.cjs
  var require_rules2 = __commonJS({
    "rules.cjs"(exports, module) {
      "use strict";
      var table = require_rules();
      function applies(when, r) {
        if (when.type && !when.type.includes(r.type)) return false;
        if (when.industry && !when.industry.includes(r.industry)) return false;
        if (when.minAmount != null && !(Number(r.amount) >= when.minAmount)) return false;
        if (when.maxAmount != null && !(Number(r.amount) <= when.maxAmount)) return false;
        return true;
      }
      function checklist(r, rules = table) {
        return rules.requirements.filter((row) => applies(row.when, r));
      }
      module.exports = { checklist, table };
    }
  });

  // names.cjs
  var require_names = __commonJS({
    "names.cjs"(exports, module) {
      "use strict";
      var TITLES = /* @__PURE__ */ new Set(["mr", "mrs", "ms", "maria", "ma", "jr", "sr", "ii", "iii", "dr", "engr", "atty"]);
      var fold = (w) => w.replace(/0/g, "o").replace(/5/g, "s").replace(/[1i]/g, "l").replace(/rn/g, "m");
      function tokens(s) {
        let t = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        if (t.includes(",")) {
          const [last, rest] = t.split(/,(.*)/s);
          t = `${rest} ${last}`;
        }
        return t.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
      }
      function lev1(a, b) {
        if (a === b) return true;
        if (Math.abs(a.length - b.length) > 1) return false;
        let i = 0, j = 0, edits = 0;
        while (i < a.length && j < b.length) {
          if (a[i] === b[j]) {
            i++;
            j++;
            continue;
          }
          if (++edits > 1) return false;
          if (a.length > b.length) i++;
          else if (b.length > a.length) j++;
          else {
            i++;
            j++;
          }
        }
        return edits + (a.length - i) + (b.length - j) <= 1;
      }
      function tokenMatch(a, b) {
        if (a === b || fold(a) === fold(b)) return true;
        if ((a.length === 1 || b.length === 1) && a[0] === b[0]) return true;
        return Math.min(a.length, b.length) >= 5 && lev1(a, b);
      }
      function nameSimilarity(a, b) {
        const clean = (x) => {
          const t = tokens(x);
          const k = t.filter((w) => !TITLES.has(w));
          return k.length ? k : t;
        };
        let A = clean(a), B = clean(b);
        if (!A.length || !B.length) return 0;
        if (A.length > B.length) [A, B] = [B, A];
        const used = /* @__PURE__ */ new Set();
        let hit = 0;
        for (const x of A) {
          const j = B.findIndex((y, i) => !used.has(i) && tokenMatch(x, y));
          if (j >= 0) {
            used.add(j);
            hit++;
          }
        }
        if (hit < A.length) {
          const ja = A.join(""), jb = B.join("");
          if (ja.length >= 8 && (fold(ja) === fold(jb) || lev1(fold(ja), fold(jb)))) return 1;
        }
        return hit / A.length;
      }
      function strictSimilarity(a, b) {
        const clean = (x) => {
          const t = tokens(x);
          const k = t.filter((w) => !TITLES.has(w));
          return k.length ? k : t;
        };
        let A = clean(a), B = clean(b);
        if (!A.length || !B.length) return 0;
        if (A.length > B.length) [A, B] = [B, A];
        const used = /* @__PURE__ */ new Set();
        let hit = 0;
        for (const x of A) {
          const j = B.findIndex((y, i) => !used.has(i) && (x === y || (x.length === 1 || y.length === 1) && x[0] === y[0]));
          if (j >= 0) {
            used.add(j);
            hit++;
          }
        }
        return hit / A.length;
      }
      module.exports = { nameSimilarity, strictSimilarity, tokens };
    }
  });

  // checker.cjs
  var require_checker = __commonJS({
    "checker.cjs"(exports, module) {
      "use strict";
      var { checklist, table } = require_rules2();
      var { nameSimilarity, strictSimilarity } = require_names();
      var NAME_MATCH_MIN = 0.7;
      var HIGH_CONF = 0.9;
      var conf = (p, k) => (p.conf || {})[k] ?? 1;
      function compareNames(a, ka, b, kb) {
        const va = a.fields[ka], vb = b.fields[kb];
        if (Math.min(conf(a, ka), conf(b, kb)) >= HIGH_CONF) return strictSimilarity(va, vb) === 1 ? "match" : "mismatch";
        return nameSimilarity(va, vb) >= NAME_MATCH_MIN ? "match" : "review";
      }
      var blank = (v) => v == null || String(v).trim() === "";
      function check(referral, packet, { today = /* @__PURE__ */ new Date(), rules = table } = {}) {
        const required = checklist(referral, rules);
        const pages = packet.pages || [];
        const byType = (t) => pages.filter((p) => p.docType === t);
        const defects = [];
        const needsReview = [];
        const add = (code, target, message, docType) => defects.push({ key: `${code}:${target}`, code, message, docType });
        for (const row of required) {
          const found = byType(row.docType);
          if (!found.length) {
            add("MISSING_DOC", row.id, `${row.title} is missing.`, row.docType);
            continue;
          }
          const total = Math.max(...found.map((p) => p.pageTotal || 1));
          const have = new Set(found.map((p) => p.pageNo || 1));
          for (let n = 1; n <= total; n++) {
            if (!have.has(n)) add("MISSING_PAGE", `${row.id}#${n}`, `${row.title}: page ${n} of ${total} is missing.`, row.docType);
          }
          if (row.docType === "gov_id") {
            const sides = new Set(found.map((p) => p.side || "front"));
            for (const s of ["front", "back"]) if (!sides.has(s)) add("ID_SIDE_MISSING", s, `Government ID ${s} is missing.`, "gov_id");
          }
        }
        const form = byType("application_form").flatMap((p) => Object.entries(p.fields || {}));
        if (byType("application_form").length) {
          const f = Object.fromEntries(form);
          const must = [...rules.forms.application_form.mandatory];
          if (String(referral.civilStatus || f.civil_status || "").toLowerCase() === "married") must.push(...rules.forms.application_form.ifMarried);
          for (const k of must) if (blank(f[k])) add("BLANK_FIELD", k, `Application form: "${k.replace(/_/g, " ")}" is blank.`, "application_form");
        }
        const nameOf = (p) => (p.fields || {}).owner_name || (p.fields || {}).name;
        const ownerSrc = pages.filter((p) => ["application_form", "gov_id", "registration"].includes(p.docType) && !blank(nameOf(p)));
        for (let i = 0; i < ownerSrc.length; i++) for (let j = i + 1; j < ownerSrc.length; j++) {
          const [a, b] = [ownerSrc[i], ownerSrc[j]];
          if (a.docType === b.docType) continue;
          const ka = a.fields.owner_name != null ? "owner_name" : "name", kb = b.fields.owner_name != null ? "owner_name" : "name";
          const res = compareNames(a, ka, b, kb), pair = [a.docType, b.docType].sort().join("~");
          const where = `${a.docType.replace(/_/g, " ")} and ${b.docType.replace(/_/g, " ")}`;
          if (res === "mismatch") add("NAME_MISMATCH", pair, `Owner name differs between ${where}.`);
          else if (res === "review") needsReview.push({ key: `NAME_REVIEW:${pair}`, message: `Owner name between ${where} could not be read clearly. Please confirm.` });
        }
        const bizSrc = pages.filter((p) => ["application_form", "registration", "business_permit"].includes(p.docType) && !blank((p.fields || {}).business_name));
        for (let i = 0; i < bizSrc.length; i++) for (let j = i + 1; j < bizSrc.length; j++) {
          const [a, b] = [bizSrc[i], bizSrc[j]];
          if (a.docType === b.docType) continue;
          const res = compareNames(a, "business_name", b, "business_name"), pair = [a.docType, b.docType].sort().join("~");
          const where = `${a.docType.replace(/_/g, " ")} and ${b.docType.replace(/_/g, " ")}`;
          if (res === "mismatch") add("BUSINESS_NAME_MISMATCH", pair, `Business name differs between ${where}.`);
          else if (res === "review") needsReview.push({ key: `BUSINESS_REVIEW:${pair}`, message: `Business name between ${where} could not be read clearly. Please confirm.` });
        }
        for (const p of pages) {
          if (p.expiry && new Date(p.expiry) < today) add("EXPIRED", p.docType, `${p.docType.replace(/_/g, " ")} expired on ${p.expiry}.`, p.docType);
        }
        return { checklist: required, present: [...new Set(pages.map((p) => p.docType))], defects, needsReview, complete: defects.length === 0 && needsReview.length === 0 };
      }
      module.exports = { check, NAME_MATCH_MIN, HIGH_CONF };
    }
  });

  // reconcile.cjs
  var require_reconcile = __commonJS({
    "reconcile.cjs"(exports, module) {
      "use strict";
      function reconcile(prev, next) {
        const nextKeys = new Set(next.map((d) => d.key));
        const prevKeys = new Set(prev.map((d) => d.key));
        return {
          resolved: prev.filter((d) => !nextKeys.has(d.key)),
          stillMissing: prev.filter((d) => nextKeys.has(d.key)),
          newIssues: next.filter((d) => !prevKeys.has(d.key)),
          // a resubmission can introduce new problems
          complete: next.length === 0
        };
      }
      function draftMessage(rec, { to = "branch" } = {}) {
        const lines = [...rec.stillMissing, ...rec.newIssues].map((d) => `- ${d.message}`);
        if (!lines.length) return "Complete na ang requirements. Thank you!";
        const head = rec.resolved.length ? `Natanggap namin. ${rec.resolved.length} ang na-resolve na. Kulang pa:` : "Kulang pa ang mga ito:";
        return [head, ...lines].join("\n");
      }
      var STATUS_BY_EVENT = {
        created: "Draft",
        check_failed: "Missing requirements",
        check_passed: "Draft",
        handed_off: "With BSO",
        bso_opened: "With BSO",
        submitted_for_credit: "For approval"
      };
      function deriveStatus(events) {
        let s = "Draft";
        for (const e of events) if (STATUS_BY_EVENT[e.type]) s = STATUS_BY_EVENT[e.type];
        return s;
      }
      module.exports = { reconcile, draftMessage, deriveStatus };
    }
  });

  // synth.cjs
  var require_synth = __commonJS({
    "synth.cjs"(exports, module) {
      "use strict";
      var { checklist } = require_rules2();
      function rng(seed) {
        let a = seed >>> 0;
        return () => {
          a = a + 1831565813 >>> 0;
          let t = a;
          t = Math.imul(t ^ t >>> 15, t | 1);
          t ^= t + Math.imul(t ^ t >>> 7, t | 61);
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }
      var pick = (r, xs) => xs[Math.floor(r() * xs.length)];
      var FIRST = ["Elena", "Marco", "David", "Sofia", "Jericho", "Mariel", "Paolo", "Carmela", "Rodel", "Annalyn"];
      var LAST = ["Santos", "Reyes", "Garcia", "Lim", "Dela Cruz", "Bautista", "Mendoza", "Villanueva", "Aquino", "Ramos"];
      var SIMILAR_LAST = { Reyes: "Reyna", Santos: "Santoz", Garcia: "Gracia", Ramos: "Ramon", Aquino: "Aquinas" };
      var OCR = [[/rn/g, "m"], [/m/g, "rn"], [/o/gi, "0"], [/l/g, "1"], [/i/g, "l"], [/e/g, "c"]];
      function ocrNoise(r, s, p) {
        if (r() > p) return s;
        noised = true;
        const k = r();
        if (k < 0.4) {
          const [re, to] = pick(r, OCR);
          return s.replace(re, to);
        }
        if (k < 0.6) {
          const i = Math.floor(r() * s.length);
          return s.slice(0, i) + s.slice(i + 1);
        }
        if (k < 0.8) return s.toUpperCase();
        return s.replace(/ /g, "");
      }
      var noised = false;
      var SILENT = 0.2;
      function confFor(r, wasNoised) {
        return wasNoised && r() > SILENT ? 0.5 + r() * 0.35 : 0.93 + r() * 0.06;
      }
      function person(r) {
        return { first: pick(r, FIRST), last: pick(r, LAST) };
      }
      var asWritten = (r, p, style) => style === "lastfirst" ? `${p.last}, ${p.first}` : style === "initial" ? `${p.first} ${pick(r, "ABCDEFG")}. ${p.last}` : `${p.first} ${p.last}`;
      var DEFECTS = ["MISSING_DOC", "MISSING_PAGE", "BLANK_FIELD", "ID_SIDE_MISSING", "NAME_MISMATCH", "BUSINESS_NAME_MISMATCH", "EXPIRED"];
      function packet(seed, referral, inject = [], noise = 0.25, today = /* @__PURE__ */ new Date("2026-11-04")) {
        const r = rng(seed);
        const p = person(r);
        const style = pick(r, ["plain", "lastfirst", "initial"]);
        const req = checklist(referral);
        const nzc = (s) => {
          noised = false;
          const v = ocrNoise(r, s, noise);
          return [v, confFor(r, noised)];
        };
        const biz = referral.business;
        const pages = [];
        for (const row of req) {
          const base = { docType: row.docType, fields: {} };
          if (row.docType === "application_form") {
            const [bn, bc] = nzc(biz), [on, oc] = nzc(asWritten(r, p, style));
            pages.push(...[1, 2, 3].map((n) => ({ ...base, pageNo: n, pageTotal: 3, conf: n === 1 ? { business_name: bc, owner_name: oc } : {}, fields: n === 1 ? { business_name: bn, owner_name: on, address: "24 Market St", tin: "123-456-789", contact: "09170000000", signature: "signed", civil_status: "single" } : {} })));
          } else if (row.docType === "gov_id") {
            const [on, oc] = nzc(asWritten(r, p, "plain"));
            pages.push({ ...base, side: "front", conf: { owner_name: oc }, fields: { owner_name: on } }, { ...base, side: "back" });
          } else if (row.docType === "registration") {
            const [on, oc] = nzc(asWritten(r, p, "lastfirst")), [bn, bc] = nzc(biz);
            pages.push({ ...base, conf: { owner_name: oc, business_name: bc }, fields: { owner_name: on, business_name: bn } });
          } else if (row.docType === "business_permit") {
            const [bn, bc] = nzc(biz);
            pages.push({ ...base, conf: { business_name: bc }, fields: { business_name: bn }, expiry: "2027-03-31" });
          } else pages.push(base);
        }
        const truth = /* @__PURE__ */ new Set();
        for (const d of inject) {
          if (d === "MISSING_DOC") {
            const i = pages.findIndex((x) => x.docType === "financials");
            pages.splice(i, 1);
            truth.add("MISSING_DOC");
          }
          if (d === "MISSING_PAGE") {
            const i = pages.findIndex((x) => x.docType === "application_form" && x.pageNo === 2);
            pages.splice(i, 1);
            truth.add("MISSING_PAGE");
          }
          if (d === "BLANK_FIELD") {
            pages.find((x) => x.docType === "application_form" && x.pageNo === 1).fields.tin = "";
            truth.add("BLANK_FIELD");
          }
          if (d === "ID_SIDE_MISSING") {
            const i = pages.findIndex((x) => x.docType === "gov_id" && x.side === "back");
            pages.splice(i, 1);
            truth.add("ID_SIDE_MISSING");
          }
          if (d === "NAME_MISMATCH") {
            const id = pages.find((x) => x.docType === "gov_id" && x.side === "front");
            id.conf = { owner_name: 0.97 };
            id.fields.owner_name = r() < 0.5 && SIMILAR_LAST[p.last] ? `${p.first} ${SIMILAR_LAST[p.last]}` : asWritten(r, { first: pick(r, FIRST.filter((f) => f !== p.first)), last: pick(r, LAST.filter((l) => l !== p.last)) }, "plain");
            truth.add("NAME_MISMATCH");
          }
          if (d === "BUSINESS_NAME_MISMATCH") {
            const bp = pages.find((x) => x.docType === "business_permit");
            bp.conf = { business_name: 0.97 };
            bp.fields.business_name = `${pick(r, ["Golden", "Sunrise", "Metro", "Prime"])} ${pick(r, ["Traders", "Foods", "Hardware", "Prints"])}`;
            truth.add("BUSINESS_NAME_MISMATCH");
          }
          if (d === "EXPIRED") {
            pages.find((x) => x.docType === "business_permit").expiry = "2026-06-30";
            truth.add("EXPIRED");
          }
        }
        return { packet: { pages }, truth, today };
      }
      module.exports = { packet, DEFECTS, rng };
    }
  });

  // browser.cjs
  var require_browser = __commonJS({
    "browser.cjs"(exports, module) {
      module.exports = {
        check: require_checker().check,
        checklist: require_rules2().checklist,
        reconcile: require_reconcile().reconcile,
        draftMessage: require_reconcile().draftMessage,
        deriveStatus: require_reconcile().deriveStatus,
        packet: require_synth().packet
      };
    }
  });
  return require_browser();
})();
