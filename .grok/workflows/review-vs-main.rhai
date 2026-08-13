let meta = #{
    name: "review-vs-main",
    description: "Ship-readiness review of the current branch versus origin/main",
    when_to_use: "Full branch review before shipping: bugs, UX traps, unfinished work, security, docs drift",
    phases: [
        #{ title: "Scope", detail: "map the feature surfaces in the diff" },
        #{ title: "Review", detail: "parallel area reviews of the whole feature" },
        #{ title: "Verify", detail: "adversarial check of every finding" },
        #{ title: "Report", detail: "synthesize a ship-readiness report" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 6,
            "items": #{
                "type": "object",
                "required": ["file", "line", "severity", "title", "issue", "suggestion"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "line": #{ "type": "integer" },
                    "severity": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "suggestion": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["verdict", "summary", "markdown"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "markdown": #{ "type": "string" },
    },
};

fn trimmed(s) {
    if type_of(s) == "string" {
        s.trim();
        s
    } else {
        ""
    }
}

fn finding_key(f) {
    let file = trimmed(f.file);
    let title = trimmed(f.title);
    let issue = trimmed(f.issue);
    let head = issue;
    if head.len() > 80 { head = head.sub_string(0, 80); }
    file + "|" + title + "|" + head
}

fn rules_block() {
    let t = "";
    t += "Repo rules you must respect while judging:\n";
    t += "- No import/export. Everything is window.LB / window.Screens / window.UI.\n";
    t += "- Store updates only via setStore(s => ({ ...s, ... })), never mutate.\n";
    t += "- Supabase JS writes resolve with { error } and do not throw. Callers must unwrap or check error before optimistic UI.\n";
    t += "- New settings need four store.js sites: loadFromSupabase, settingsChanged, upsert, importFromBackup.\n";
    t += "- New SECURITY DEFINER functions need REVOKE EXECUTE FROM PUBLIC plus explicit grants. Check anon cannot execute.\n";
    t += "- UI tokens via UI.*, accent via rgba(var(--accent-rgb), x). Radius scale: 2/4/6/8/999 only (toggle track 13).\n";
    t += "- Weight labels via UI.unit(), never hardcode kg/lbs in UI.\n";
    t += "- New jsx files must be in index.html SOURCES and sw.js ASSETS. Shared top-level const must exist in exactly one file.\n";
    t += "- Conversation German, app UI English. Never use an em dash.\n";
    t += "- Feature gate: friends tab is settings.showFriendsTab. Social RPCs must not run when the gate is off.\n";
    t;
}

fn inspect_block() {
    let t = "";
    t += "Mandatory method:\n";
    t += "1. Run git commands yourself. Do not answer from memory.\n";
    t += "2. Start with: git diff --stat origin/main...HEAD and git diff --name-only origin/main...HEAD.\n";
    t += "3. Then git diff origin/main...HEAD -- <your assigned files>. For huge files, read the current file with read_file and grep around changed symbols.\n";
    t += "4. Read surrounding call sites, not only the hunk. A hunk that looks fine can be wrong at the caller.\n";
    t += "5. An empty findings list is valid ONLY after you actually inspected the assigned files. If you skip the tools, you fail.\n";
    t += "6. Report at most 6 concrete findings. Prefer ship-blockers over nits. Skip style-only noise unless it breaks a project rule.\n";
    t += "7. severity must be one of: bug, security, ux, unfinished, inconsistency, nit.\n";
    t += "8. line must be a real 1-based line in the current file. title is a short label.\n";
    t += "9. Write issue and suggestion in German, precise, with the actual symbol or RPC name.\n";
    t;
}

let base_ref = "origin/main";
if args != () && args.base != () {
    let maybe_base = trimmed(args.base);
    if maybe_base != "" { base_ref = maybe_base; }
}

phase("Scope");
log("Mapping the branch vs " + base_ref);

let scope_prompt = "";
scope_prompt += "Map the feature surface of the current git branch versus " + base_ref + ".\n";
scope_prompt += "Use git diff --stat " + base_ref + "...HEAD, git log --oneline " + base_ref + "..HEAD, and git diff --name-only " + base_ref + "...HEAD.\n";
scope_prompt += "Skim src/screens-friends.jsx, the social helpers in src/store.js, src/app.jsx friends gating, and the social migrations under supabase/migrations/0262 through 0278.\n";
scope_prompt += "Also note the non-social work in this same branch: food day closed, custom meal categories, X handle prompt, settings/onboarding/train/health wiring.\n";
scope_prompt += "Return findings as a single-item list whose issue is a compact German briefing: what shipped, which surfaces a reviewer must touch, and the riskiest areas. file can be BRANCH, line 1, severity nit, title Scope.\n";
scope_prompt += "Do not hunt bugs here. Only map scope.\n";

let scope_result = agent(scope_prompt, #{
    label: "scope-map",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

let scope_text = "";
if scope_result != () && scope_result.success && scope_result.output.findings != () && scope_result.output.findings.len() > 0 {
    scope_text = trimmed(scope_result.output.findings[0].issue);
}
if scope_text == "" { scope_text = "Kein Scope-Briefing. Review die gesamte Branch gegen " + base_ref + "."; }
log("Scope captured");

phase("Review");

let reviews = [
    #{
        id: "social-client",
        files: "src/screens-friends.jsx, src/app.jsx (friends route, tab gate, loadFriendsState, realtime, xHandle prompt), src/ui.jsx (TabBar friends, any social primitives), src/screens-home.jsx (FriendRequestBanner)",
        focus: "Friends UI correctness: request/accept/block/group/chat/attachments/plan share/live workout/cheers/metric cards/unread badge. Feature gate must not leak RPCs. Check empty, loading, error, offline, and permission-off states. Look for stale closures, missing error checks after inserts, chat edit window UX, and UI token/radius violations.",
    },
    #{
        id: "social-store",
        files: "src/store.js social block (roughly socialWeekStartISO through subscribeToFriends, SOCIAL_METRIC_CATALOG, LB exports around loadFriendsState), tools/test/store.test.cjs social tests",
        focus: "Client/store contract vs RPCs and tables. Mapping bugs, dropped fields, week-start timezone, metric visibility defaults, unread counts, in-flight cache, realtime subscribe/unsubscribe leaks, insert error handling, attachment upload, plan share import. Tests that miss the real contract.",
    },
    #{
        id: "social-db",
        files: "supabase/migrations/0262_x_handles.sql through 0278_social_group_plan_sharing.sql, later social-related slices of supabase/schema.sql, docs/database.md social/x-handle sections",
        focus: "Schema, RPC contracts, later migrations that rewrite earlier functions (adherence yesterday, own workouts, union order, set data, health metrics, chat edit window, nutrition yesterday, thigh lookup, group plan share). Drift between migration chain, schema.sql, and docs/database.md. Broken GRANT/REVOKE. Functions that still leak today into weekly averages.",
    },
    #{
        id: "security-privacy",
        files: "same social migrations plus store writes and friends/settings visibility UI. Especially RLS, storage policies, social_lookup_profile, message read/edit/delete, metric sharing, live workouts, blocks, reports, handle uniqueness, x_handle_public",
        focus: "Can a non-friend read metrics, messages, live workouts, attachments, or plan snapshots? Can anon execute SECURITY DEFINER RPCs? IDOR on friendship/group/message/share ids. Edit window bypass. Storage path traversal. Handle enumeration. Coach-of-client accidentally seeing social data. Defaults that share more than the UI claims.",
    },
    #{
        id: "food-day-closed",
        files: "src/screens-food.jsx, src/store.js mealCategories/foodDayIsClosed/normalizeMealCategories, supabase/migrations/0261_custom_meal_categories.sql, 0263_food_day_closed.sql, 0198_food_template_days.sql hunk, supabase/functions/meal-reminder/index.ts",
        focus: "Day-closed lock must actually stop edits, reopen, planned-slot materialization, reminders, and coach views. Custom meal categories must round-trip settings/backup and not crash old data. meal-reminder must honor closed days. Check timezone/today edge cases.",
    },
    #{
        id: "ui-wiring",
        files: "src/screens-settings.jsx, src/screens-onboarding.jsx, src/screens-train.jsx, src/screens-health.jsx, src/screens-medications.jsx, src/screens-coaching-core.jsx, src/screens-coaching-detail.jsx, src/screens-lib.jsx, src/feature-map-db.js, src/whatsnew.js, index.html, sw.js, tools/build.cjs, tools/check-build.cjs",
        focus: "Settings four-place plumbing for showFriendsTab and related social/x-handle/food settings. Onboarding vs later xHandle prompt double-ask. Tab bar overflow with friends+health+food+meds+coaching. Feature-map card accuracy. SOURCES/ASSETS/lazy chunk registration for screens-friends.jsx. Radius/token/unit violations in the new settings and train/health surfaces.",
    },
    #{
        id: "ux-traps",
        files: "src/screens-friends.jsx, src/screens-settings.jsx, src/screens-food.jsx, src/app.jsx, src/screens-onboarding.jsx, src/ui.jsx",
        focus: "UX traps a real user hits: tab hidden after enabling it, cannot find handle, join codes case/space, live workout appearing when sharing is off, cheer on finished workout, closed food day with no undo, destructive block/leave/delete without confirm, unread badge that never clears, keyboard/focus on chat, mobile hit targets, empty states that look like errors, copy that promises sharing the UI does not do.",
    },
    #{
        id: "completeness",
        files: "src/store.js settings/backup paths, tools/check-backup-coverage.cjs, docs/database.md, supabase/schema.sql, index.html SOURCES, sw.js ASSETS, package.json, Background/index.json, Claude.md is NOT in scope for code bugs",
        focus: "Unfinished work: TODO/FIXME/XXX, dead UI, RPCs defined but never called, client calling RPCs that do not exist, settings missing one of the four store sites, backup allowlist holes, docs/schema drift, feature-map not updated, whatsnew present but SW cache not bumped or vice versa, tests too thin for social mapping. Only report concrete unfinished or wiring gaps.",
    },
];

