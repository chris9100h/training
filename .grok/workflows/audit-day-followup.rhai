let meta = #{
    name: "audit-day-followup",
    description: "Audit-day follow-up: full codebase review from angles NOT covered by today's investor audit and fixes",
    when_to_use: "After investor-audit day when you want NEW findings, different lenses, no rehash of already fixed issues",
    phases: [
        #{ title: "Context", detail: "one agent maps today's work and denylist" },
        #{ title: "Scan", detail: "parallel full-codebase reviewers, other angles only" },
        #{ title: "Verify", detail: "adversarial skeptics confirm top NEW claims" },
        #{ title: "Report", detail: "German engineering deep-audit report for docs/" },
    ],
};

let context_schema = #{
    "type": "object",
    "required": ["denylist_summary", "fixed_today", "still_open_investor", "angles_to_use"],
    "properties": #{
        "denylist_summary": #{ "type": "string" },
        "fixed_today": #{ "type": "array", "maxItems": 40, "items": #{ "type": "string" } },
        "still_open_investor": #{ "type": "array", "maxItems": 40, "items": #{ "type": "string" } },
        "angles_to_use": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["findings", "area_covered", "angle"],
    "properties": #{
        "area_covered": #{ "type": "string" },
        "angle": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["severity", "category", "file", "issue", "evidence", "why_new"],
                "properties": #{
                    "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low"] },
                    "category": #{
                        "type": "string",
                        "enum": ["bug", "data-integrity", "security", "sync-race", "ui", "ux", "incomplete", "perf", "a11y", "ci-docs", "edge", "logic"],
                    },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "why_new": #{ "type": "string" },
                    "suggestion": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "is_duplicate_of_today", "severity", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "is_duplicate_of_today": #{ "type": "boolean" },
        "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low", "none"] },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["title", "summary", "body_markdown", "critical_count", "high_count", "confirmed_count"],
    "properties": #{
        "title": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "body_markdown": #{ "type": "string" },
        "critical_count": #{ "type": "integer" },
        "high_count": #{ "type": "integer" },
        "confirmed_count": #{ "type": "integer" },
    },
};

// ── Phase 0: map what today already did ─────────────────────────────────
phase("Context");
log("Mapping today's investor audit + fix commits so scanners skip them");

let ctx_prompt = "";
ctx_prompt += "You map what was ALREADY audited and FIXED today on branch claude/investor-audit-review-ha7o6s ";
ctx_prompt += "for the Logbook/Zane training PWA. Read-only tools only. Never edit.\n\n";
ctx_prompt += "MANDATORY reads:\n";
ctx_prompt += "1. docs/investor-audit-2026-08.md (full findings list and severity).\n";
ctx_prompt += "2. git log --oneline -40 (or read recent commits) for 2026-08-09 fix commits.\n";
ctx_prompt += "3. Spot-check that Criticals were fixed: auto-close-sessions hasSets path, ";
ctx_prompt += "screens-train plus_load activateKb/dispWeight, app.jsx flushBeforeSignOut landed flag, ";
ctx_prompt += "finish seal user choice, mergeBootScalars, library Recent windowing, meds empty states, ";
ctx_prompt += "coach plan tab remap, recipe Plan-it planMode gate.\n\n";
ctx_prompt += "Output:\n";
ctx_prompt += "- fixed_today: short strings of issues that are FIXED in current code (do not re-audit as open bugs).\n";
ctx_prompt += "- still_open_investor: investor findings that remain OPEN (competitive gaps, rest timer sheet, meso sheets, ";
ctx_prompt += "food multi-tap, coach invite email-only, etc.). Scanners must NOT re-report these unless they find a ";
ctx_prompt += "NEW technical regression or a deeper root cause with different evidence.\n";
ctx_prompt += "- denylist_summary: one dense paragraph listing topics that are off-limits as rehashes.\n";
ctx_prompt += "- angles_to_use: the engineering angles that were NOT the investor product lens, e.g. security grants, ";
ctx_prompt += "edge cron auth, RLS, silent write paths, cleanup-week seed math, food unit conversion correctness, ";
ctx_prompt += "medication schedule correctness, backup coverage gaps, CI holes, a11y, SW/cache, shared-const collisions, ";
ctx_prompt += "quota fail-open, AI server-authored field races, history windowing remaining bugs, performance.\n";
ctx_prompt += "Never use em-dashes.\n";

