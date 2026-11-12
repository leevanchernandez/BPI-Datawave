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
        _note: "Corporation and sole proprietorship rows are BPI Business Banking's basic requirements as sent by the team's BU Captain (a BSO) on 2026-11-06: what the BSO expects complete from the branch at referral, before KYC. Partnership rows are still seeded from BPI's public Ka-Negosyo page. In a pilot, BPI SME Lending owns and versions this table. Signatures are confirmed by the branch, not read by OCR.",
        version: "2026-11-06-bso-checklist",
        sources: {
          J1: { title: "BPI Business Banking basic requirements, from the BU Captain (BSO), 6 Nov 2026", url: "" },
          B1: { title: "BPI Ka-Negosyo SME Term Loan, public page (undated, footer 2023)", url: "https://www.bpi.com.ph/sme-banking/loans/sme-term-loan" }
        },
        forms: {
          application_form: {
            mandatory: ["business_name", "owner_name", "address", "tin", "contact"],
            ifMarried: ["spouse_name"]
          }
        },
        requirements: [
          { id: "application_form", title: "Duly accomplished application form", docTypes: ["application_form"], when: { type: ["Corporation", "Partnership"] }, source: "J1" },
          { id: "application_form_sole", title: "Duly accomplished application form (spouse signs pages 3 and 6 if married)", docTypes: ["application_form"], when: { type: ["Sole proprietorship"] }, source: "J1" },
          { id: "gov_id", title: "Valid ID", docTypes: ["gov_id"], when: { type: ["Sole proprietorship"] }, source: "J1" },
          { id: "spouse_id", title: "Spouse valid ID", docTypes: ["spouse_id"], when: { type: ["Sole proprietorship"], civilStatus: ["married"] }, reason: "married", source: "J1" },
          { id: "gov_id_corp", title: "Valid IDs of all stockholders, officers and directors", docTypes: ["gov_id"], when: { type: ["Corporation"] }, source: "J1" },
          { id: "gov_id_partners", title: "Valid IDs of the partners and signatories", docTypes: ["gov_id"], when: { type: ["Partnership"] }, source: "B1" },
          { id: "dti", title: "DTI registration", docTypes: ["registration"], when: { type: ["Sole proprietorship"] }, source: "J1" },
          { id: "bir_cor", title: "BIR Certificate of Registration (COR)", docTypes: ["bir_cor"], when: { type: ["Sole proprietorship"] }, source: "J1" },
          { id: "mayors_permit", title: "Mayor's permit", docTypes: ["business_permit"], when: { type: ["Sole proprietorship"] }, source: "J1" },
          { id: "articles", title: "Articles of Incorporation, with amendments if any", docTypes: ["articles"], when: { type: ["Corporation"] }, source: "J1" },
          { id: "gis", title: "Latest GIS with SEC cover letter and eFAST final acceptance", docTypes: ["gis"], when: { type: ["Corporation"] }, source: "J1" },
          { id: "registration_sec", title: "SEC registration", docTypes: ["registration"], when: { type: ["Partnership"] }, source: "B1" },
          { id: "articles_partnership", title: "Articles of partnership", docTypes: ["articles"], when: { type: ["Partnership"] }, source: "B1" },
          { id: "gis_partnership", title: "Latest General Information Sheet", docTypes: ["gis"], when: { type: ["Partnership"] }, source: "B1" },
          { id: "itr", title: "ITR for 2023, 2024 and 2025, with BIR stamp or BIR online reference number", docTypes: ["itr"], when: { minAmount: 3000001 }, reason: "loan exposure over PHP 3M", source: "J1" },
          { id: "afs", title: "AFS for 2023, 2024 and 2025, with BIR stamp or BIR online reference number", docTypes: ["audited_fs"], when: { minAmount: 3000001 }, reason: "loan exposure over PHP 3M", source: "J1" },
          { id: "bank_statements", title: "Latest 3 months bank statements", docTypes: ["bank_statements"], when: {}, source: "J1" },
          { id: "endorsement_letter", title: "Endorsement letter for bank verification", docTypes: ["endorsement_letter"], when: { bpiAccount: false }, reason: "working account is not with BPI", source: "J1" },
          { id: "cal", title: "DocuSign Client Authorization Letter (CAL), wet or e-signed by the authorized signatories", docTypes: ["cal"], when: { type: ["Corporation", "Partnership"] }, source: "J1" },
          { id: "cal_sole", title: "DocuSign Client Authorization Letter (CAL), wet or e-signed on all pages (by both spouses if married)", docTypes: ["cal"], when: { type: ["Sole proprietorship"] }, source: "J1" },
          { id: "pcab_license", title: "PCAB license", docTypes: ["pcab_license"], when: { type: ["Corporation"], industry: ["Construction"] }, reason: "construction", source: "J1" },
          { id: "project_list", title: "List of ongoing projects", docTypes: ["project_list"], when: { type: ["Corporation"], industry: ["Construction"] }, reason: "construction", source: "J1" },
          { id: "project_contracts", title: "Contracts or notices of award for ongoing and upcoming projects", docTypes: ["contract"], when: { type: ["Corporation"], industry: ["Construction"] }, reason: "construction", source: "J1" },
          { id: "title", title: "TCT or CCT", docTypes: ["collateral"], when: { secured: true }, reason: "property collateral", source: "J1" },
          { id: "tax_declaration", title: "Tax declaration", docTypes: ["tax_declaration"], when: { secured: true }, reason: "property collateral", source: "J1" },
          { id: "tax_clearance", title: "Real property tax clearance", docTypes: ["tax_clearance"], when: { secured: true }, reason: "property collateral", source: "J1" },
          { id: "tax_receipt", title: "Real property tax receipt", docTypes: ["tax_receipt"], when: { secured: true }, reason: "property collateral", source: "J1" },
          { id: "appraisal_letter", title: "Letter of appraisal", docTypes: ["appraisal_letter"], when: { secured: true }, reason: "property collateral", source: "J1" },
          { id: "collateral_authorization", title: "Authorization letter for the collateral", docTypes: ["authorization_letter"], when: { secured: true }, reason: "property collateral", source: "J1" }
        ]
      };
    }
  });

  // rules.cjs
  var require_rules2 = __commonJS({
    "rules.cjs"(exports, module) {
      "use strict";
      var table = require_rules();
      var CIVIL_WORDS = {
        single: "single",
        "walang asawa": "single",
        binata: "single",
        dalaga: "single",
        married: "married",
        kasal: "married",
        "may asawa": "married",
        widowed: "widowed",
        widow: "widowed",
        widower: "widowed",
        balo: "widowed",
        biyuda: "widowed",
        biyudo: "widowed",
        separated: "separated",
        hiwalay: "separated",
        divorced: "separated",
        annulled: "separated"
      };
      var civilOf = (v) => CIVIL_WORDS[String(v || "").trim().toLowerCase().replace(/\s+/g, " ")] || null;
      function applies(when, r) {
        if (when.type && !when.type.includes(r.type)) return false;
        if (when.industry && !when.industry.includes(r.industry)) return false;
        if (when.minAmount != null && !(Number(r.amount) >= when.minAmount)) return false;
        if (when.maxAmount != null && !(Number(r.amount) <= when.maxAmount)) return false;
        if (when.civilStatus && !when.civilStatus.includes(civilOf(r.civilStatus))) return false;
        if (when.secured != null && Boolean(r.secured) !== when.secured) return false;
        if (when.bpiAccount != null && r.bpiAccount === true !== when.bpiAccount) return false;
        return true;
      }
      function checklist(r, rules = table) {
        return rules.requirements.filter((row) => applies(row.when, r)).map((row) => {
          const docTypes = row.docTypes || [row.docType];
          const src = (rules.sources || {})[row.source] || { title: row.source, url: "" };
          return { ...row, docTypes, docType: docTypes[0], sourceTitle: src.title, sourceUrl: src.url };
        });
      }
      function requirementsFor(i = {}) {
        if (!["Sole proprietorship", "Partnership", "Corporation"].includes(i.type)) return { error: "Ask which business structure: sole proprietorship, partnership or corporation." };
        const p = { type: i.type, industry: String(i.industry || ""), amount: Number(i.amount) || 0, civilStatus: i.married ? "married" : "single", secured: i.secured === true, bpiAccount: i.bpiAccount !== false };
        return { requirements: checklist(p).map((r) => ({ requirement: r.title, source: r.sourceTitle })), assumed: `${p.civilStatus}, ${p.secured ? "secured" : "no collateral"}, ${p.bpiAccount ? "BPI working account" : "no BPI account"}${p.amount ? "" : ", amount not given so rows for larger loans are left out"}` };
      }
      module.exports = { checklist, table, civilOf, requirementsFor };
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
      var { checklist, table, civilOf } = require_rules2();
      var { nameCompare } = require_names();
      var HIGH_CONF = 0.9;
      var MAX_PAGES = 50;
      var PLACEHOLDER = /^(n\/?a|none|nil|null|-+|_+|x+|\.+|0+)$/i;
      var blank = (v) => v == null || String(v).trim() === "" || PLACEHOLDER.test(String(v).trim());
      var TIN = /^\d{3}[- ]?\d{3}[- ]?\d{3}([- ]?\d{3,5})?$/;
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
          const found = pages.filter((p) => row.docTypes.includes(p.docType));
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
          const formCivil = civilOf(f.civil_status), intakeCivil = civilOf(referral.civilStatus);
          const formConf = Math.max(0, ...forms.map((p) => (p.fields || {}).civil_status === f.civil_status ? conf(p, "civil_status") : 0));
          const married = formCivil === "married" || intakeCivil === "married";
          const must = [...rules.forms.application_form.mandatory];
          if (married) must.push(...rules.forms.application_form.ifMarried);
          const unread = new Set(forms.flatMap((p) => p.unread || []));
          const empty = (k) => unread.has(k) ? review("FIELD_UNREADABLE", `application_form:${k}`, `Application form: "${k.replace(/_/g, " ")}" has marks that could not be read. Please check the paper.`) : add("BLANK_FIELD", k, `Application form: "${k.replace(/_/g, " ")}" is blank.`, "application_form");
          for (const k of must) if (blank(f[k])) empty(k);
          if (blank(f.civil_status)) empty("civil_status");
          else if (!formCivil || formConf < HIGH_CONF) review("CIVIL_UNREADABLE", "civil_status", "Civil status on the form could not be read with confidence. Please check the paper.");
          else if (intakeCivil && formCivil !== intakeCivil) review("CIVIL_DIFFERS", "civil_status", `Civil status on the form (${formCivil}) differs from the case (${intakeCivil}). Please check it.`);
          if (!blank(f.tin) && !TIN.test(String(f.tin).trim())) review("TIN_FORMAT", "tin", "The TIN does not look like a TIN. Please check it.");
        }
        const collect = (types, field) => {
          const out = [];
          for (const p of pages) {
            if (!types.includes(p.docType)) continue;
            if (p.docType === "gov_id" && p.side === "back" || ["application_form", "registration", "business_permit"].includes(p.docType) && Number(p.pageNo) > 1) continue;
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
        const spouseOnForm = forms.map((p) => (p.fields || {}).spouse_name).find((v) => !blank(v));
        for (const p of byType("spouse_id")) {
          const v = (p.fields || {}).owner_name;
          if (blank(v) || blank(spouseOnForm)) {
            review("SPOUSE_REVIEW", "spouse_id", "Spouse ID name could not be matched to the form. Please check it.");
            continue;
          }
          const res = compareNames(spouseOnForm, conf(forms[0], "spouse_name") || 1, v, conf(p, "owner_name"));
          if (res === "mismatch") add("SPOUSE_MISMATCH", "spouse_id", "Spouse ID name does not match the spouse on the form.", "spouse_id");
          else if (res === "review") review("SPOUSE_REVIEW", "spouse_id", "Spouse ID name could not be confirmed against the form. Please check it.");
        }
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
        returned: "Returned by BSO",
        // back at the branch: the next passing check makes it ready for BSO review again
        endorsed: "Endorsed to Credit"
        // the BSO sends it on; Credit decides the loan
      };
      var RANK = { Draft: 0, "Missing requirements": 0, "Returned by BSO": 0, "With BSO": 1, "Endorsed to Credit": 2 };
      function deriveStatus(events) {
        let s = "Draft";
        for (const e of events) {
          if (s === "Endorsed to Credit") break;
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
            pages.push(...[1, 2, 3].map((n) => ({ ...base, pageNo: n, pageTotal: 3, conf: n === 1 ? { business_name: bc, owner_name: oc, civil_status: 0.97 } : {}, fields: n === 1 ? { business_name: bn, owner_name: on, address: "24 Market St", tin: "123-456-789", contact: "09170000000", signature: "signed", civil_status: "single" } : {} })));
          } else if (row.docType === "gov_id") {
            const [on, oc] = nzc(asWritten(r, p, "plain"));
            pages.push({ ...base, side: "front", conf: { owner_name: oc }, fields: { owner_name: on }, expiry: "2030-01-31" }, { ...base, side: "back" });
          } else if (row.docType === "registration") {
            const [on, oc] = nzc(asWritten(r, p, "lastfirst")), [bn, bc] = nzc(biz);
            pages.push({ ...base, conf: { owner_name: oc, business_name: bc }, fields: { owner_name: on, business_name: bn } });
          } else if (row.docType === "business_permit") {
            const [bn, bc] = nzc(biz);
            pages.push({ ...base, conf: { business_name: bc }, fields: { business_name: bn }, expiry: "2027-03-31" });
          } else if (row.docType === "spouse_id") {
            pages.push({ ...base, fields: { owner_name: "Ramon Bautista" }, conf: { owner_name: 0.97 } });
          } else if (row.docType === "sanitary_permit") {
            pages.push({ ...base, expiry: "2027-06-30" });
          } else pages.push(base);
        }
        if (req.some((x) => x.docType === "spouse_id")) {
          const f = pages.find((x) => x.docType === "application_form" && x.pageNo === 1);
          if (f) {
            f.fields.civil_status = "married";
            f.fields.spouse_name = "Ramon Bautista";
            f.conf.spouse_name = 0.97;
          }
        }
        if (!pages.some((x) => x.docType === "business_permit")) {
          const [bn, bc] = nzc(biz);
          pages.push({ docType: "business_permit", conf: { business_name: bc }, fields: { business_name: bn }, expiry: "2027-03-31" });
        }
        const truth = /* @__PURE__ */ new Set();
        for (const d of inject) {
          if (d === "MISSING_DOC") {
            const i = pages.findIndex((x) => x.docType === "bank_statements");
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
