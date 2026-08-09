let meta = #{
    name: "investor-audit",
    description: "Fresh whole-product critique as if a billionaire would invest: bugs, UI/UX, traps, competitive gaps",
    when_to_use: "Fresh deep audit with investor lens; ignore prior audit docs",
    phases: [
        #{ title: "Scan", detail: "parallel domain critics across product and competitive gaps" },
        #{ title: "Verify", detail: "adversarial skeptics confirm top claims" },
        #{ title: "Report", detail: "German investor memo: what to fix before writing a check" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings", "area_covered"],
    "properties": #{
        "area_covered": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["severity", "category", "file", "issue", "evidence", "user_impact"],
                "properties": #{
                    "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low"] },
                    "category": #{
                        "type": "string",
                        "enum": ["bug", "data-loss", "security", "ui", "ux-trap", "incomplete", "competitive-gap", "trust", "perf"],
                    },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "user_impact": #{ "type": "string" },
                    "suggestion": #{ "type": "string" },
                    "competitor_ref": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "severity", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low", "none"] },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["title", "summary", "body_markdown", "investment_verdict"],
    "properties": #{
        "title": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "body_markdown": #{ "type": "string" },
        "investment_verdict": #{ "type": "string" },
        "critical_count": #{ "type": "integer" },
        "high_count": #{ "type": "integer" },
        "confirmed_count": #{ "type": "integer" },
    },
};

// Fresh lens: no prior audit docs, investor critic mindset.
let project_ctx = "";
project_ctx += "You are a ruthless product + engineering critic hired by a billionaire who is considering ";
project_ctx += "investing in this training PWA (Logbook / Zane). Your job is a FRESH audit of the CURRENT code.\n\n";
project_ctx += "HARD RULES:\n";
project_ctx += "- DO NOT read docs/audit.md, docs/audit-2026-08.md, docs/theme-audit-2026-08.md, or any prior audit reports. ";
project_ctx += "Those are forbidden sources. Ignore them completely even if you notice the files.\n";
project_ctx += "- Ground every claim in code you actually open (read_file / grep). No memory of old audits.\n";
project_ctx += "- Empty findings is valid ONLY after thorough grep+read of your assigned paths.\n";
project_ctx += "- Prefer user-facing pain: data loss, trust breaks, dead ends, confusing flows, broken polish, ";
project_ctx += "missing expectations vs Strong / Hevy / RP / MacroFactor / MyFitnessPal / TrainHeroic / Juggernaut.\n";
project_ctx += "- Cap 8 findings, highest user-impact first. Severity = impact on retention and trust, not code elegance.\n";
project_ctx += "- Never use em-dashes in any text field.\n\n";
project_ctx += "STACK (for orientation only):\n";
project_ctx += "No build step; CDN React 18 + Babel Standalone; global window (LB, Screens, UI); Supabase; PWA.\n";
project_ctx += "Contracts that are INTENTIONAL (do not file as bugs): history windowing (~70d sets, aggregates); ";
project_ctx += "AI fields server-authored outside client sync; SW cache bump only on request; sys_ exercise ids ";
project_ctx += "copied to user exercises on pick; weight labels via UI.unit() (no conversion); radius 4/6/8/999.\n";
project_ctx += "Real bugs: silent write success without {error} check, multi-device races, RLS/grant leaks, ";
project_ctx += "UX traps that make users feel stupid or lose data, UI token violations that hurt readability, ";
project_ctx += "half-wired features, competitive gaps that block growth.\n";
project_ctx += "Tools: read_file, grep, list_dir only. Never edit.\n";

