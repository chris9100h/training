/* Autoregulation guide, public standalone page content.

   Renders the three-mode selector plus the per-mode field manual for
   autoreg.html. Self-contained: no framework, no DB. It uses only the CSS
   variables and classes defined in autoreg.html, and mirrors the in-app
   AutoregGuideScreen (src/screens-autoreg-guide.jsx) 1:1.

   Loaded by autoreg.html with a ?v= cache-buster that must be bumped in
   lockstep with the sw.js CACHE version (see the note there). Not used by
   the app itself, so it is intentionally not in sw.js ASSETS or the loader. */
(function(){
  var CARD='background:var(--panel);border:0.5px solid var(--hair);border-radius:8px;padding:18px';

  var MODE_META={
    A:{tag:'AUTO',nm:'Volume + Load',d:'Open-ended autoregulation. Feedback tunes both your set counts and your weights, forever.',pills:['Sets move','Weight moves','No RIR taper']},
    B:{tag:'AUTO · LOAD',nm:'Load only',d:'Set counts stay exactly as written. Feedback tunes weight only, and soreness becomes a brake on it.',pills:['Sets frozen','Weight moves','No RIR taper']},
    C:{tag:'MESO',nm:'Mesocycle',d:'A fixed 4 to 8 week block. Both dials move, each week ramps closer to failure, then a deload.',pills:['Sets move','Weight moves','RIR taper + deload']}
  };

  function dir(kind,label){
    var map={up:['var(--ok)','▲'],down:['var(--danger)','▼'],hold:['var(--ink-faint)','●'],block:['var(--danger)','✕'],flag:['var(--accent)','⚑']};
    var m=map[kind]||map.hold; var sz=kind==='hold'?7:9;
    return '<span class="dir" style="color:'+m[0]+';background:color-mix(in srgb,'+m[0]+' 13%,transparent)"><span style="font-size:'+sz+'px">'+m[1]+'</span>'+label+'</span>';
  }
  function chip(t){return '<span class="chip">'+t+'</span>';}
  function opt(chipText,dirsHTML,txtHTML,cell){
    var cls=cell?'opt-cell':'opt';
    return '<div class="'+cls+'"><div class="opt-row">'+chip(chipText)+dirsHTML+'</div><div class="opt-txt">'+txtHTML+'</div></div>';
  }
  function stat(k,v,vColor,s){
    return '<div class="stat"><div class="kick">'+k+'</div><div class="display v" style="color:'+(vColor||'var(--ink)')+'">'+v+'</div><div class="s">'+s+'</div></div>';
  }
  function panel(idx,title,when,body){
    return '<div class="panel"><div class="panel-head">'+
      (idx!=null?'<span class="panel-idx">'+idx+'</span>':'')+
      '<span class="display panel-title">'+title+'</span>'+
      (when?'<span class="panel-when">'+when+'</span>':'')+
      '</div><div class="panel-body">'+body+'</div></div>';
  }
  function sechead(n,title,sub,chipLabel){
    return '<div class="sech"><div class="sech-n">'+n+'</div>'+
      '<h2 class="display sech-t">'+title+(chipLabel?'<span class="sech-chip">'+chipLabel+'</span>':'')+'</h2>'+
      (sub?'<p class="sech-sub">'+sub+'</p>':'')+'</div>';
  }

  function signals(isB){
    var up=function(l){return dir('up',l);},dn=function(l){return dir('down',l);},ho=function(l){return dir('hold',l);},bl=function(l){return dir('block',l);};
    var rows=[
      ['Reps all hit the earn ladder', ho('no direct effect'), up('bump, if gates green')],
      ['Early set misses the floor (x2)', ho('none'), dn('cut, overrides all')],
      ['Soreness: none / healed early', isB?ho('frozen'):up('+1 set'), ho('no effect')],
      ['Soreness: still sore', isB?ho('frozen'):dn('-1 set'), isB?bl('holds weight'):ho('no effect')],
      ['Joint: noticeable / sharp', isB?ho('frozen'):dn('-1 set'), bl('blocks bump')],
      ['Pump: low', ho('none, tracks swap'), bl('blocks bump')],
      ['Weight feel: too light / hard', ho('no effect'), up('earns bump')],
      ['Weight feel: too heavy', ho('no effect'), bl('blocks bump')],
      ['Overreach: sore + reps flat / joints, 2 exposures', ho('adds frozen (at ceiling)'), bl('deload suggested')]
    ];
    if(!isB){
      rows.push(['Workload: not enough', up('+1 set'), ho('no effect')]);
      rows.push(['Workload: pushed / too much', dn('-1 set'), ho('no effect')]);
    }
    return rows;
  }

  function guideHTML(M){
    var isA=M==='A',isB=M==='B',isC=M==='C';
    var out='';

    /* 01 overview */
    out+='<section class="sec first">'+sechead('01 / Overview',
      isB?'What Load only turns':isC?'What a Mesocycle turns':'What Volume + Load turns',
      isA?'The full engine with no fixed end. Both dials move from your feedback, and it just keeps running.'
      :isB?'Your programmed set counts stay untouched. The feedback engine points entirely at the weight on the bar.'
      :'The full both-dials engine wrapped in a bounded block: a weekly intensity ramp in RIR, ending in a deload.');
    out+='<div class="grid g180">'+
      stat('Dial 1 · Sets', isB?'Frozen':'Move', isB?'var(--ink-faint)':'var(--ok)',
        isB?'Stay exactly as authored, every session.':isC?'Feedback rotates sets, frozen only in the final week.':'Feedback rotates sets across each muscle group.')+
      stat('Dial 2 · Weight','Feedback owned','var(--accent)','Reps earn it, recovery gates it, a cut overrides it. Same in every mode.')+
      stat('RIR taper', isC?'Weekly ramp':'None', isC?'var(--accent)':'var(--ink-faint)',
        isC?'From an easy start down to failure in the last week.':'Open-ended plans carry no weekly RIR target.')+
      stat('Deloads','2 routes',null, isC?'A planned end-of-block deload, plus manual anytime.':'A generic 8 week nudge, plus manual anytime.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">The one rule, every mode</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>Your feedback owns the direction of the weight.</b> A cut from missed reps overrides any increase. A withheld bump holds the weight. It only climbs when every recovery light is green. Classic Smart Progression still runs quietly underneath, but on these plans it never fires the "Progression unlocked" celebration on its own.</div></div>';
    out+='</section>';

    /* 02 roadmap */
    out+='<section class="sec">'+sechead('02 / Roadmap','How your feedback plays out',
      'One session in, one re-seeded session out. The pipeline is always the same; the difference between modes is only which dial each signal moves.');
    var stages=[
      ['Stage 1','You train','Log your real reps. Answer up to 4 quick questions per muscle group.'],
      ['Stage 2','Two signals', isB?'Objective: did the reps land. Subjective: soreness, joints, pump, weight feel.':'Objective: did the reps land. Subjective: soreness, joints, pump, weight feel, workload.'],
      ['Stage 3','Two dials', isB?'Sets stay put, weight earns or cuts.':'Sets rotate, weight earns or cuts.'],
      ['Stage 4','Next session','Seeded automatically: new set counts, new weight, reps reset on a jump.']
    ];
    out+='<div class="grid g150" style="gap:8px;margin-bottom:18px">'+stages.map(function(s){
      return '<div class="inset"><div style="font-family:var(--f-mono);font-size:9px;letter-spacing:0.13em;text-transform:uppercase;color:var(--accent)">'+s[0]+'</div>'+
        '<div class="display" style="font-size:15px;margin:3px 0 6px">'+s[1]+'</div>'+
        '<div style="font-size:12px;color:var(--ink-soft);line-height:1.4">'+s[2]+'</div></div>';
    }).join('')+'</div>';
    out+='<div class="kick">Signal map: which dial each answer moves</div>';
    out+='<div class="grid g230" style="margin-top:10px">'+signals(isB).map(function(r){
      return '<div class="inset" style="padding:12px 13px"><div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:10px">'+r[0]+'</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-family:var(--f-mono);font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint);width:46px;flex-shrink:0">Sets</span>'+r[1]+'</div>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px"><span style="font-family:var(--f-mono);font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-faint);width:46px;flex-shrink:0">Weight</span>'+r[2]+'</div></div>';
    }).join('')+'</div>';
    if(isB) out+='<div style="font-size:12.5px;color:var(--ink-soft);margin-top:12px">In Load only the sets column is inert: every set answer is frozen, so the questions exist purely to gate the weight. Soreness is repurposed as a recovery brake that holds the weight instead of cutting a set.</div>';
    out+='</section>';

    /* readiness (modus-agnostic, same in every mode) */
    out+='<section class="sec">'+sechead('Readiness · Today','One tap for how you feel',
      'At the start of every session the app asks Fresh, Normal or Rough. It only nudges the suggestion, never the ceiling: you can always push to your limit, and a real PR counts on any day.');
    out+='<div class="grid g180">'+
      stat('Fresh','Push','var(--ok)','A strong day. Train as usual and chase the bump.')+
      stat('Normal','As usual',null,'The default. Nothing changes, the engine runs normally.')+
      stat('Rough',isC?'+1 RIR':'Ease off','var(--accent)',isC?'Low on energy. The app suggests a rep more in reserve and counts the session gently, so a bad night never cuts your progression.':'Low on energy. The app eases the target (leave a little more in reserve) and counts the session gently, so a bad night never cuts your progression.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">Why it matters</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>A rough day is discounted, not thrown away.</b> On Rough the app holds off the rep-miss cut and does not chase the earn ladder, so one tired session can never drag your weight down. If you push through and hit your reps anyway, the bump still lands. Skip the tap to train exactly as normal.</div></div>';
    out+='</section>';

    /* re-entry ramp (modus-agnostic) */
    out+='<section class="sec">'+sechead('Coming back · Break','Eased in after time off',
      'Take a sick or vacation break longer than a week and the first sessions back start eased in: a rep more in reserve, counted gently, so a layoff never punishes your numbers. It only lowers the suggestion, never the ceiling, one strong set snaps you straight back.');
    out+='<div class="grid g180">'+
      stat('Auto','No tap needed',null,'After a break over a week the app opens your first session back already eased in, discounted like a rough day. Nothing to set.')+
      stat('Per lift','1, maybe 2 sets','var(--accent)','Each lift starts a touch lighter, but hit your reps and earn pulls it straight back, usually on the first exposure, at most the second.')+
      stat('Systemic','One microcycle',null,'The gentle count fades over a single rotation, week or cycle (your plan\'s unit), not a fixed number of sessions. A longer break eases in longer.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">Why it matters</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>Never held below what you can do.</b> The ramp lowers the target, never caps the weight. Come back strong and your performance overrides it instantly, the discount just means a good day after time off still counts and a rough one never drags your progression down. Short break (a week or less)? No ramp at all.</div></div>';
    out+='</section>';

    /* volume ceiling / overreach (modus-agnostic) */
    out+='<section class="sec">'+sechead('Ceiling · Volume','When a muscle has had enough',
      'The engine counts your hard sets per muscle over each microcycle (a rotation, a week, or a cycle, depending on the plan) and watches for the overreaching signature. It is the same guard in every mode, it just pulls a different lever.');
    out+='<div class="grid g180">'+
      stat('The signal','Sore + stalled',null,'A muscle that stays sore across its last two exposures while its reps go flat under the same load, or its joints start complaining.')+
      stat('The hold','No more sets','var(--accent)','Once a muscle hits its ceiling the app stops adding sets to it. Weight and every other muscle keep progressing normally.')+
      stat('The offer','Deload, 1 tap',null,'If a muscle is at its ceiling when you finish, the app offers a deload with the reason spelled out. Always wave-off-able.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">Per mode</div><div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)">'+
      (isC?'<b>Mesocycle:</b> if a muscle tops out before the planned peak week, its sets stop climbing early (held, not cut). The planned deload still arrives at block end, so no separate offer pops mid-block.'
        :isB?'<b>Load only:</b> your set counts are fixed anyway, so there is nothing to freeze. The detector\'s only job here is to hold the load and offer the deload when the fatigue signature shows.'
        :'<b>Volume + Load:</b> the ceiling is the only thing holding your sets back. Hit it and adds pause for that muscle, then the deload offer lets you reset when you are ready. Nothing is ever forced, keep training if you would rather push on.')+
      '</div></div>';
    out+='</section>';

    /* volume landmarks / self-timed block (modus-agnostic) */
    out+='<section class="sec">'+sechead('Landmarks · Memory','A ceiling it learns and remembers',
      'The first time a muscle hits its overreaching signature, the app remembers the set count it happened at as that muscle\'s ceiling. It is smoothed across blocks, so one rough block nudges the number, never craters it. That memory is what turns an open-ended plan into a self-timed block.');
    out+='<div class="grid g180">'+
      stat('Learned ceiling','Per muscle',null,'Your MRV is stored per muscle, not per exercise, and averaged across blocks. A single bad week moves it a little, so it settles on your real ceiling over time.')+
      stat('Self-timed block','Recovery, not a number','var(--accent)','A block ends when you hit the ceiling, not on a fixed date. Take the deload and the app starts a fresh block right there.')+
      stat('Reset & re-ramp','Back off, build again',null,'On that reset each exercise drops about 2 sets from where it topped out (never below your plan\'s base), then set adds climb again, capped by the same learned ceiling.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">Per mode</div><div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)">'+
      (isB?'<b>Load only:</b> no volume landmarks here by design, your set counts are fixed on purpose. You still get the ceiling detector and the deload offer, they just hold and drop the weight instead of your sets.'
        :isC?'<b>Mesocycle:</b> the block still ends on its planned week, but the learned ceiling carries as a memory and caps your sets early if you reach it before the peak. Your next block starts fresh from a backed-off base.'
        :'<b>Volume + Load:</b> this is what makes the plan a self-paced mesocycle. Grow until a muscle tops out, take the deload when you are ready, and the next block re-ramps from a backed-off start toward the ceiling you actually reached. Never forced, always wave-off-able.')+
      '</div></div>';
    out+='</section>';

    /* block recap (modus-agnostic) */
    out+='<section class="sec">'+sechead('Recap · Block','What you built, and what it cost',
      'When a block wraps up, the app sums up everything since your last reset: weight PRs, the lifts that climbed, how many sessions you put in and your best day. It shows up in two moments, and reads differently in each.');
    out+='<div class="grid g180">'+
      stat('Block end','Pure win','var(--ok)','Finish a block or take a deload and the recap is a celebration: PRs, sessions, best day, nothing else.')+
      stat('Deload declined','Win + cost','var(--accent)','Wave a suggested deload off and the recap shows the same gains next to the fatigue evidence, so the choice is an honest one.')+
      stat('Anti-nag','Asked once',null,'After you decline it goes quiet for a few sessions, just a small deload ready tag, then only speaks up again if the fatigue is clearly worse.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">Why both sides</div><div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)">'+
      (isC?'<b>Mesocycle:</b> your recap lands at the end of the block, when the mesocycle finishes, as a straight celebration. There is no mid-block nag: the planned deload is already on the calendar.'
        :'<b>Gains alone would argue against ever stopping.</b> "It is going great, why deload?" Seeing what you built next to the fatigue that came with it makes the call a real one. The app asks once with honest data, never blocks you, and never guilt-trips: keep training if you would rather push on.')+
      '</div></div>';
    out+='</section>';

    /* stall + concrete swap (modus-agnostic) */
    out+='<section class="sec">'+sechead('Stall · Swap','When a lift stops moving',
      'Separate from a tired muscle: sometimes one exercise just stalls. If your estimated 1RM on a lift goes flat for three sessions while your gates are green (joints fine, good pump, the muscle not at its ceiling), the app flags it and names a concrete alternative to try.');
    out+='<div class="grid g180">'+
      stat('The signal','Flat 3 sessions',null,'Three sessions with no new estimated 1RM on that lift, while joints, pump and muscle volume all read fine. That points at the exercise, not fatigue.')+
      stat('The swap','A real change','var(--accent)','It names a sibling for the same muscle with a different movement or equipment, so the stimulus actually changes, not just a rename.')+
      stat('One tap','Or ignore it',null,'Tap to swap it in and your sets carry over, or wave it off and keep grinding. Always a suggestion, never forced.')+
      '</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">Why the gates matter</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>A stall is a lift problem, not a fatigue problem.</b> If the muscle were at its ceiling or your joints were complaining, the fix would be a deload, not a swap. By only firing when everything else looks healthy, this tells apart a lift that has run its course from a body that needs a break. It skips lifts you already flagged and never suggests one you disliked.</div></div>';
    out+='</section>';

    /* 03 feedback */
    out+='<section class="sec">'+sechead('03 / Feedback','The questions and every answer',
      isB?'Asked per muscle group: soreness first, then per exercise the joint, weight and pump check.':'Asked per muscle group: soreness first, then per exercise the joint, weight and pump check, then the muscle workload last.');
    out+='<div style="display:flex;flex-wrap:wrap;gap:9px 14px;margin-bottom:18px">'+dir('up','set up')+dir('down','set down')+dir('hold','nothing')+dir('block','blocks weight bump')+dir('flag','warning')+'</div>';
    out+='<div style="display:flex;flex-direction:column;gap:14px">';
    /* soreness */
    var sor='<p class="panel-intro">'+(isB?'In Load only, sets are frozen, so soreness is repurposed: it becomes a recovery brake on the weight. A still-sore muscle simply holds its weight this session.'
      :isC?'A recovery signal that points both ways. It moves the sets. It is not asked in the final week (sets are frozen there), nor in week 1 of a fresh plan.'
      :'A recovery signal that points both ways. Too little is as much an off-target signal as too much. It moves the sets.')+'</p>';
    sor+='<div class="opt-grid">';
    sor+=opt('Never sore', isB?dir('hold','weight not braked'):dir('up','+1 set'), isB?'Clears any weight brake on this muscle.':'Recovered easily, likely below target volume. +1 set to the least-grown exercise.', true);
    sor+=opt('Healed a while ago', isB?dir('hold','weight not braked'):dir('up','+1 set'), 'Same as "Never sore".', true);
    sor+=opt('Healed just in time', dir('hold','hold'), 'The optimal window. No change.', true);
    sor+=opt('Still sore', isB?dir('block','holds weight'):dir('down','-1 set'), isB?'Brakes the weight: no bump for this muscle this session.':'Over-reach. -1 set from the most-grown exercise.', true);
    sor+='</div>';
    out+=panel('1','Soreness','per muscle<br>at start', sor);
    /* per exercise: joint + weight feel + pump. Each sub-block tiles into its
       own responsive grid so the (long) list stays compact, not mega-tall. */
    var jn='<p class="panel-intro">Asked for every exercise, every mode. Joint comfort, how the weight felt, and the pump: together these three gate the weight bump for this exercise'+(isB?'.':'. In Volume+Load and Meso, joint pain also shaves a set off this exercise.')+'</p>';
    jn+='<div class="card lb accented" style="margin-bottom:14px"><div class="kick" style="color:var(--accent)">One-tap shortcut</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>Nothing to report? One tap.</b> The sheet opens asking "How did that feel?" with a single "On point" button that answers all four at once: joint none, weight just right, pump moderate, lift affinity "It\'s fine". "Flag a detail" opens the full set instead, pre-filled to on-target, so you only touch what actually deviated. Soreness above stays its own separate tap, per muscle, untouched by this shortcut.</div></div>';
    jn+='<div class="kick">Joint</div>';
    jn+='<div class="opt-grid" style="margin-top:8px">';
    jn+=opt('None', dir('hold','gate green'), 'Joints fine. This exercise can earn its bump.', true);
    jn+=opt('Noticeable', (!isB?dir('down','-1 set'):'')+dir('block','bump'), 'Discomfort. Blocks the bump'+(isB?'.':', and shaves a set off this exercise.'), true);
    jn+=opt('Sharp pain', (!isB?dir('down','-1 set'):'')+dir('block','bump')+dir('flag','warning'), 'Real pain. As above, plus a durable warning on the exercise ("caused sharp joint pain, consider swapping it").', true);
    jn+='</div>';
    jn+='<div style="margin-top:14px"><div class="kick">Weight feel</div></div>';
    jn+='<div class="opt-grid" style="margin-top:8px">';
    jn+=opt('Too light', dir('up','earns bump'), 'Weight can climb on this exercise.', true);
    jn+=opt('Just right', dir('hold','hold'), 'On point, gate green.', true);
    jn+=opt('Hard', dir('up','still earns bump'), 'Training should be hard. "Hard" still lets the weight climb. It self-corrects.', true);
    jn+=opt('Too heavy', dir('block','holds weight'), 'The only weight answer that holds. Everything lighter lets it climb.', true);
    jn+='</div>';
    jn+='<div style="margin-top:14px"><div class="kick">Pump</div></div>';
    jn+='<div class="opt-grid" style="margin-top:8px">';
    jn+=opt('Low', dir('block','bump')+dir('flag','swap'), 'Barely felt it. Blocks the bump. Low pump on 3 sessions running suggests swapping this exercise, not forcing it.', true);
    jn+=opt('Moderate', dir('hold','gate green'), 'Decent stimulus. Weight can climb.', true);
    jn+=opt('Amazing', dir('hold','gate green'), 'Great stimulus.', true);
    jn+='</div>';
    jn+='<div style="margin-top:14px"><div class="kick">This lift (optional)</div></div>';
    jn+='<div class="opt-grid" style="margin-top:8px">';
    jn+=opt('Love it', dir('hold','no dial'), 'A keeper. Pre-filled next time, so it costs no taps unless it changes.', true);
    jn+=opt("It's fine", dir('hold','no dial'), 'No strong feelings. Neutral.', true);
    jn+=opt('Not my lift', dir('flag','swap'), 'Marking this two sessions running suggests a variation you enjoy, so you actually stick with it. It gates nothing: a lift you dislike but that works still earns its weight.', true);
    jn+='</div>';
    out+=panel('2', 'Per exercise','per exercise<br>after last set', jn);
    /* per-muscle workload (Volume+Load / Meso only) */
    if(!isB){
      var pv='<p class="panel-intro">One question per muscle group: how much total work it got. This drives the set dial only. It no longer touches the weight, the per-exercise weight-feel question owns that now.</p>';
      pv+='<div class="opt-grid">';
      pv+=opt('Not enough', dir('up','+1 set'), 'Too little. +1 set to the least-grown exercise.', true);
      pv+=opt('Just right', dir('hold','hold'), 'On point.', true);
      pv+=opt('Pushed my limits', dir('down','-1 set'), 'To the limit. Cuts a set off the most-grown exercise.', true);
      pv+=opt('Too much', dir('down','-1 every exercise'), 'Clearly too much. Cuts a set off every exercise of the group.', true);
      pv+='</div>';
      out+=panel('3', 'Workload','per muscle<br>after last exercise', pv);
    }
    out+='</div>';
    out+='<div class="card lb accented" style="margin-top:16px"><div class="kick" style="color:var(--accent)">No double-stacking</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)">'+(isB?'Every set effect above is frozen in Load only, so the questions only ever open or close the weight gate. You can still fix any answer until the session ends, it re-computes cleanly.':'Two negative answers on the same exercise never stack to -2: the first one to cut it owns that cut for the session, a later -1 just drops. You can fix any answer until the session ends, it re-computes cleanly.')+'</div></div>';
    out+='</section>';

    /* 04 volume dial */
    out+='<section class="sec">'+sechead('04 / Dial 1', isB?'The volume dial, and why it is off here':'The volume dial',
      isB?'In Load only the set dial is deliberately locked. Your programmed set counts never change, so the rotation system does not run. The questions that would move sets instead only gate the weight.'
      :isC?'Each exercise carries a hidden set delta per training day. Next session: sets = max(1, planned + delta). Never below 1, no cap above. Frozen in the final week.'
      :'Each exercise carries a hidden set delta per training day. Next session: sets = max(1, planned + delta). Never below 1, no cap above.');
    if(isB){
      out+='<div class="card lb accented"><div class="kick" style="color:var(--accent)">Sets frozen</div>'+
        '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>Your set counts stay exactly as you wrote them.</b> Load only points the entire feedback engine at the weight. If you want the app to also add and remove sets, switch to Volume + Load or a Mesocycle in the plan editor.</div></div>';
    } else {
      var rot='<p class="panel-intro">A grant goes to the exercise in the group with the fewest grants so far. Ties go to the main lift. The cut mirrors it: it hits the most-grown exercise, ties to the main lift. So the group drifts to its target together instead of one lift ballooning.</p>';
      rot+='<div class="kick">Chest day, empty start. Four grants in a row: Soreness "Never", then 3x "Not enough"</div>';
      rot+='<div class="grid g150" style="gap:9px;margin-top:10px">'+[['Bench Press','Main lift',2,5],['Incline DB','Accessory',1,4],['Cable Fly','Accessory',1,4]].map(function(e){
        return '<div class="inset" style="border-radius:6px"><div style="font-weight:700;font-size:13.5px">'+e[0]+'</div>'+
          '<div style="font-family:var(--f-mono);font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent)">'+e[1]+'</div>'+
          '<div style="display:flex;justify-content:space-between;margin-top:7px;font-family:var(--f-mono);font-size:12px;color:var(--ink-soft)"><span>Grants</span><span style="color:var(--ink);font-weight:600">'+e[2]+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;margin-top:3px;font-family:var(--f-mono);font-size:12px;color:var(--ink-soft)"><span>Sets 3 →</span><span style="color:var(--ok);font-weight:600">'+e[3]+'</span></div></div>';
      }).join('')+'</div>';
      rot+='<p style="font-size:12.5px;color:var(--ink-soft);margin:12px 0 0"><b style="color:var(--ink)">1.</b> Never at a tie → Bench. <b style="color:var(--ink)">2.</b> Not enough → Incline. <b style="color:var(--ink)">3.</b> → Fly. <b style="color:var(--ink)">4.</b> All tied → back to Bench. Result 2, 1, 1: spread, not +4 on one lift.</p>';
      out+=panel(null,'Fair rotation: who gets the +1',null,rot);
      out+='<div class="grid g240" style="margin-top:14px">'+
        '<div class="card"><h3 class="display h3" style="color:var(--ok)">The MRV idea</h3><p style="font-size:14px;color:var(--ink-soft)">No soreness plus a weak pump reads as too little, so add. Still sore plus "pushed" reads as too much, so cut. "Just right" is the productive window: hold. It hunts your maximum recoverable volume.</p></div>'+
        '<div class="card"><h3 class="display h3">Floors and caps</h3><p style="font-size:14px;color:var(--ink-soft)">A set count never seeds below 1, and there is no cap above. An over-grown lift is only pulled back by the cut signals, never by a hard ceiling.</p></div></div>';
    }
    out+='</section>';

    /* 05 weight dial */
    out+='<section class="sec">'+sechead('05 / Dial 2','The weight dial',
      'Two independent halves, both driven by your real reps: the earn ladder (up) and the rep-miss streak (down). Example: range 8 to 12, step 2.5 kg / 5 lbs.');
    /* earn ladder */
    out+='<div class="card"><div class="kick">The staggered earn ladder (per set target)</div>'+
      '<div style="display:flex;align-items:flex-end;gap:12px;padding:26px 4px 4px">'+[[118,12,'Set 1'],[94,10,'Set 2'],[70,8,'Set 3']].map(function(b){
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px">'+
          '<div style="width:100%;max-width:58px;height:'+b[0]+'px;border-radius:4px 4px 0 0;background:linear-gradient(180deg,var(--accent),var(--accent-deep));border:0.5px solid color-mix(in srgb,var(--accent) 50%,transparent);border-bottom:none;position:relative">'+
          '<div style="position:absolute;top:-22px;left:0;right:0;text-align:center;font-family:var(--f-mono);font-weight:700;font-size:13px;color:var(--ink)">'+b[1]+'</div></div>'+
          '<div style="font-family:var(--f-mono);font-size:10px;letter-spacing:0.05em;text-transform:uppercase;color:var(--ink-faint)">'+b[2]+'</div></div>';
      }).join('')+'</div>'+
      '<div style="display:flex;justify-content:space-between;font-family:var(--f-mono);font-size:10px;color:var(--ink-faint);margin-top:6px"><span>top = 12</span><span>bottom = 8</span></div>'+
      '<p style="font-size:12.5px;color:var(--ink-soft);margin:10px 0 0">Set 1 must reach the top, the last only the bottom, staggered in between. A strong first set with fading later sets still qualifies. Not "all at the top". A single set has to hit the range midpoint (10), and it is not exempt from the miss check below.</p></div>';
    /* bump gate */
    var gates=[
      ['1 · Reps','Every set clears its staggered ladder target.'],
      ['2 · Joint','Answer was "None".'],
      ['3 · Pump','"Moderate" or "Amazing".'],
      ['4 · Weight feel','Anything but "Too heavy" ("Hard" still counts).']
    ];
    if(isB) gates.push(['5 · Soreness','Muscle is not "Still sore".']);
    var gate='<p class="panel-intro">A weight bump (+2.5 kg / 5 lbs, equipment dependent) needs all of these, re-earned every session. On a jump the reps reset to the range floor.</p>';
    gate+='<div class="grid g150">'+gates.map(function(g){
      return '<div class="inset" style="border-radius:6px"><div style="font-family:var(--f-mono);font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ok);margin-bottom:5px">'+g[0]+'</div><div style="font-size:12.5px;color:var(--ink-soft)">'+g[1]+'</div></div>';
    }).join('')+'</div>';
    if(isB) gate+='<p style="font-size:12.5px;color:var(--ink-soft);margin:12px 0 0">Reps, Joint, Pump and Weight feel are all judged <b style="color:var(--ink)">per exercise</b>, so each lift earns or holds its own weight. Soreness applies to the whole <b style="color:var(--ink)">muscle group</b>.</p>';
    if(!isB) gate+='<p style="font-size:12.5px;color:var(--ink-soft);margin:12px 0 0">All four are judged <b style="color:var(--ink)">per exercise</b>. Soreness is not among them here: in this mode it moves your <b style="color:var(--ink)">sets</b> instead (still sore = one set off the most-grown lift). It only holds the weight in Load only.</p>';
    out+='<div style="margin-top:14px">'+panel(null,'Bump: '+(isB?'five':'four')+' green lights',null,gate)+'</div>';
    out+='<div class="grid g240" style="margin-top:14px">'+
      '<div class="card"><h3 class="display h3">Between jumps: +1 rep</h3><p style="font-size:14px;color:var(--ink-soft)">With no jump due, the app seeds the rep target +1 higher each session, capped at the range top, same weight. That is the rep climb you feel.</p></div>'+
      '<div class="card"><h3 class="display h3" style="color:var(--danger)">Cut: two failed sessions</h3><p style="font-size:14px;color:var(--ink-soft)">An early set below the range floor starts a streak (the last set is exempt when there are 2+ sets; a single set counts directly). Two in a row cut the weight one increment (2.5 kg / 5 lbs).</p></div></div>';
    out+='<div class="card lb accented" style="margin-top:14px"><div class="kick" style="color:var(--accent)">How it seeds next time</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>Cut</b> overrides an increase. <b>Bump granted</b> means up, reps back to the floor. <b>Bump withheld</b> (a light red) holds the weight while the reps keep climbing. '+(isC?'The only exception is the very first week of your first block: no feedback exists yet, so Smart Progression is allowed through until week 2.':'The only exception is the very first week after enabling it: no feedback exists yet, so Smart Progression is allowed through until the first feedback session lands.')+'</div></div>';
    out+='</section>';

    /* 06 mesocycle (C only) */
    if(isC){
      out+='<section class="sec">'+sechead('06 / Block','The mesocycle structure','What a fixed block adds on top of the both-dials engine: a weekly intensity ramp, a frozen final week, a completion offer, and carryover into the next block.','Mesocycle only');
      out+='<div class="grid g260" style="align-items:start">';
      out+='<div class="card"><div class="kick">RIR taper: 5 week block, 3 → 0</div>'+
        '<svg viewBox="0 0 360 200" style="display:block;width:100%;height:auto;margin-top:6px" role="img" aria-label="RIR taper line chart from 3 down to 0">'+
        '<line x1="40" y1="40" x2="330" y2="40" stroke="var(--hair)" stroke-width="1"/>'+
        '<line x1="40" y1="80" x2="330" y2="80" stroke="var(--hair)" stroke-width="1"/>'+
        '<line x1="40" y1="120" x2="330" y2="120" stroke="var(--hair)" stroke-width="1"/>'+
        '<line x1="40" y1="160" x2="330" y2="160" stroke="var(--hair-strong)" stroke-width="1"/>'+
        '<line x1="40" y1="30" x2="40" y2="160" stroke="var(--hair-strong)" stroke-width="1"/>'+
        '<polygon points="55,45 120,85 185,85 250,125 315,160 315,160 55,160" fill="color-mix(in srgb,var(--accent) 14%,transparent)"/>'+
        '<polyline points="55,45 120,85 185,85 250,125 315,160" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'+
        [[55,45,3],[120,85,2],[185,85,2],[250,125,1],[315,160,0]].map(function(p){
          return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4.5" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>'+
            '<text x="'+p[0]+'" y="'+(p[1]-10)+'" text-anchor="middle" fill="var(--ink)" style="font-family:var(--f-mono);font-size:11px;font-weight:700">'+p[2]+'</text>';
        }).join('')+
        ['W1','W2','W3','W4','W5'].map(function(w,i){return '<text x="'+(55+i*65)+'" y="176" text-anchor="middle" fill="var(--ink-faint)" style="font-family:var(--f-mono);font-size:10px">'+w+'</text>';}).join('')+
        '<text x="4" y="45" fill="var(--ink-faint)" style="font-family:var(--f-mono);font-size:10px">easy</text>'+
        '<text x="2" y="160" fill="var(--ink-faint)" style="font-family:var(--f-mono);font-size:10px">fail</text>'+
        '</svg>'+
        '<p style="font-size:12px;color:var(--ink-soft);margin:8px 0 0">RIR is reps in reserve. The target drops linearly and rounds to whole numbers (so weeks 2 and 3 can share a value). A negative end value prescribes lengthened partials past failure.</p></div>';
      out+='<div class="grid">'+
        stat('Final week','Sets freeze','var(--accent)','Soreness is not asked; joint and pump/volume still are, because the weight keeps moving into the next block.')+
        stat('On completion','Deload offer',null,'Finishing the last week offers a deload, then the next block (weights carry, sets reset).')+
        stat('Badge','MESO C3/5 · 2 RIR',null,'Block number, week in block, and this week’s RIR target, on the plan card.')+
        '</div>';
      out+='</div>';
      out+='<div class="grid g260" style="margin-top:14px">'+
        '<div class="card"><h3 class="display h3">How the week advances</h3><p style="font-size:14px;color:var(--ink-soft)">The week tracks fatigue, so the rule depends on your plan type. <b style="color:var(--ink)">Flex plans</b> count your trained, non-deload sessions (skipping does not advance). <b style="color:var(--ink)">Date and weekday plans</b> count calendar time minus paused recovery days, so an ordinary rest day still moves the clock. Sick and deload days always freeze it; a vacation day freezes it only if you did not train.</p></div>'+
        '<div class="card"><h3 class="display h3">Carryover into the next block</h3><p style="font-size:14px;color:var(--ink-soft)"><b style="color:var(--ink)">Carries:</b> your earned weights and the rep-miss streak. <b style="color:var(--ink)">Resets:</b> all set counts, the joint and low-pump flags, the rotation counters, and the RIR taper. So block two starts at the weights you earned but your original set counts.</p></div></div>';
      out+='<div class="card lb accented" style="margin-top:14px"><div class="kick" style="color:var(--accent)">Completion offer chain</div>'+
        '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)"><b>1.</b> "Start deload?" (or skip). <b>2.</b> "Start the next block? Weights carry over, sets reset." <b>3.</b> Or keep the plan running as a plain cycle, or deactivate it.</div></div>';
      out+='</section>';
    }

    /* 07 deloads */
    out+='<section class="sec">'+sechead('07 / Deloads','Deloads in this mode',
      isC?'A bounded block ends in its own planned deload offer. It does not get the generic 8 week nudge (it has its own end), but you can still start a manual deload anytime.'
      :'Open-ended plans have no built-in end, so their automatic deload is a generic nudge after roughly 8 weeks of training, plus a manual deload you can start anytime.');
    out+='<div class="grid g240" style="margin-bottom:14px">'+
      '<div class="card lb accented"><h3 class="display h3">'+(isC?'1 · Planned end-of-block':'1 · The 8 week nudge')+'</h3><p style="font-size:14px;color:var(--ink-soft)">'+(isC?'Finishing the final week pops "Mesocycle complete! Start deload?". Taking it runs one light week, then offers the next block. Unique to bounded blocks.':'After about 8 weeks of training since your last deload (counted by sessions, weeks, or cycles depending on plan type), the app offers "Start deload". Take it or dismiss it.')+'</p></div>'+
      '<div class="card lb-faint"><h3 class="display h3">2 · Manual, anytime</h3><p style="font-size:14px;color:var(--ink-soft)">The active plan card has a Deload button in every mode. It runs your normal plan at ~50% load for one cycle, then auto-ends.</p></div>'+
      (isC?'':'<div class="card lb accented"><h3 class="display h3">3 · Overreach-driven</h3><p style="font-size:14px;color:var(--ink-soft)">When a muscle hits its learned volume ceiling (see the Landmarks section), the finish screen offers a deload right then, with the reason spelled out. Take it and the block resets: each lift backs off about 2 sets and a fresh block re-ramps. It is a suggestion: wave it off and keep training.</p></div>')+'</div>';
    out+='<div class="card"><h3 class="display h3">What a deload week actually does</h3>'+
      '<div class="grid g240" style="gap:8px 16px;margin-top:6px">'+[
        ['Loads halved','to about 50% (rounded to 2.5). Reps are not reduced. Bodyweight and assisted lifts are not halved.'],
        ['No RIR, no PR, no progression','overlays. It is deliberately light, so no jumps and no regression flags.'],
        ['No feedback collected.','Soreness, joints and pump/volume are all skipped for the week.'],
        ['Progress preserved.','Earned weights and the rep-miss streak carry through, and deload sessions never seed or skew later weeks.']
      ].map(function(d){return '<p style="font-size:13.5px;color:var(--ink-soft)"><b style="color:var(--ink)">'+d[0]+'</b> '+d[1]+'</p>';}).join('')+'</div></div>';
    if(!isC) out+='<div class="card lb-red" style="margin-top:14px"><div class="kick" style="color:var(--danger)">Heads up on the copy</div>'+
      '<div style="margin-top:6px;font-size:13.5px;color:var(--ink-soft)">The plan editor labels Autoregulate as "Open-ended, no deload". That means no <b style="color:var(--ink)">planned</b> block-end deload. You do still get the automatic 8 week nudge and the manual button, so you are not without a deload.</div></div>';
    out+='</section>';

    /* 08 setup */
    out+='<section class="sec">'+sechead('08 / Setup','Turning it on for a plan',
      'Autoregulate and Mesocycle are two mutually exclusive switches in the plan editor (hidden for 5/3/1 plans, which run their own wave).');
    out+='<div class="grid g220">'+
      '<div class="card"><div class="kick" style="color:var(--accent)">Enable this mode</div><p style="font-size:14px;color:var(--ink-soft);margin-top:7px">'+(isC?'Turn on Mesocycle, set the length (4 to 8 weeks) and the RIR ramp (start and end).':'Turn on Autoregulate, then pick '+(isB?'Load only':'Volume + Load')+' in the sub-picker.')+'</p></div>'+
      '<div class="card"><div class="kick">Switching resets state</div><p style="font-size:14px;color:var(--ink-soft);margin-top:7px">Toggling autoregulation, or changing the week count, clears that plan’s saved state. It restarts cleanly, aligned to your next cycle or Monday.</p></div>'+
      '<div class="card"><div class="kick">Enabling mid-plan</div><p style="font-size:14px;color:var(--ink-soft);margin-top:7px">Switch it on over a plan you already trained, and week 1 soreness is asked only for muscles you actually trained before, never one with no history.</p></div></div>';
    out+='</section>';

    /* 09 cheat sheet */
    out+='<section class="sec">'+sechead('09 / Reference','Cheat sheet','Range 8 to 12, 3 sets, step 2.5 kg / 5 lbs. What you log, what comes out.');
    var rows=[
      ['Fully earned','12 / 10 / 8',['bump +2.5, lights green','var(--ok)'],'weight +2.5, reps → 8'],
      ['Feedback blocks','12 / 10 / 8',['no bump (e.g. pump low)','var(--ink-faint)'],'weight holds'],
      ['One early miss','7 / 10 / 8',['miss streak = 1','var(--danger)'],'weight holds, reps +1'],
      ['Second miss in a row','7 / 9 / 8',['streak = 2 → cut -2.5','var(--danger)'],'weight -2.5, reps → 8'],
      ['Only the last set fails','12 / 10 / 6',['last set exempt, no bump','var(--ink-faint)'],'weight + reps hold']
    ];
    out+='<div class="scrollx"><table class="cheat"><thead><tr>'+['What happens','Reps 1/2/3','Result','Next seed'].map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr></thead><tbody>'+
      rows.map(function(r){return '<tr><td style="color:var(--ink-soft)">'+r[0]+'</td><td class="m" style="color:var(--ink)">'+r[1]+'</td><td style="color:'+r[2][1]+';font-weight:600">'+r[2][0]+'</td><td class="m" style="color:var(--ink-soft)">'+r[3]+'</td></tr>';}).join('')+
      '</tbody></table></div>';
    out+='<div class="grid g220" style="margin-top:14px">'+
      '<div class="card"><h3 class="display h3">Weight, one line</h3><p style="font-size:13.5px;color:var(--ink-soft)">Feedback owns the direction. Cut wins. Red holds. Only all-green climbs. Step is one increment (2.5 kg / 5 lbs).</p></div>'+
      '<div class="card"><h3 class="display h3">Volume, one line</h3><p style="font-size:13.5px;color:var(--ink-soft)">'+(isB?'Frozen. Your set counts never change in Load only. The per-exercise weight-feel question only opens or holds the weight gate.':isC?'Recovered or too little adds a set to the least-grown lift. Sore or too much cuts from the most-grown. Frozen in the final week.':'Recovered or too little adds a set to the least-grown lift. Sore or too much cuts from the most-grown. Never below 1, no cap.')+'</p></div>'+
      '<div class="card"><h3 class="display h3">Warnings, one line</h3><p style="font-size:13.5px;color:var(--ink-soft)">Sharp joint pain sets a durable swap warning. Low pump 3 sessions running, or "not my lift" 2 sessions running, suggests swapping the exercise.</p></div></div>';
    out+='<div class="grid g220" style="margin-top:12px">'+
      '<div class="card"><div class="kick">Editing</div><p style="font-size:13.5px;color:var(--ink-soft);margin-top:6px">Any answer is editable until the session ends. Afterward, only your single most recent session of a plan can be corrected.</p></div>'+
      '<div class="card"><div class="kick">Edge cases</div><p style="font-size:13.5px;color:var(--ink-soft);margin-top:6px">Skipped sets count as neither hit nor miss. Unilateral uses the weaker side. Bodyweight is not halved in a deload.</p></div>'+
      '<div class="card"><div class="kick">Not this engine</div><p style="font-size:13.5px;color:var(--ink-soft);margin-top:6px">5/3/1 main lifts climb on their Training Max wave and have their own week 4 deload, separate from all of the above.</p></div></div>';
    out+='</section>';

    return out;
  }

  /* mode selector cards */
  var modegrid=document.getElementById('modegrid');
  ['A','B','C'].forEach(function(k){
    var m=MODE_META[k];
    var b=document.createElement('button');
    b.className='modecard'; b.dataset.mode=k; b.setAttribute('aria-pressed','false');
    b.innerHTML='<span class="mc-rail"></span><span class="mc-dot"></span>'+
      '<div class="mc-tag">'+m.tag+'</div><div class="display mc-nm">'+m.nm+'</div>'+
      '<div class="mc-d">'+m.d+'</div>'+
      '<div class="mc-pills">'+m.pills.map(function(p){return '<span>'+p+'</span>';}).join('')+'</div>';
    b.addEventListener('click',function(){ select(k); });
    modegrid.appendChild(b);
  });

  var guide=document.getElementById('guide'), hint=document.getElementById('hint'), crumb=document.getElementById('crumb');
  function select(M){
    document.querySelectorAll('.modecard').forEach(function(c){
      var on=c.dataset.mode===M; c.classList.toggle('active',on); c.setAttribute('aria-pressed',on?'true':'false');
    });
    hint.style.display='none';
    crumb.innerHTML='Mode: <b>'+MODE_META[M].nm+'</b>';
    guide.innerHTML=guideHTML(M);
    guide.scrollIntoView({block:'start',behavior:'smooth'});
  }

  /* theme toggle */
  document.getElementById('themeBtn').addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme');
    var dark=cur?cur==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme',dark?'light':'dark');
    var tc=document.querySelector('meta[name="theme-color"]');
    if(tc) tc.content=dark?'#e8e1d4':'#141218';
  });

  /* back to top */
  var toTop=document.getElementById('toTop');
  window.addEventListener('scroll',function(){ toTop.classList.toggle('show', window.scrollY>500); },{passive:true});
  toTop.addEventListener('click',function(){ window.scrollTo({top:0,behavior:'smooth'}); });
})();
