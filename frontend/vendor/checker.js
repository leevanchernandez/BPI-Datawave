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
      var HONORIFICS = /* @__PURE__ */ new Set(["mr", "mrs", "ms", "dr", "engr", "atty", "sir"]);
      function tokens(s) {
        let t = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        if (t.includes(",")) {
          const [last, rest] = t.split(/,(.*)/s);
          t = `${rest} ${last}`;
        }
        return t.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !HONORIFICS.has(w));
      }
      var sorted = (xs) => [...xs].sort();
      var same = (a, b) => a.length === b.length && sorted(a).every((w, i) => w === sorted(b)[i]);
      var subsetOf = (a, b) => a.length > 0 && a.every((w) => b.includes(w));
      function nameCompare(a, b) {
        const A = tokens(a), B = tokens(b);
        const wa = A.filter((w) => w.length > 1), wb = B.filter((w) => w.length > 1);
        if (!wa.length || !wb.length) return "different";
        if (same(wa, wb)) return wa.length >= 2 ? "equal" : "subset";
        if (subsetOf(wa, wb) || subsetOf(wb, wa)) return "subset";
        const ia = A.filter((w) => w.length === 1), ib = B.filter((w) => w.length === 1);
        const expands = (ini, words) => ini.some((i) => words.some((w) => w[0] === i));
        if (expands(ia, wb) && subsetOf(wa, wb) || expands(ib, wa) && subsetOf(wb, wa)) return "subset";
        return "different";
      }
      module.exports = { nameCompare, tokens };
    }
  });

  // checker.cjs
  var require_checker = __commonJS({
    "checker.cjs"(exports, module) {
      "use strict";
      var { checklist, table } = require_rules2();
      var { nameCompare } = require_names();
      var HIGH_CONF = 0.9;
      var MAX_PAGES = 50;
      var PLACEHOLDER = /^(n\/?a|none|nil|null|-+|_+|x+|\.+|0+)$/i;
      var blank = (v) => v == null || String(v).trim() === "" || PLACEHOLDER.test(String(v).trim());
      var TIN = /^\d{3}[- ]?\d{3}[- ]?\d{3}([- ]?\d{3,5})?$/;
      var CIVIL = /* @__PURE__ */ new Set(["single", "married", "widowed", "separated", "divorced", "annulled"]);
      var conf = (p, k) => {
        const c = (p.conf || {})[k];
        return typeof c === "number" && Number.isFinite(c) ? c : 0;
      };
      var manilaDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
      function validDate(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
        if (!m) return false;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
      }
      function compareNames(va, ca, vb, cb) {
        const r = nameCompare(va, vb);
        if (r === "equal") return "match";
        if (Math.min(ca, cb) < HIGH_CONF || r === "subset") return "review";
        return "mismatch";
      }
      function check(referral, packet, { today = /* @__PURE__ */ new Date(), rules = table } = {}) {
        const required = checklist(referral, rules);
        const pages = packet.pages || [];
        const byType = (t) => pages.filter((p) => p.docType === t);
        const defects = [], needsReview = [];
        const add = (code, target, message, docType) => {
          const d = { key: `${code}:${target}`, code, message };
          if (docType) d.docType = docType;
          defects.push(d);
        };
        const review = (code, target, message) => needsReview.push({ key: `${code}:${target}`, message });
        const todayStr = manilaDay(today);
        for (const row of required) {
          const found = byType(row.docType);
          if (!found.length) {
            add("MISSING_DOC", row.id, `${row.title} is missing.`, row.docType);
            continue;
          }
          let total = 1;
          for (const p of found) {
            const t = Number(p.pageTotal), n = Number(p.pageNo);
            if (p.pageTotal == null && p.pageNo == null) continue;
            if (Number.isInteger(t) && t >= 1 && t <= MAX_PAGES && Number.isInteger(n) && n >= 1 && n <= t) total = Math.max(total, t);
            else review("PAGE_NUMBER_INVALID", row.docType, `${row.title}: a page number could not be read. Please check the page order.`);
          }
          const have = new Set(found.map((p) => Number(p.pageNo) || 1));
          for (let n = 1; n <= total; n++) if (!have.has(n)) add("MISSING_PAGE", `${row.id}#${n}`, `${row.title}: page ${n} of ${total} is missing.`, row.docType);
          if (row.docType === "gov_id") {
            const sides = new Set(found.map((p) => p.side || "front"));
            for (const s of ["front", "back"]) if (!sides.has(s)) add("ID_SIDE_MISSING", s, `Government ID ${s} is missing.`, "gov_id");
          }
        }
        const forms = byType("application_form");
        if (forms.length) {
          const f = {};
          for (const p of forms) for (const [k, v] of Object.entries(p.fields || {})) {
            if (!(k in f) || blank(f[k]) && !blank(v)) f[k] = v;
          }
          const civil = [referral.civilStatus, f.civil_status].map((x) => String(x || "").trim().toLowerCase());
          const married = civil.includes("married");
          const must = [...rules.forms.application_form.mandatory];
          if (married) must.push(...rules.forms.application_form.ifMarried);
          for (const k of must) if (blank(f[k])) add("BLANK_FIELD", k, `Application form: "${k.replace(/_/g, " ")}" is blank.`, "application_form");
          if (blank(f.civil_status)) add("BLANK_FIELD", "civil_status", 'Application form: "civil status" is blank.', "application_form");
          else if (!CIVIL.has(String(f.civil_status).trim().toLowerCase())) review("CIVIL_UNREADABLE", "civil_status", "Civil status on the form could not be read. Please check it.");
          if (!blank(f.tin) && !TIN.test(String(f.tin).trim())) review("TIN_FORMAT", "tin", "The TIN does not look like a TIN. Please check it.");
        }
        const collect = (types, field) => {
          const out = [];
          for (const p of pages) {
            if (!types.includes(p.docType)) continue;
            if (p.docType === "gov_id" && p.side === "back" || p.docType === "application_form" && Number(p.pageNo) > 1) continue;
            const v = (p.fields || {})[field];
            if (blank(v)) {
              if (p.docType !== "application_form") review("FIELD_UNREADABLE", `${p.docType}:${field}`, `${p.docType.replace(/_/g, " ")}: the ${field.replace(/_/g, " ")} could not be read. Please check it.`);
              continue;
            }
            out.push({ p, v, c: conf(p, field) });
          }
          return out;
        };
        const owners = collect(["application_form", "gov_id", "registration"], "owner_name");
        const bizs = collect(["application_form", "registration", "business_permit"], "business_name");
        const pairs = (list, code, reviewCode, label) => {
          for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const [a, b] = [list[i], list[j]];
            if (a.p.docType === b.p.docType) continue;
            const res = compareNames(a.v, a.c, b.v, b.c), pair = [a.p.docType, b.p.docType].sort().join("~");
            const where = `${a.p.docType.replace(/_/g, " ")} and ${b.p.docType.replace(/_/g, " ")}`;
            if (res === "mismatch") add(code, pair, `${label} differs between ${where}.`);
            else if (res === "review") review(reviewCode, pair, `${label} between ${where} could not be confirmed. Please check it.`);
          }
        };
        pairs(owners, "NAME_MISMATCH", "NAME_REVIEW", "Owner name");
        pairs(bizs, "BUSINESS_NAME_MISMATCH", "BUSINESS_REVIEW", "Business name");
        const against = (list, refValue, code, reviewCode, label) => {
          if (blank(refValue)) return;
          for (const x of list) {
            const res = compareNames(refValue, 1, x.v, x.c);
            if (res === "mismatch") add(code, x.p.docType, `${label} on the ${x.p.docType.replace(/_/g, " ")} does not match the referral.`);
            else if (res === "review") review(reviewCode, x.p.docType, `${label} on the ${x.p.docType.replace(/_/g, " ")} could not be matched to the referral. Please check it.`);
          }
        };
        against(owners, referral.name, "REFERRAL_MISMATCH_OWNER", "REFERRAL_REVIEW_OWNER", "Owner name");
        against(bizs, referral.business, "REFERRAL_MISMATCH_BUSINESS", "REFERRAL_REVIEW_BUSINESS", "Business name");
        for (const docType of ["gov_id", "business_permit", "sanitary_permit"]) {
          const found = byType(docType);
          if (!found.length) continue;
          const dated = found.map((p) => p.expiry).filter((e) => e != null && e !== "");
          if (!dated.length) {
            review("EXPIRY_UNREADABLE", docType, `${docType.replace(/_/g, " ")}: no validity date could be read. Please check it.`);
            continue;
          }
          for (const e of dated) {
            if (!validDate(e)) review("EXPIRY_UNREADABLE", docType, `${docType.replace(/_/g, " ")}: the validity date could not be read. Please check it.`);
            else if (e < todayStr) add("EXPIRED", docType, `${docType.replace(/_/g, " ")} expired on ${e}.`, docType);
          }
        }
        return { checklist: required, present: [...new Set(pages.map((p) => p.docType))], defects, needsReview, complete: defects.length === 0 && needsReview.length === 0 };
      }
      module.exports = { check, HIGH_CONF, validDate };
    }
  });

  // reconcile.cjs
  var require_reconcile = __commonJS({
    "reconcile.cjs"(exports, module) {
      "use strict";
      function reconcile(prev, next, nextReview = []) {
        const nextKeys = new Set(next.map((d) => d.key));
        const prevKeys = new Set(prev.map((d) => d.key));
        return {
          resolved: prev.filter((d) => !nextKeys.has(d.key)),
          stillMissing: prev.filter((d) => nextKeys.has(d.key)),
          newIssues: next.filter((d) => !prevKeys.has(d.key)),
          // a resubmission can introduce new problems
          complete: next.length === 0 && nextReview.length === 0
        };
      }
      function draftMessage(rec, { to = "branch" } = {}) {
        const lines = [...rec.stillMissing, ...rec.newIssues].map((d) => `- ${d.message}`);
        if (!lines.length) return "Walang nakitang problema ng checker. Titingnan pa rin ito ng BSO.";
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
      var RANK = { Draft: 0, "Missing requirements": 0, "With BSO": 1, "For approval": 2 };
      function deriveStatus(events) {
        let s = "Draft";
        for (const e of events) {
          const next = STATUS_BY_EVENT[e.type];
          if (!next) continue;
          if (RANK[s] >= 1 && e.type === "check_passed") continue;
          s = next;
        }
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
      function person(r, name) {
        if (name) {
          const t = name.trim().split(/\s+/);
          return { first: t.slice(0, -1).join(" "), last: t[t.length - 1] };
        }
        return { first: pick(r, FIRST), last: pick(r, LAST) };
      }
      var asWritten = (r, p, style) => style === "lastfirst" ? `${p.last}, ${p.first}` : style === "initial" ? `${p.first} ${pick(r, "ABCDEFG")}. ${p.last}` : `${p.first} ${p.last}`;
      var DEFECTS = ["MISSING_DOC", "MISSING_PAGE", "BLANK_FIELD", "ID_SIDE_MISSING", "NAME_MISMATCH", "BUSINESS_NAME_MISMATCH", "EXPIRED"];
      function packet(seed, referral, inject = [], noise = 0.25, today = /* @__PURE__ */ new Date("2026-11-04")) {
        const r = rng(seed);
        const p = person(r, referral.name);
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
            pages.push({ ...base, side: "front", conf: { owner_name: oc }, fields: { owner_name: on }, expiry: "2030-01-31" }, { ...base, side: "back" });
          } else if (row.docType === "registration") {
            const [on, oc] = nzc(asWritten(r, p, "lastfirst")), [bn, bc] = nzc(biz);
            pages.push({ ...base, conf: { owner_name: oc, business_name: bc }, fields: { owner_name: on, business_name: bn } });
          } else if (row.docType === "business_permit") {
            const [bn, bc] = nzc(biz);
            pages.push({ ...base, conf: { business_name: bc }, fields: { business_name: bn }, expiry: "2027-03-31" });
          } else if (row.docType === "sanitary_permit") {
            pages.push({ ...base, expiry: "2027-06-30" });
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
            id.conf = { owner_name: 0.5 + r() * 0.49 };
            id.fields.owner_name = r() < 0.5 && SIMILAR_LAST[p.last] ? `${p.first} ${SIMILAR_LAST[p.last]}` : asWritten(r, { first: pick(r, FIRST.filter((f) => f !== p.first)), last: pick(r, LAST.filter((l) => l !== p.last)) }, "plain");
            truth.add("NAME_MISMATCH");
          }
          if (d === "BUSINESS_NAME_MISMATCH") {
            const bp = pages.find((x) => x.docType === "business_permit");
            bp.conf = { business_name: 0.5 + r() * 0.49 };
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