let ctx_result = agent(ctx_prompt, #{
    label: "context:today",
    capability_mode: "read-only",
    agent_type: "explore",
    output_schema: context_schema,
});

let denylist = "Today fixed: plus_load keyboard double bodyweight, auto-close hard-delete with sets, sign-out wipe on flush timeout, finish silent seal (user choice), boot merge scalars, library Recent empty lie, meds empty surfaces, coach plan blank tab + premature Updated plan, recipe Plan-it without planMode. Investor open product gaps (do not rehash): HealthKit/PWA-only/Watch, food multi-tap re-log, rest timer full-screen at zero, meso multi-sheet mid-workout, coach invite email-only, steps manual, barcode iOS PWA, macro adherence philosophy, plan draft LWW, exercise picker empty until search.";
let fixed_blob = "";
let open_blob = "";
let angles_blob = "security grants RLS edge cron; sync residual races; cleanup week math; food units; meds scheduling; backup/CI; a11y; SW; incomplete stubs; AI timezone/quota; performance";

if ctx_result != () && ctx_result.success && ctx_result.output.denylist_summary != () {
    denylist = ctx_result.output.denylist_summary;
    if ctx_result.output.fixed_today != () {
        for x in ctx_result.output.fixed_today {
            fixed_blob += "- " + x + "\n";
        }
    }
    if ctx_result.output.still_open_investor != () {
        for x in ctx_result.output.still_open_investor {
            open_blob += "- " + x + "\n";
        }
    }
    if ctx_result.output.angles_to_use != () {
        angles_blob = "";
        for x in ctx_result.output.angles_to_use {
            angles_blob += x + "; ";
        }
    }
    log("Context agent ok; denylist length ready");
} else {
    log("Context agent failed; using baked-in denylist fallback");
}