let review_jobs = [];
for item in reviews {
    let prompt = "";
    prompt += "You are reviewing the full current-branch diff versus " + base_ref + " before it ships.\n";
    prompt += "Assigned area: " + item.id + "\n";
    prompt += "Assigned files: " + item.files + "\n";
    prompt += "Focus: " + item.focus + "\n";
    prompt += "Scope briefing from the mapper: " + scope_text + "\n\n";
    prompt += rules_block();
    prompt += "\n";
    prompt += inspect_block();
    prompt += "\nHunt bugs, security holes, UX traps, UI inconsistencies, unfinished wiring, and contract drift. Do not praise. Do not invent issues.\n";
    review_jobs.push(#{
        prompt: prompt,
        label: "review:" + item.id,
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}

let review_results = parallel(review_jobs);

let findings = [];
let seen = #{};
let dropped_dupes = 0;
let failed_reviewers = 0;
let ri = 0;
for r in review_results {
    if r == () || !r.success || r.output.findings == () {
        failed_reviewers += 1;
    } else {
        for f in r.output.findings {
            let sev = trimmed(f.severity);
            let ok_sev = sev == "bug" || sev == "security" || sev == "ux" || sev == "unfinished" || sev == "inconsistency" || sev == "nit";
            if !ok_sev { continue; }
            let k = finding_key(f);
            if seen[k] == true {
                dropped_dupes += 1;
            } else {
                seen[k] = true;
                findings.push(#{
                    area: reviews[ri].id,
                    file: trimmed(f.file),
                    line: f.line,
                    severity: sev,
                    title: trimmed(f.title),
                    issue: trimmed(f.issue),
                    suggestion: trimmed(f.suggestion),
                });
            }
        }
    }
    ri += 1;
}
log(findings.len().to_string() + " unique findings; dropped " + dropped_dupes.to_string() + " dupes; " + failed_reviewers.to_string() + " reviewer slots failed");