let domains = [
    #{
        id: "trust-store",
        paths: "src/store.js, src/app.jsx",
        focus: "Investor lens: can this app lose workouts or health data? Multi-device races, boot merge, offline flush, backup/import holes, settings four-place gaps, silent write failures, history windowing edge cases that surface as wrong PRs or empty history",
    },
    #{
        id: "train-core",
        paths: "src/screens-train.jsx",
        focus: "Workout UX as a paying power user: rest timer traps, set completion friction, undo, PR celebration honesty, session close, offline mid-set, kg/lbs, meso/autoreg cognitive load, incomplete modes, anything that makes logging slower than competitors",
    },
    #{
        id: "plan-schedule",
        paths: "src/screens-schedule.jsx, src/programs-db.js",
        focus: "Plan builder vs Hevy/Strong/RP: wizard dead ends, flex days, draft autosave trust, exercise pick from system catalog, validation, reordering, complexity that scares new users vs power features hidden poorly",
    },
    #{
        id: "home-progress",
        paths: "src/screens-home.jsx, src/screens-lib.jsx, src/exercise-db.js",
        focus: "First open and progress screens: empty states, wrong trends after windowing, library friction, navigation dead ends, charts that lie, motivation vs overwhelm",
    },
    #{
        id: "health-body",
        paths: "src/screens-health.jsx, src/screens-water.jsx, src/screens-cardio.jsx, src/screens-medications.jsx",
        focus: "Daily log / water / cardio / meds UX: unit traps, adherence that punishes, reminder materialize-on-mount issues, missing wearable story, fever nudge spam, tab overload",
    },
    #{
        id: "food-nutrition",
        paths: "src/screens-food.jsx",
        focus: "Food tracker vs MacroFactor/MFP: search quality paths, scan/parse failures, plan mode complexity, null sugar/sat_fat semantics, share links, shopping list, favorite cache traps, logging speed",
    },
    #{
        id: "coaching-biz",
        paths: "src/screens-coaching-core.jsx, src/screens-coaching-client.jsx, src/screens-coaching-detail.jsx, src/screens-coaching-tabs.jsx",
        focus: "Coaching as a business product: invite flows, check-ins, notes, support tickets, self-coaching, permission leaks, realtime reliability, coach power-user gaps vs TrainHeroic/TrueCoach",
    },
    #{
        id: "shell-ui-polish",
        paths: "src/ui.jsx, index.html, sw.js, manifest.json, src/screens-settings.jsx, src/screens-onboarding.jsx, src/screens-featuremap.jsx, src/whatsnew.js, welcome.html, features.html, autoreg.html",
        focus: "Design system violations, theme/contrast, onboarding that fails to convert, settings sprawl, PWA update UX, public marketing vs product honesty, accessibility of primitives, a11y and motion",
    },
    #{
        id: "backend-security",
        paths: "supabase/functions/, supabase/schema.sql, supabase/migrations/ (sample latest), tools/",
        focus: "Investable security and reliability: edge error handling, cron auth, RLS, SECURITY DEFINER grants, silent AI failures, quota, secrets, CI holes that let data bugs ship",
    },
    #{
        id: "incomplete-stubs",
        paths: "src/, supabase/functions/, index.html",
        focus: "Half-finished product surface: TODO/FIXME/HACK/WIP/coming soon, disabled UI, dead routes, console.debug leftovers that signal unfinished work, feature flags half-wired, commented-out user flows",
    },
    #{
        id: "competitive-gaps",
        paths: "src/feature-map-db.js, src/screens-*.jsx (spot), welcome.html, features.html, CLAUDE.md feature list",
        focus: "What competitors ship that this product lacks or buries: social/share workout, wearables (Apple Health/Google Fit), Apple Watch logging, bodyweight auto, plate calculator, supersets polish, export CSV, dark patterns absent is good note gaps that block acquisition. Cite code absence (grep failed to find X) as evidence. competitor_ref field required when category is competitive-gap.",
    },
];

fn build_scan_prompt(ctx, domain) {
    let p = ctx;
    p += "\n## Your assignment\nDomain id: " + domain.id + "\n";
    p += "Files/paths: " + domain.paths + "\n";
    p += "Focus: " + domain.focus + "\n\n";
    p += "## Method (mandatory)\n";
    p += "1. grep and list_dir your paths first. For huge files use targeted greps then read_file with offset/limit.\n";
    p += "2. Think like a skeptical investor and a picky daily user, not a style linter.\n";
    p += "3. Cross-check call sites when a trap spans store + screen.\n";
    p += "4. Each finding needs: severity, category, file, issue, evidence (quote or precise location), user_impact, optional suggestion.\n";
    p += "5. For competitive-gap: evidence can be 'grep found no X across src/; related UI only has Y at path'.\n";
    p += "6. area_covered: one sentence of what you actually inspected.\n";
    p += "7. Categories: bug, data-loss, security, ui, ux-trap, incomplete, competitive-gap, trust, perf.\n";
    p
}