// ── Domain list: full codebase, OTHER angles than investor product lens ─
let domains = [
    #{
        id: "security-grants",
        paths: "supabase/functions/, supabase/migrations/ (latest 30), supabase/schema.sql, docs/database.md (RLS/grants), src/store.js RPC callers",
        focus: "SECURITY DEFINER grants (anon/authenticated EXECUTE), cron CRON_SECRET fail-closed, edge resolveUser holes, service-role abuse, coaching RLS isolation, recipe share token exposure, admin email hardcoding as sole admin gate, quota fail-open abuse, secrets in client",
    },
    #{
        id: "sync-data-integrity",
        paths: "src/store.js, src/app.jsx, tools/test/store.test.cjs",
        focus: "Residual multi-device races AFTER mergeBootScalars fix, syncStore unwrap gaps, history windowing honesty left open, mergeSessions anti-resurrection edge cases, importFromBackup column gaps, settings four-place mapping, statusPeriods vs statusMode, food log windowing, set batch staleness",
    },
    #{
        id: "train-logic-residual",
        paths: "src/screens-train.jsx, src/store.js (buildSeedSets, bestE1rm, cleanup, meso, 531)",
        focus: "NOT the fixed plus_load open-confirm or finish seal choice. Look for OTHER weight paths (drop sets, myo, av, techniques), cleanup week seed compounding, opt-outs, is_cleanup auto-close stamp, PR baselines, progression after seal choice, offline session pointer races still open",
    },
    #{
        id: "schedule-cleanup",
        paths: "src/screens-schedule.jsx, docs/cleanup-week.md, migration 0251",
        focus: "Cleanup week UI vs store contracts, weekday activate co-writes, plan drafts, wizard invariants, deload vs cleanup interaction, status picker all five states, cycle/flex mode switches",
    },
    #{
        id: "food-units-plan",
        paths: "src/screens-food.jsx, src/ui.jsx mass helpers, settings foodForceGrams",
        focus: "g/oz conversion correctness, force-grams opt-out, plan mode default-on migration side effects, shopping prefs, recipe steps/scaling, cooking mode draft, label scan photo library, silent favorite no-op residual, planned vs logged totals",
    },
    #{
        id: "health-meds-cardio",
        paths: "src/screens-health.jsx, src/screens-medications.jsx, src/screens-water.jsx, src/screens-cardio.jsx, medication-reminder edge",
        focus: "AI summary date/timezone, meds slot interval_days correctness, pillbox inventory, reminder materialize vs cron, water mirror daily_logs, cardio empty create path residual, body measurements, fasting state",
    },
    #{
        id: "coaching-isolation",
        paths: "src/screens-coaching-*.jsx, store invite/coaching RPCs, realtime",
        focus: "NOT the fixed plan blank tab or premature Updated plan. Look for client data isolation bugs, coach write paths without error check, self-coaching/support_ edges, check-in AI opinion, realtime badge correctness, permission leaks",
    },
    #{
        id: "home-lib-windowing",
        paths: "src/screens-home.jsx, src/screens-lib.jsx, exercise-db.js",
        focus: "NOT the fixed Recent empty lie or e1RM warmup (if fixed). Residual: session detail priors hydration failures, compare screen, stats charts, system exercise copy contracts, dead navigation, isImprovement/isDecline cleanup opt-out",
    },
    #{
        id: "shell-sw-a11y",
        paths: "src/ui.jsx, index.html, sw.js, manifest.json, welcome.html, features.html, autoreg.html, screens-settings, onboarding",
        focus: "SW redirect/cache after Cloudflare, public page ?v= busters, radius/token violations, a11y (labels, focus trap, keyboard), theme paper/light contrast, passkeys, settings four-place gaps for new keys, half-wired toggles",
    },
    #{
        id: "edge-ai-cron",
        paths: "supabase/functions/ (all), _shared/ai.ts edge.ts",
        focus: "parse-meal scan-label ai-daily-summary ai-checkin-opinion auto-close (residual only) medication-reminder meal/water/daily-log reminders web-push pushover: auth, error handling, timezone, double-send, fail-open quota, provider fallback correctness",
    },
    #{
        id: "incomplete-ci-docs",
        paths: "src/, supabase/, tools/, docs/database.md, docs/internals.md, .github/workflows",
        focus: "TODO/FIXME/HACK/WIP stubs, dead routes, console.debug leftovers, CI gate holes (backup coverage allowlists abuse), schema.sql vs migrations drift signals, feature-map stale cards, untested critical paths",
    },
];