const MAX_VERIFY = 36;
let verify_list = [];
let i = 0;
while i < findings.len() && verify_list.len() < MAX_VERIFY {
    verify_list.push(findings[i]);
    i += 1;
}
if findings.len() > verify_list.len() {
    log("Capped verification to " + MAX_VERIFY.to_string() + ", dropped " + (findings.len() - verify_list.len()).to_string());
}

if verify_list.len() == 0 {
    let empty_md = "# Ship-Review vs " + base_ref + "\n\nKeine Findings aus den Area-Reviews (oder alle Slots fehlgeschlagen: " + failed_reviewers.to_string() + "). Das ist kein Freibrief. Pruefe, ob die Reviewer wirklich gelaufen sind.\n";
    let empty_path = write_scratch_file("review-vs-main.md", empty_md);
    complete(#{
        path: empty_path,
        verdict: "unclear",
        summary: "Keine verifizierbaren Findings. Reviewer-Fehler: " + failed_reviewers.to_string(),
        confirmed: [],
        rejected: [],
    });
}

phase("Verify");
let vjobs = [];
for f in verify_list {
    let encoded = json_encode(f);
    let vp = "";
    vp += "Adversarially verify this review finding against the shipped code on the current branch.\n";
    vp += "Finding JSON: " + encoded + "\n\n";
    vp += "You must independently open the cited file with read_file and read the surrounding logic. Also check callers with grep.\n";
    vp += "Set real=true ONLY if you can quote concrete evidence that the bug/trap is actually present in the current code. Mention the exact symbol and why it misbehaves.\n";
    vp += "Set real=false if the finding is stale, already handled nearby, a style nit dressed as a bug, or not supported by the file you read.\n";
    vp += "Fail closed: if you cannot inspect the code, real=false.\n";
    vp += "reason and evidence in German. No em dash.\n";
    vjobs.push(#{
        prompt: vp,
        label: "verify:" + f.area,
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
}
let verdicts = parallel(vjobs);

let confirmed = [];
let rejected = [];
let vi = 0;
for v in verdicts {
    let f = verify_list[vi];
    if v != () && v.success && v.output.real == true && trimmed(v.output.evidence) != "" {
        confirmed.push(#{
            area: f.area,
            file: f.file,
            line: f.line,
            severity: f.severity,
            title: f.title,
            issue: f.issue,
            suggestion: f.suggestion,
            evidence: trimmed(v.output.evidence),
            reason: trimmed(v.output.reason),
        });
    } else {
        let why = "verification failed closed";
        if v != () && v.success && v.output.reason != () { why = trimmed(v.output.reason); }
        rejected.push(#{
            area: f.area,
            file: f.file,
            title: f.title,
            severity: f.severity,
            why: why,
        });
    }
    vi += 1;
}
log(confirmed.len().to_string() + "/" + verify_list.len().to_string() + " findings survived verification");