phase("Scan");
log("Fresh investor scan: " + domains.len().to_string() + " domains (prior audit docs forbidden)");

let scan_jobs = [];
for d in domains {
    let prompt = build_scan_prompt(project_ctx, d);
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
            if f.file != () && f.issue != () && f.evidence != () && f.user_impact != () {
                let file_s = f.file;
                let issue_s = f.issue;
                let ev_s = f.evidence;
                let ui_s = f.user_impact;
                file_s.trim();
                issue_s.trim();
                ev_s.trim();
                ui_s.trim();
                if file_s != "" && issue_s != "" && ev_s != "" && ui_s != "" {
                    let sev = if f.severity != () { f.severity } else { "medium" };
                    let cat = if f.category != () { f.category } else { "bug" };
                    let sug = if f.suggestion != () { f.suggestion } else { "" };
                    let cref = if f.competitor_ref != () { f.competitor_ref } else { "" };
                    all_findings.push(#{
                        domain: domain_id,
                        severity: sev,
                        category: cat,
                        file: file_s,
                        issue: issue_s,
                        evidence: ev_s,
                        user_impact: ui_s,
                        suggestion: sug,
                        competitor_ref: cref,
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
    let empty_report = "# Investor Audit\n\nNo findings. Unexpected; re-run.\n";
    let path = write_scratch_file("investor-audit-report.md", empty_report);
    complete(#{ summary: "No findings", path: path, confirmed: [] });
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

phase("Verify");
log("Adversarial verify of " + to_verify.len().to_string() + " findings");

let vjobs = [];
let vj = 0;
while vj < to_verify.len() {
    let f = to_verify[vj];
    let vp = "";
    vp += "You are an adversarial skeptic. Try to REFUTE this investment-audit finding. ";
    vp += "Default real=false unless you independently confirm with code you read now.\n";
    vp += "Do NOT open docs/audit.md or any prior audit documents.\n\n";
    vp += "Claim:\n";
    vp += "- domain: " + f.domain + "\n";
    vp += "- severity: " + f.severity + "\n";
    vp += "- category: " + f.category + "\n";
    vp += "- file: " + f.file + "\n";
    vp += "- issue: " + f.issue + "\n";
    vp += "- evidence claimed: " + f.evidence + "\n";
    vp += "- user_impact claimed: " + f.user_impact + "\n\n";
    vp += "Method: read_file/grep the code. Intentional contracts (history windowing, AI server fields, SW bump policy) are not bugs.\n";
    vp += "real=true only with independent evidence quote. Adjust severity if real. If not real: severity=none.\n";
    vp += "Read-only. No edits. No em-dashes.\n";
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
let unverified = 0;
let ci = 0;
for v in verdicts {
    let base = to_verify[ci];
    if v != () && v.success && v.output.real == true
        && v.output.evidence != () && v.output.evidence != "" {
        let sev2 = if v.output.severity != () && v.output.severity != "none" {
            v.output.severity
        } else {
            base.severity
        };
        confirmed.push(#{
            domain: base.domain,
            severity: sev2,
            category: base.category,
            file: base.file,
            issue: base.issue,
            evidence: v.output.evidence,
            reason: if v.output.reason != () { v.output.reason } else { "" },
            user_impact: base.user_impact,
            suggestion: base.suggestion,
            competitor_ref: base.competitor_ref,
            original_severity: base.severity,
        });
    } else if v != () && v.success && v.output.real == false {
        rejected += 1;
    } else {
        unverified += 1;
    }
    ci += 1;
}
log("Verify: " + confirmed.len().to_string() + " confirmed, " + rejected.to_string() + " rejected, " + unverified.to_string() + " unverified");

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

phase("Report");

let payload = #{
    scan_ok: scan_ok,
    scan_fail: scan_fail,
    raw_finding_count: all_findings.len(),
    verified_count: to_verify.len(),
    confirmed_count: confirmed.len(),
    rejected_count: rejected,
    unverified_count: unverified,
    findings: confirmed,
};

let payload_json = json_encode(payload);

let report_prompt = "";
report_prompt += "Write the final INVESTOR AUDIT memo for Logbook/Zane (training PWA).\n";
report_prompt += "Audience: the founder (German). Tone: blunt billionaire due-diligence, not polite junior QA.\n";
report_prompt += "Input is JSON of CONFIRMED findings only (adversarially verified). Do not invent findings.\n";
report_prompt += "Never use em-dashes. File paths and identifiers stay English.\n\n";
report_prompt += "JSON:\n";
report_prompt += payload_json;
report_prompt += "\n\n## body_markdown structure\n";
report_prompt += "1. Title + one-paragraph investment freeze-frame (what this product is, what's unusually strong, what's scary).\n";
report_prompt += "2. Executive counts by severity and category.\n";
report_prompt += "3. Sections Critical / High / Medium / Low. Each finding:\n";
report_prompt += "   ### [category] short title\n";
report_prompt += "   - File, Domain, Issue, Evidence, User impact, Why an investor cares, Suggestion, competitor_ref if any\n";
report_prompt += "4. Competitive gaps board: cluster competitive-gap + product holes; say what money should buy first.\n";
report_prompt += "5. What I would change before writing a check (prioritized 8-12 actions, product + eng).\n";
report_prompt += "6. Residual risk (rejected/unverified, scan failures).\n";
report_prompt += "7. investment_verdict: 3-6 sentences: would you invest, under what conditions, what must flip first.\n";
report_prompt += "Set critical_count, high_count, confirmed_count accurately. body_markdown complete GFM.\n";

let report_result = agent(report_prompt, #{
    label: "report:investor-memo",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let body = "# Investor Audit\n\n(Report synthesis failed.)\n";
let summary = "synthesis failed";
let verdict = "";
let crit = 0;
let high = 0;

if report_result != () && report_result.success && report_result.output.body_markdown != () {
    body = report_result.output.body_markdown;
    if report_result.output.summary != () { summary = report_result.output.summary; }
    if report_result.output.investment_verdict != () { verdict = report_result.output.investment_verdict; }
    if report_result.output.critical_count != () { crit = report_result.output.critical_count; }
    if report_result.output.high_count != () { high = report_result.output.high_count; }
} else {
    let md = "# Investor Audit (fallback)\n\n";
    md += "Confirmed: " + confirmed.len().to_string() + " | Rejected: " + rejected.to_string() + " | Unverified: " + unverified.to_string() + "\n\n";
    for f in confirmed {
        md += "## [" + f.severity + "][" + f.category + "] " + f.file + "\n";
        md += "- " + f.issue + "\n";
        md += "- Impact: " + f.user_impact + "\n";
        md += "- Evidence: " + f.evidence + "\n\n";
        if f.severity == "critical" { crit += 1; }
        if f.severity == "high" { high += 1; }
    }
    body = md;
    summary = confirmed.len().to_string() + " confirmed (fallback report)";
    verdict = "Synthesis agent failed; use confirmed list only.";
}

if verdict != "" {
    body += "\n\n---\n\n## Investment verdict\n\n";
    body += verdict;
    body += "\n";
}

let report_path = write_scratch_file("investor-audit-report.md", body);
log("Report: " + report_path);

complete(#{
    summary: summary,
    path: report_path,
    investment_verdict: verdict,
    confirmed_count: confirmed.len(),
    critical_count: crit,
    high_count: high,
    raw_finding_count: all_findings.len(),
    rejected_count: rejected,
    unverified_count: unverified,
    scan_ok: scan_ok,
    scan_fail: scan_fail,
});