fn build_scan_prompt(denylist_text, fixed_text, open_text, angles_text, domain) {
    let p = "";
    p += "You are doing a FULL CODE REVIEW of part of the Logbook/Zane training PWA.\n";
    p += "Today is audit day. An investor audit already ran and many Critical/High issues were FIXED.\n";
    p += "Your job is NEW findings from OTHER engineering angles, not a rehash.\n\n";
    p += "HARD RULES:\n";
    p += "1. Read current code with read_file/grep/list_dir. Never invent. Never edit.\n";
    p += "2. DO NOT report anything on this denylist as an open bug (already fixed or already known product gap):\n";
    p += denylist_text + "\n\n";
    p += "Fixed today (treat as closed unless you prove a REGRESSION with new evidence):\n";
    p += fixed_text + "\n";
    p += "Still-open investor product items (do not re-list unless NEW technical depth):\n";
    p += open_text + "\n";
    p += "Preferred angles for this whole run: " + angles_text + "\n\n";
    p += "3. Every finding must include why_new: one sentence why this is not a duplicate of today's investor memo.\n";
    p += "4. Cap 8 findings, highest user/data impact first. Empty list is valid only after thorough inspection.\n";
    p += "5. Never use em-dashes. Code/UI identifiers stay English.\n";
    p += "6. Intentional design (do not file as bugs): history windowing aggregates, AI fields server-authored, ";
    p += "SW bump only on request, sys_ ids copied on pick, no kg/lbs conversion, radius 4/6/8/999.\n\n";
    p += "## Assignment\nDomain: " + domain.id + "\nPaths: " + domain.paths + "\nFocus: " + domain.focus + "\n\n";
    p += "## Method\n";
    p += "1. grep/list_dir assigned paths; for large files targeted greps then read_file offset/limit.\n";
    p += "2. Cross-check call sites when a bug spans store + screen + edge.\n";
    p += "3. evidence = short quote or precise location you actually saw.\n";
    p += "4. angle field = which engineering lens you used (security, sync, cleanup, units, ...).\n";
    p
}

// ── Phase 1: parallel full-codebase scan ────────────────────────────────
phase("Scan");
log("Launching " + domains.len().to_string() + " follow-up auditors (other angles)");

let scan_jobs = [];
for d in domains {
    let prompt = build_scan_prompt(denylist, fixed_blob, open_blob, angles_blob, d);
    scan_jobs.push(#{
        prompt: prompt,
        label: "scan:" + d.id,
        capability_mode: "read-only",
        agent_type: "explore",
        output_schema: findings_schema,
    });
}
let scan_results = parallel(scan_jobs);

let all_findings = [];
let scan_ok = 0;
let scan_fail = 0;
let si = 0;
for r in scan_results {
    let domain_id = domains[si].id;
    if r != () && r.success && r.output.findings != () {
        scan_ok += 1;
        for f in r.output.findings {
            if f.file != () && f.issue != () && f.evidence != () && f.why_new != () {
                let file_s = f.file;
                let issue_s = f.issue;
                let ev_s = f.evidence;
                let wn_s = f.why_new;
                file_s.trim();
                issue_s.trim();
                ev_s.trim();
                wn_s.trim();
                if file_s != "" && issue_s != "" && ev_s != "" && wn_s != "" {
                    let sev = if f.severity != () { f.severity } else { "medium" };
                    let cat = if f.category != () { f.category } else { "bug" };
                    let sug = if f.suggestion != () { f.suggestion } else { "" };
                    let ang = if r.output.angle != () { r.output.angle } else { domain_id };
                    all_findings.push(#{
                        domain: domain_id,
                        angle: ang,
                        severity: sev,
                        category: cat,
                        file: file_s,
                        issue: issue_s,
                        evidence: ev_s,
                        why_new: wn_s,
                        suggestion: sug,
                    });
                }
            }
        }
    } else {
        scan_fail += 1;
        log("Scan failed or empty: " + domain_id);
    }
    si += 1;
}
log("Scans: " + scan_ok.to_string() + " ok, " + scan_fail.to_string() + " fail; raw=" + all_findings.len().to_string());