phase("Report");
let report_prompt = "";
report_prompt += "Write the final ship-readiness review in German for the user who asked to review the entire branch vs " + base_ref + " before shipping.\n";
report_prompt += "Confirmed findings JSON: " + json_encode(confirmed) + "\n";
report_prompt += "Rejected findings JSON: " + json_encode(rejected) + "\n";
report_prompt += "Failed reviewer slots: " + failed_reviewers.to_string() + "\n";
report_prompt += "Dropped dupes: " + dropped_dupes.to_string() + "\n\n";
report_prompt += "Output:\n";
report_prompt += "- verdict: one of ship, ship-with-fixes, do-not-ship\n";
report_prompt += "- summary: 3-6 German sentences, lead with the answer (is this shippable?)\n";
report_prompt += "- markdown: a complete German report with these sections exactly:\n";
report_prompt += "  # Ship-Review vs main\n";
report_prompt += "  ## Urteil\n";
report_prompt += "  ## Was dieser Branch macht\n";
report_prompt += "  ## Bestaetigte Findings (gruppiert nach severity: security, bug, ux, unfinished, inconsistency, nit)\n";
report_prompt += "  ## Verworfene Findings (kurz, nur wenn relevant)\n";
report_prompt += "  ## Offene Risiken / nicht abgedeckt\n";
report_prompt += "Each confirmed finding needs file:line, why it matters, and a concrete fix. No em dash. No invented extra bugs. If confirmed is empty, say so honestly and still list residual risk.\n";

let report = agent(report_prompt, #{
    label: "synthesize-report",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let md = "";
let verdict = "unclear";
let summary = "Report agent failed.";
if report != () && report.success && report.output.markdown != () {
    md = trimmed(report.output.markdown);
    verdict = trimmed(report.output.verdict);
    summary = trimmed(report.output.summary);
}
if md == "" {
    md = "# Ship-Review vs " + base_ref + "\n\nReport-Agent fehlgeschlagen. Roh-Findings folgen.\n\n";
    md += "Bestaetigt: " + json_encode(confirmed) + "\n\nVerworfen: " + json_encode(rejected) + "\n";
}

let path = write_scratch_file("review-vs-main.md", md);
complete(#{
    path: path,
    verdict: verdict,
    summary: summary,
    confirmed_count: confirmed.len(),
    rejected_count: rejected.len(),
    failed_reviewers: failed_reviewers,
    report: md,
});