if all_findings.len() == 0 {
    let empty_report = "# Audit-Day Follow-up Deep Review\n\nNo new findings after denylist. Unexpected if scanners failed; check scan_fail.\n";
    let path = write_scratch_file("audit-day-followup-report.md", empty_report);
    complete(#{ summary: "No new findings", path: path, confirmed: [] });
}

fn sev_rank(s) {
    if s == "critical" { return 0; }
    if s == "high" { return 1; }
    if s == "medium" { return 2; }
    3
}

let n = all_findings.len();
let a = 0;
while a < n {
    let best = a;
    let b = a + 1;
    while b < n {
        if sev_rank(all_findings[b].severity) < sev_rank(all_findings[best].severity) {
            best = b;
        }
        b += 1;
    }
    if best != a {
        let tmp = all_findings[a];
        all_findings[a] = all_findings[best];
        all_findings[best] = tmp;
    }
    a += 1;
}

const MAX_VERIFY = 28;
let to_verify = [];
let vi = 0;
while vi < all_findings.len() && vi < MAX_VERIFY {
    to_verify.push(all_findings[vi]);
    vi += 1;
}
if all_findings.len() > MAX_VERIFY {
    log("Verify cap: top " + MAX_VERIFY.to_string() + " of " + all_findings.len().to_string());
}

// ── Phase 2: adversarial verify + duplicate filter ──────────────────────
phase("Verify");
log("Verifying " + to_verify.len().to_string() + " findings; reject duplicates of today's work");

let vjobs = [];
let vj = 0;
while vj < to_verify.len() {
    let f = to_verify[vj];
    let vp = "";
    vp += "You are an adversarial skeptic for an audit-day FOLLOW-UP review.\n";
    vp += "Default real=false. Also set is_duplicate_of_today=true if this is the same issue as today's ";
    vp += "investor audit or a fix that already shipped (even if the scanner claims why_new).\n\n";
    vp += "Denylist / fixed today context:\n" + denylist + "\n\n";
    vp += "Claim:\n";
    vp += "- domain: " + f.domain + "\n";
    vp += "- angle: " + f.angle + "\n";
    vp += "- severity: " + f.severity + "\n";
    vp += "- category: " + f.category + "\n";
    vp += "- file: " + f.file + "\n";
    vp += "- issue: " + f.issue + "\n";
    vp += "- claimed evidence: " + f.evidence + "\n";
    vp += "- claimed why_new: " + f.why_new + "\n\n";
    vp += "Method:\n";
    vp += "1. read_file/grep the cited code independently.\n";
    vp += "2. Check if already fixed (git blame comments, obvious guard present).\n";
    vp += "3. real=true ONLY with independent evidence AND is_duplicate_of_today=false.\n";
    vp += "4. If real but severity wrong, correct severity.\n";
    vp += "5. Never use em-dashes. Read-only only.\n";
    vjobs.push(#{
        prompt: vp,
        label: "verify:" + vj.to_string() + ":" + f.domain,
        capability_mode: "read-only",
        agent_type: "explore",
        output_schema: verdict_schema,
    });
    vj += 1;
}
let verdicts = parallel(vjobs);

let confirmed = [];
let rejected = 0;
let duplicates = 0;
let unverified = 0;
let ci = 0;
for v in verdicts {
    let base = to_verify[ci];
    if v != () && v.success {
        let is_dup = v.output.is_duplicate_of_today == true;
        if is_dup {
            duplicates += 1;
        } else if v.output.real == true && v.output.evidence != () && v.output.evidence != "" {
            let sev2 = if v.output.severity != () && v.output.severity != "none" {
                v.output.severity
            } else {
                base.severity
            };
            confirmed.push(#{
                domain: base.domain,
                angle: base.angle,
                severity: sev2,
                category: base.category,
                file: base.file,
                issue: base.issue,
                evidence: v.output.evidence,
                reason: if v.output.reason != () { v.output.reason } else { "" },
                why_new: base.why_new,
                suggestion: base.suggestion,
                original_severity: base.severity,
            });
        } else {
            rejected += 1;
        }
    } else {
        unverified += 1;
    }
    ci += 1;
}
log("Verify: " + confirmed.len().to_string() + " new confirmed, " + rejected.to_string() + " rejected, "
    + duplicates.to_string() + " duplicates, " + unverified.to_string() + " unverified");

let cn = confirmed.len();
let ca = 0;
while ca < cn {
    let best = ca;
    let cb = ca + 1;
    while cb < cn {
        if sev_rank(confirmed[cb].severity) < sev_rank(confirmed[best].severity) {
            best = cb;
        }
        cb += 1;
    }
    if best != ca {
        let tmp = confirmed[ca];
        confirmed[ca] = confirmed[best];
        confirmed[best] = tmp;
    }
    ca += 1;
}

// ── Phase 3: report ─────────────────────────────────────────────────────
phase("Report");

let payload = #{
    scan_ok: scan_ok,
    scan_fail: scan_fail,
    raw_finding_count: all_findings.len(),
    verified_count: to_verify.len(),
    confirmed_count: confirmed.len(),
    rejected_count: rejected,
    duplicate_count: duplicates,
    unverified_count: unverified,
    denylist_summary: denylist,
    findings: confirmed,
};

let payload_json = json_encode(payload);

let report_prompt = "";
report_prompt += "Write the final Audit-Day Follow-up Deep Code Review report for Logbook/Zane.\n";
report_prompt += "Audience: the developer (German prose). File paths and identifiers stay English.\n";
report_prompt += "Never use em-dashes.\n";
report_prompt += "This report is ONLY new findings after today's investor audit + fixes. Say so up front.\n\n";
report_prompt += "JSON:\n";
report_prompt += payload_json;
report_prompt += "\n\nbody_markdown requirements:\n";
report_prompt += "1. Title: Audit-Day Follow-up Deep Review (2026-08-09)\n";
report_prompt += "2. Executive summary: counts, what was excluded (denylist), scan coverage.\n";
report_prompt += "3. Sections Critical / High / Medium / Low with findings:\n";
report_prompt += "   ### [category] title\n";
report_prompt += "   - File, Domain/Angle, Issue, Evidence, Why new, Suggestion\n";
report_prompt += "4. Prioritized fix order (top 8).\n";
report_prompt += "5. Residual risk: rejected, duplicates filtered, unverified, failed domains.\n";
report_prompt += "6. Do not invent findings. Set critical_count/high_count/confirmed_count accurately.\n";

let report_result = agent(report_prompt, #{
    label: "report:synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let body = "# Audit-Day Follow-up Deep Review\n\n(Report synthesis failed.)\n";
let summary = "synthesis failed";
let crit = 0;
let high = 0;

if report_result != () && report_result.success && report_result.output.body_markdown != () {
    body = report_result.output.body_markdown;
    if report_result.output.summary != () { summary = report_result.output.summary; }
    if report_result.output.critical_count != () { crit = report_result.output.critical_count; }
    if report_result.output.high_count != () { high = report_result.output.high_count; }
} else {
    let md = "# Audit-Day Follow-up Deep Review\n\n";
    md += "Confirmed NEW findings: " + confirmed.len().to_string() + "\n";
    md += "Rejected: " + rejected.to_string() + ", duplicates: " + duplicates.to_string()
        + ", unverified: " + unverified.to_string() + "\n\n";
    for f in confirmed {
        md += "## [" + f.severity + "][" + f.category + "] " + f.file + "\n";
        md += "- Domain: " + f.domain + " / " + f.angle + "\n";
        md += "- Issue: " + f.issue + "\n";
        md += "- Evidence: " + f.evidence + "\n";
        md += "- Why new: " + f.why_new + "\n\n";
        if f.severity == "critical" { crit += 1; }
        if f.severity == "high" { high += 1; }
    }
    body = md;
    summary = confirmed.len().to_string() + " new confirmed findings (fallback report)";
}

let report_path = write_scratch_file("audit-day-followup-report.md", body);
log("Report written: " + report_path);

complete(#{
    summary: summary,
    path: report_path,
    confirmed_count: confirmed.len(),
    critical_count: crit,
    high_count: high,
    raw_finding_count: all_findings.len(),
    rejected_count: rejected,
    duplicate_count: duplicates,
    unverified_count: unverified,
    scan_ok: scan_ok,
    scan_fail: scan_fail,
});
