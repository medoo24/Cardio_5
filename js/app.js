/* Ischemic Heart Lab application controller. */
(() => {
  "use strict";
  const content = window.IHDContent;
  if (!content) throw new Error("IHDContent failed to load.");

  const KEYS = {
    visited:"ihd-lab-visited-v1", bookmarks:"ihd-lab-bookmarks-v1", rate:"ihd-lab-rate-v1",
    theme:"ihd-lab-theme-v1", quiz:"ihd-lab-quiz-v1"
  };
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$ = (sel,root=document)=>[...root.querySelectorAll(sel)];
  const storage = {
    get(key){try{return localStorage.getItem(key)}catch{return null}},
    set(key,value){try{localStorage.setItem(key,value)}catch{} }
  };
  const readJSON = (key,fallback)=>{try{return JSON.parse(storage.get(key)) ?? fallback}catch{return fallback}};
  const writeJSON = (key,value)=>storage.set(key,JSON.stringify(value));

  const els = {
    nav:$("#course-nav"), app:$("#app-content"), currentLabel:$("#current-section-label"), sidebar:$("#sidebar"), scrim:$("#sidebar-scrim"),
    menu:$("#menu-button"), closeSidebar:$("#sidebar-close"), progressLabel:$("#progress-label"), progressBar:$("#progress-bar"),
    resetProgress:$("#reset-progress"), clearBookmarks:$("#clear-bookmarks"), search:$("#site-search"), searchResults:$("#search-results"),
    voiceStatus:$("#voice-status"), speechRate:$("#speech-rate"), stopSpeech:$("#stop-speech"), print:$("#print-button"), theme:$("#theme-toggle"),
    bookmarksButton:$("#bookmarks-button"), bookmarkDialog:$("#bookmark-dialog"), bookmarkList:$("#bookmark-list"), closeBookmarks:$("#close-bookmarks"), toast:$("#toast")
  };

  const allItems = content.navGroups.flatMap(g=>g.items);
  const state = {
    route:"overview", visited:new Set(readJSON(KEYS.visited,["overview"])), bookmarks:readJSON(KEYS.bookmarks,[]),
    voices:[], voice:null, speechUnit:null, flashcards:[...content.flashcards], filter:"All", caseIndex:0,
    quiz:Object.assign({index:0,score:0,answered:false,finished:false,selected:null},readJSON(KEYS.quiz,{})),
    acsSequence:[]
  };

  function buildNav(){
    els.nav.innerHTML = content.navGroups.map(group=>`<div class="nav-group"><div class="nav-group-title">${group.title}</div>${group.items.map((item,i)=>`<button class="nav-link" type="button" data-route="${item.id}"><span class="nav-index">${String(allItems.indexOf(item)+1).padStart(2,"0")}</span><span>${item.label}</span><span class="nav-mark" aria-hidden="true"></span></button>`).join("")}</div>`).join("");
  }

  function routeFromHash(){
    const id = location.hash.replace(/^#/,"");
    return content.modules[id] ? id : "overview";
  }

  function navigate(route,replace=false){
    if(!content.modules[route]) route="overview";
    if(replace){history.replaceState(null,"",`#${route}`);render(route)} else if(location.hash!==`#${route}`) location.hash=route; else render(route);
  }

  function render(route){
    cancelSpeech();
    state.route=route;
    state.visited.add(route); writeJSON(KEYS.visited,[...state.visited]);
    const mod=content.modules[route];
    els.currentLabel.textContent=mod.title;
    const idx=allItems.findIndex(i=>i.id===route);
    const prev=allItems[idx-1], next=allItems[idx+1];
    els.app.innerHTML=`<div class="content-wrap">${mod.render()}<div class="section route-links" aria-label="Module navigation">${prev?`<button class="route-link" data-route="${prev.id}" type="button">← ${prev.label}</button>`:""}<span style="flex:1"></span>${next?`<button class="route-link" data-route="${next.id}" type="button">${next.label} →</button>`:""}</div></div>`;
    decorateUnits(); bindRouteButtons(); initRoute(route); updateNav(); updateProgress(); closeSidebar();
    document.title=`${mod.title} | Ischemic Heart Lab`;
    requestAnimationFrame(()=>$("#main-content").focus({preventScroll:true}));
    window.scrollTo({top:0,behavior:"instant"});
  }

  function decorateUnits(){
    $$(".tts-unit",els.app).forEach((unit,index)=>{
      const externalToolbar = unit.classList.contains("hero") && unit.nextElementSibling?.classList.contains("module-toolbar");
      if(unit.querySelector(":scope > .module-toolbar") || externalToolbar) return;
      const title=unit.dataset.bookmarkTitle || unit.dataset.ttsLabel || `Study block ${index+1}`;
      const bar=document.createElement("div");
      bar.className="module-toolbar";
      bar.innerHTML=`<span class="pill blue">Study block</span><span class="muted">${title}</span><span class="spacer"></span><button class="speak-button" type="button" aria-label="Read ${title}">▶ Listen</button><button class="bookmark-button" type="button" aria-label="Bookmark ${title}">☆ Save</button>`;
      if(unit.classList.contains("hero")) unit.after(bar); else unit.insertBefore(bar,unit.firstChild);
      $(".speak-button",bar).addEventListener("click",()=>speakUnit(unit));
      $(".bookmark-button",bar).addEventListener("click",()=>toggleBookmark(unit,title));
      syncBookmarkButton(unit);
    });
  }

  function bindRouteButtons(){
    $$('[data-route]',els.app).forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.route)));
  }

  function updateNav(){
    $$(".nav-link",els.nav).forEach(btn=>{
      btn.classList.toggle("active",btn.dataset.route===state.route);
      btn.classList.toggle("visited",state.visited.has(btn.dataset.route));
      if(btn.dataset.route===state.route) btn.setAttribute("aria-current","page"); else btn.removeAttribute("aria-current");
    });
  }
  function updateProgress(){
    const count=allItems.filter(i=>state.visited.has(i.id)).length;
    els.progressLabel.textContent=`${count} / ${allItems.length}`;
    els.progressBar.style.width=`${(count/allItems.length)*100}%`;
  }

  function openSidebar(){els.sidebar.classList.add("open");els.scrim.hidden=false;els.menu.setAttribute("aria-expanded","true")}
  function closeSidebar(){els.sidebar.classList.remove("open");els.scrim.hidden=true;els.menu.setAttribute("aria-expanded","false")}

  function showToast(msg){
    els.toast.textContent=msg;els.toast.hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>els.toast.hidden=true,2200);
  }

  function bookmarkKey(route,title){return `${route}::${title}`}
  function toggleBookmark(unit,title){
    const key=bookmarkKey(state.route,title);const at=state.bookmarks.findIndex(b=>b.key===key);
    if(at>=0){state.bookmarks.splice(at,1);showToast("Bookmark removed")}else{state.bookmarks.push({key,route:state.route,title,module:content.modules[state.route].title});showToast("Bookmarked for revision")}
    writeJSON(KEYS.bookmarks,state.bookmarks);syncBookmarkButton(unit);renderBookmarks();
  }
  function syncBookmarkButton(unit){
    const title=unit.dataset.bookmarkTitle || unit.dataset.ttsLabel;
    const adjacent = unit.classList.contains("hero") && unit.nextElementSibling?.classList.contains("module-toolbar") ? unit.nextElementSibling : null;
    const btn=$(".bookmark-button",unit) || (adjacent ? $(".bookmark-button",adjacent) : null); if(!btn)return;
    const saved=state.bookmarks.some(b=>b.key===bookmarkKey(state.route,title));btn.textContent=saved?"★ Saved":"☆ Save";btn.setAttribute("aria-pressed",String(saved));
  }
  function renderBookmarks(){
    if(!state.bookmarks.length){els.bookmarkList.innerHTML='<div class="bookmark-empty">No saved study blocks yet.</div>';return}
    els.bookmarkList.innerHTML=state.bookmarks.map((b,i)=>`<div class="bookmark-item"><button class="text-button" type="button" data-bookmark-route="${b.route}"><b>${b.title}</b><br><span class="muted">${b.module}</span></button><button class="icon-button" type="button" data-remove-bookmark="${i}" aria-label="Remove bookmark">×</button></div>`).join("");
    $$('[data-bookmark-route]',els.bookmarkList).forEach(btn=>btn.addEventListener("click",()=>{els.bookmarkDialog.close();navigate(btn.dataset.bookmarkRoute)}));
    $$('[data-remove-bookmark]',els.bookmarkList).forEach(btn=>btn.addEventListener("click",()=>{state.bookmarks.splice(Number(btn.dataset.removeBookmark),1);writeJSON(KEYS.bookmarks,state.bookmarks);renderBookmarks();decorateUnits()}));
  }

  function plainText(unit){
    const clone=unit.cloneNode(true); $$("button,script,style,.module-toolbar",clone).forEach(n=>n.remove());
    return clone.innerText.replace(/\s+/g," ").trim();
  }
  function loadVoices(){
    if(!("speechSynthesis" in window)){els.voiceStatus.textContent="TTS unavailable";return}
    state.voices=speechSynthesis.getVoices();
    const preferred=[/Google UK English Female/i,/Microsoft (Sonia|Libby|Hazel)/i,/en-GB.*female/i,/English.*female/i];
    state.voice=null;
    for(const p of preferred){state.voice=state.voices.find(v=>p.test(`${v.name} ${v.lang}`));if(state.voice)break}
    if(!state.voice) state.voice=state.voices.find(v=>v.lang?.toLowerCase().startsWith("en-gb")) || state.voices.find(v=>v.lang?.toLowerCase().startsWith("en")) || null;
    els.voiceStatus.textContent=state.voice?state.voice.name:"System voice";
  }
  function speakUnit(unit){
    if(!("speechSynthesis" in window)){showToast("Text-to-speech is not available in this browser");return}
    if(state.speechUnit===unit && speechSynthesis.speaking){speechSynthesis.pause();showToast("Speech paused");return}
    cancelSpeech(); const text=plainText(unit); if(!text)return;
    const utter=new SpeechSynthesisUtterance(text);utter.lang="en-GB";utter.rate=Number(els.speechRate.value);if(state.voice)utter.voice=state.voice;
    utter.onend=()=>{state.speechUnit=null;const bar=unit.classList.contains("hero")?unit.nextElementSibling:null;const b=$(".speak-button",unit)||(bar?$(".speak-button",bar):null);if(b)b.textContent="▶ Listen"};
    utter.onerror=()=>{state.speechUnit=null}; state.speechUnit=unit; const bar=unit.classList.contains("hero")?unit.nextElementSibling:null;const b=$(".speak-button",unit)||(bar?$(".speak-button",bar):null);if(b)b.textContent="Ⅱ Pause";speechSynthesis.speak(utter);
  }
  function cancelSpeech(){if("speechSynthesis" in window){speechSynthesis.cancel();speechSynthesis.resume()}state.speechUnit=null}

  function search(query){
    const q=query.trim().toLowerCase(); if(!q){els.searchResults.hidden=true;return}
    const hits=content.searchIndex.map(x=>({...x,score:(x.title.toLowerCase().includes(q)?8:0)+(x.text.toLowerCase().includes(q)?3:0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,10);
    els.searchResults.innerHTML=hits.length?hits.map(h=>`<button class="search-hit" type="button" data-search-route="${h.id}"><strong>${h.title}</strong><small>${h.text.replace(/\s+/g," ").slice(0,135)}…</small></button>`).join(""):'<div class="bookmark-empty">No matching module. Try a broader term.</div>';
    els.searchResults.hidden=false;
    $$('[data-search-route]',els.searchResults).forEach(btn=>btn.addEventListener("click",()=>{navigate(btn.dataset.searchRoute);els.search.value="";els.searchResults.hidden=true}));
  }

  function initRoute(route){
    const init={
      "foundations":initSupplyDemand,"atherosclerosis":initPlaque,"stable-angina":initAngina,"investigations":initTests,
      "chronic-treatment":initDrugLab,"revascularization":initRevasc,"special-syndromes":initSpecial,"acs-triage":initACSSequence,
      "stemi":initSTEMI,"nste-acs":initNSTE,"mi-localization":initECG,"complications":initComplications,"post-mi":initDischarge,
      "clinical-lab":initClinicalCases,"flashcards":initFlashcards,"quiz":initQuiz
    }[route]; if(init)init();
  }

  function initSupplyDemand(){
    const ids=["hr","stenosis","hb","sbp"];
    const update=()=>{
      const hr=+$(`#hr-range`).value, sten=+$(`#stenosis-range`).value, hb=+$(`#hb-range`).value, sbp=+$(`#sbp-range`).value;
      $("#hr-output").textContent=`${hr} bpm`;$("#stenosis-output").textContent=`${sten}%`;$("#hb-output").textContent=`${hb} g/dL`;$("#sbp-output").textContent=`${sbp} mmHg`;
      let score=(hr-60)*.65+sten*.7+Math.max(0,11-hb)*9+Math.max(0,sbp-150)*.35+Math.max(0,95-sbp)*.25;
      let label="Low mismatch",note="Supply is likely adequate for the selected demand in this simplified teaching model.";
      if(score>35){label="Moderate mismatch";note="Demand and supply are moving apart. Symptoms may appear when flow reserve is limited."}
      if(score>70){label="High mismatch";note="Several factors simultaneously increase demand or reduce oxygen delivery. This pattern can provoke ischemia even without a new thrombus."}
      $("#ischemia-index").textContent=label;$("#ischemia-explanation").textContent=note;
    };
    ids.forEach(id=>$(`#${id}-range`).addEventListener("input",update));update();
  }
  function initPlaque(){
    const details=[
      ["Endothelial dysfunction","Hypertension, smoking, diabetes, and atherogenic lipoproteins alter endothelial signalling and permeability, encouraging lipoprotein retention and inflammatory-cell recruitment."],
      ["Fatty streak","Modified lipoproteins are ingested by macrophages, creating foam cells. This is an early lesion, not yet necessarily a flow-limiting stenosis."],
      ["Fibrous plaque","Smooth muscle and extracellular matrix form a cap over a lipid-rich core. Progressive plaque can limit flow reserve and produce exertional ischemia."],
      ["Plaque disruption","Rupture or erosion exposes thrombogenic material. A plaque need not have been the tightest stenosis to become the culprit."],
      ["Coronary thrombosis","Platelet activation and thrombin generation create an intermittent, subtotal, or occlusive thrombus, producing unstable angina, NSTEMI, or STEMI."]
    ];
    $$('[data-plaque]').forEach(btn=>btn.addEventListener("click",()=>{const d=details[+btn.dataset.plaque];$$('[data-plaque]').forEach(x=>x.classList.toggle("active",x===btn));$("#plaque-detail").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initAngina(){
    const selected=new Set(); const update=()=>{const n=selected.size;let label=`${n} of 3 criteria`,note="This historical classification describes symptom typicality; it does not diagnose or exclude coronary disease.";if(n===2){label="Atypical angina pattern";note="Two classic criteria are present. Coronary disease remains possible; use clinical likelihood and appropriate testing."}if(n===3){label="Typical angina pattern";note="All three classic features are present, but diagnosis still requires clinical assessment and risk-based investigation."}if(n<=1&&n>0){label="Non-anginal by classic symptom criteria";note="This label does not exclude ischemia, especially when anginal equivalents or atypical presentations are present."}$("#angina-label").textContent=label;$("#angina-note").textContent=note};
    $$('[data-angina-criterion]').forEach(btn=>btn.addEventListener("click",()=>{const k=btn.dataset.anginaCriterion;selected.has(k)?selected.delete(k):selected.add(k);btn.classList.toggle("selected",selected.has(k));update()}));
  }
  function initTests(){
    const map={
      acute:["Serial high-sensitivity troponin + ECG","Use an assay-specific rapid rule-in/rule-out pathway. A troponin rise/fall requires ischemic context to diagnose MI."],
      function:["Resting transthoracic echocardiography","Assesses LV function, regional wall motion, valves, and structural alternatives. A normal rest study does not exclude inducible ischemia."],
      anatomy:["Coronary CT angiography","Defines epicardial anatomy and can exclude obstructive CAD in suitable patients; calcification, fast rhythm, renal dysfunction, and contrast allergy matter."],
      ischemia:["Stress imaging","Demonstrates inducible ischemia and supports risk stratification. Select modality according to ECG, exercise ability, body habitus, renal function, and expertise."],
      lesion:["Invasive physiology: FFR or iFR","Determines whether a specific angiographic stenosis is flow-limiting and likely to benefit from revascularization. It is invasive and should answer a clear question."]
    };
    $$('[data-test-choice]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.testChoice];$$('[data-test-choice]').forEach(x=>x.classList.toggle("selected",x===btn));$("#test-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initDrugLab(){
    const map={pde5:["Avoid nitrate co-administration","Combining nitrates with a recent phosphodiesterase-5 inhibitor can cause profound hypotension."],brady:["Avoid further AV-nodal slowing","A beta-blocker or non-dihydropyridine calcium-channel blocker may worsen severe bradycardia or AV block."],hfrEF:["Avoid a non-dihydropyridine CCB","Verapamil or diltiazem can worsen reduced-EF heart failure through negative inotropy. A dihydropyridine has a different profile."],vasospasm:["Use a calcium-channel blocker; avoid non-selective beta-blockade","Calcium-channel blockers and nitrates are central in vasospastic angina. Non-selective beta-blockade may worsen spasm."],qt:["Use ranolazine cautiously or avoid it","Ranolazine may prolong QT and interacts with several drugs; medication review is essential."]};
    $$('[data-drug-case]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.drugCase];$$('[data-drug-case]').forEach(x=>x.classList.toggle("active",x===btn));$("#drug-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initRevasc(){
    const map={focal:["PCI-leaning pattern","Focal lower-complexity disease and high surgical risk often favor a less invasive PCI strategy, assuming the lesion is significant and technically suitable."],diabetes:["CABG-leaning pattern","Diabetes plus extensive complex multivessel disease often favors CABG when durable complete revascularization is expected."],leftmain:["Heart Team evaluation; often CABG-leaning","Complex left-main anatomy frequently favors surgery, but anatomical complexity, surgical risk, completeness, and current guideline criteria determine whether PCI is a reasonable alternative."],symptoms:["Define anatomy and ischemic significance first","Persistent symptoms despite medical therapy justify re-evaluation and possible angiography, but the revascularization method cannot be chosen before anatomy and physiology are known."],surgery:["CABG-leaning pattern","When another cardiac operation is already required, concomitant surgical grafting may offer the most complete strategy."]};
    $$('[data-revasc]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.revasc];$$('[data-revasc]').forEach(x=>x.classList.toggle("selected",x===btn));$("#revasc-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initSpecial(){
    const map={spasm:["Vasospastic angina","Transient rest-pain episodes with reversible ST change suggest epicardial spasm. Calcium-channel blockers and nitrates are central."],micro:["INOCA / microvascular angina","Objective ischemia without an obstructive epicardial lesion should prompt assessment for coronary microvascular dysfunction and other non-obstructive mechanisms."],minoca:["MINOCA: a working diagnosis","Confirm that MI criteria are met, then investigate plaque disruption, spasm, embolism, dissection, myocarditis, Takotsubo syndrome, and other causes."],dismiss:["Unsafe conclusion","Non-obstructive epicardial arteries do not exclude ischemia. Symptoms should not be dismissed without mechanism-based evaluation."]};
    $$('[data-special]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.special];$$('[data-special]').forEach(x=>x.classList.toggle("selected",x===btn));$("#special-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initACSSequence(){
    const correct=["abc","ecg","aspirin","troponin","strategy"];state.acsSequence=[];
    const update=()=>{$("#acs-sequence-score").textContent=`${state.acsSequence.length} / 5`;const ok=state.acsSequence.every((v,i)=>v===correct[i]);$("#acs-sequence-note").textContent=state.acsSequence.length===5?(ok?"Good sequence. In real care, stability assessment, ECG, IV access, monitoring, and blood sampling often occur in parallel.":"Review the sequence. Start with physiological stability, obtain the ECG rapidly, and never let biomarkers delay an established reperfusion pathway."):"Start with physiological stability, but obtain the ECG in parallel as early as possible."};
    $$('[data-seq]').forEach(btn=>btn.addEventListener("click",()=>{if(btn.disabled)return;state.acsSequence.push(btn.dataset.seq);btn.disabled=true;btn.classList.add(state.acsSequence[state.acsSequence.length-1]===correct[state.acsSequence.length-1]?"correct":"wrong");update()}));
    $("#reset-acs-sequence").addEventListener("click",()=>{$$('[data-seq]').forEach(b=>{b.disabled=false;b.classList.remove("correct","wrong")});state.acsSequence=[];update()});
  }
  function initSTEMI(){
    const update=()=>{const onset=+$("#onset-range").value,pci=+$("#pci-range").value,contra=$("#lysis-contra").checked,ongoing=$("#ongoing-ischemia").checked;$("#onset-output").textContent=`${onset} h`;$("#pci-output").textContent=`${pci} min`;let h="Primary PCI pathway",p="Activate a PCI system promptly. PCI remains the preferred strategy when it can be delivered in an appropriate time frame.";if(!ongoing&&onset>12){h="No automatic late reperfusion";p="Late presentation without ongoing ischemia may not benefit from routine immediate reperfusion; continue comprehensive ACS assessment and evaluate anatomy and complications."}else if(onset<=12&&pci>120&&!contra){h="Consider fibrinolysis, then transfer";p="In a selected early-presenting patient when timely PCI is not achievable and no contraindication exists, immediate fibrinolysis followed by transfer may be appropriate. Local protocols define exact thresholds."}else if(onset<=12&&pci>120&&contra){h="Urgent PCI transfer";p="Fibrinolysis is contraindicated, so organize the fastest safe transfer for primary PCI while providing guideline-directed ACS care."}$("#stemi-result").innerHTML=`<h3>${h}</h3><p>${p}</p>`};
    ["onset-range","pci-range","lysis-contra","ongoing-ischemia"].forEach(id=>$(`#${id}`).addEventListener("input",update));update();
  }
  function initNSTE(){
    const map={shock:["Very high risk: immediate invasive evaluation","Shock, acute HF, and recurrent dynamic ST change require urgent angiography and revascularization planning."],refractory:["Very high risk: immediate invasive evaluation","Recurrent or refractory ischemia with dynamic ST change is an emergency even without persistent ST elevation."],confirmed:["High risk: early inpatient invasive strategy","A confirmed stable NSTEMI with elevated risk generally warrants angiography during hospitalization, with timing individualized."],low:["Structured rule-out and selective testing","Use validated serial hs-cTn, ECG, and risk assessment; arrange further imaging or follow-up according to residual risk."],lysis:["Unsafe: do not use fibrinolysis for NSTE-ACS","A high troponin level does not convert NSTEMI into STEMI. Fibrinolysis is not used without an appropriate acute occlusion pattern."]};
    $$('[data-nste]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.nste];$$('[data-nste]').forEach(x=>x.classList.toggle("selected",x===btn));$("#nste-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initECG(){
    const map={"I":["High lateral territory","Lead I joins aVL for high-lateral assessment; interpret with contiguous leads and reciprocal change."],"II":["Inferior territory","II, III, and aVF form the inferior group, most often supplied by the RCA."],"III":["Inferior territory","ST elevation greater in III than II can support RCA involvement, but full ECG context is required."],"aVR":["Global ischemia / left-main context","aVR is not a simple territorial lead. ST elevation with widespread depression may indicate severe global subendocardial ischemia and demands urgent evaluation."],"aVL":["High lateral territory","I and aVL reflect high-lateral myocardium; reciprocal depression in aVL can accompany inferior MI."],"aVF":["Inferior territory","Interpret with II and III."],"V1":["Septal / posterior reciprocal / RV clues","V1–V2 can show septal injury; ST depression with tall R waves may be reciprocal posterior change."],"V2":["Septal / posterior reciprocal","Use V1–V3 together and consider posterior leads when reciprocal change is suspected."],"V3":["Anterior territory","V3–V4 are central anterior leads; V1–V4 commonly localize LAD territory."],"V4":["Anterior / apical territory","V4 is a key anterior lead; extensive changes may extend across V1–V6 and I/aVL."],"V5":["Lateral territory","V5–V6 join I and aVL for lateral-wall assessment."],"V6":["Lateral territory","Lateral injury often implicates LCx or a diagonal branch."],"V4R":["Right-ventricular territory","ST elevation in V4R supports RV infarction in the setting of inferior MI, usually from proximal RCA occlusion."],"V7–V9":["Posterior territory","Posterior ST elevation confirms posterior injury when V1–V3 show reciprocal ST depression and tall R waves."]};
    $$('[data-lead]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.lead];$$('[data-lead]').forEach(x=>x.classList.toggle("active",x===btn));$("#ecg-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initComplications(){
    const map={pmr:["Papillary-muscle rupture","Acute severe mitral regurgitation causes flash pulmonary edema and shock. Obtain urgent echocardiography and surgical evaluation; a soft murmur does not exclude severity."],vsr:["Ventricular septal rupture","The new harsh pansystolic murmur and thrill reflect an acute septal defect. This is a surgical emergency requiring urgent imaging and hemodynamic support."],fwr:["Free-wall rupture","Tamponade and PEA after MI strongly suggest myocardial free-wall rupture. Immediate resuscitation and surgical response are required."],aneurysm:["True LV aneurysm","Persistent ST elevation, HF, arrhythmia, or embolus weeks later can reflect a scarred dyskinetic aneurysm. Assess LV function and thrombus."],dressler:["Dressler syndrome","A delayed autoimmune pericarditis can cause fever and pleuritic/pericarditic pain weeks after MI; exclude recurrent ischemia and other dangerous causes first."]};
    $$('[data-complication]').forEach(btn=>btn.addEventListener("click",()=>{const d=map[btn.dataset.complication];$$('[data-complication]').forEach(x=>x.classList.toggle("selected",x===btn));$("#complication-result").innerHTML=`<h3>${d[0]}</h3><p>${d[1]}</p>`}));
  }
  function initDischarge(){
    const update=()=>{const n=$$('[data-discharge]:checked').length;$("#discharge-score").textContent=`${n} / 6 complete`;$("#discharge-note").textContent=n===6?"Complete plan: medication, ventricular protection, rehabilitation, lifestyle, follow-up, and safety-netting are all addressed.":"A safe discharge plan is both pharmacological and behavioral."};
    $$('[data-discharge]').forEach(x=>x.addEventListener("change",update));update();
  }
  function initClinicalCases(){
    const renderCase=()=>{const c=content.clinicalCases[state.caseIndex];$("#case-counter").textContent=`Case ${state.caseIndex+1} of ${content.clinicalCases.length}`;$("#clinical-case").innerHTML=`<h3>${c.title}</h3><div class="case-vitals">${c.vitals.map(v=>`<span class="vital">${v}</span>`).join("")}</div><p>${c.stem}</p><p class="quiz-question">${c.question}</p><div class="choice-grid">${c.choices.map((x,i)=>`<button class="choice-button" type="button" data-case-answer="${i}">${x}</button>`).join("")}</div><div class="result-box" id="case-feedback" hidden></div>`;$$('[data-case-answer]').forEach(btn=>btn.addEventListener("click",()=>{const i=+btn.dataset.caseAnswer;$$('[data-case-answer]').forEach((b,j)=>{b.disabled=true;b.classList.toggle("correct",j===c.answer);b.classList.toggle("wrong",j===i&&i!==c.answer)});const f=$("#case-feedback");f.hidden=false;f.innerHTML=`<h3>${i===c.answer?"Correct":"Review the reasoning"}</h3><p>${c.explanation}</p>`}))};
    $("#prev-case").addEventListener("click",()=>{state.caseIndex=(state.caseIndex-1+content.clinicalCases.length)%content.clinicalCases.length;renderCase()});
    $("#next-case").addEventListener("click",()=>{state.caseIndex=(state.caseIndex+1)%content.clinicalCases.length;renderCase()});renderCase();
  }
  function initFlashcards(){
    const tags=["All",...new Set(content.flashcards.map(c=>c.tag))];
    $("#flashcard-filters").innerHTML=tags.map(t=>`<button class="tab-button ${t===state.filter?"active":""}" type="button" data-card-filter="${t}">${t}</button>`).join("");
    const renderCards=()=>{const cards=state.flashcards.filter(c=>state.filter==="All"||c.tag===state.filter);$("#flashcard-count").textContent=`${cards.length} cards`;$("#flashcard-grid").innerHTML=cards.map((c,i)=>`<article class="flashcard" tabindex="0" role="button" aria-pressed="false" aria-label="Flashcard ${i+1}: ${c.q}"><div class="flashcard-inner"><div class="flashcard-face flashcard-front"><span class="flashcard-tag">${c.tag}</span><div class="flashcard-q">${c.q}</div><span class="flashcard-hint">Click or press Enter / Space to flip</span></div><div class="flashcard-face flashcard-back"><span class="flashcard-tag">Answer</span><div class="flashcard-a">${c.a}</div><span class="flashcard-hint">Click again to return</span></div></div></article>`).join("");
      $$(".flashcard").forEach(card=>{const flip=()=>{card.classList.toggle("is-flipped");card.setAttribute("aria-pressed",String(card.classList.contains("is-flipped")))};card.addEventListener("click",flip);card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();flip()}})});
    };
    $$('[data-card-filter]').forEach(btn=>btn.addEventListener("click",()=>{state.filter=btn.dataset.cardFilter;$$('[data-card-filter]').forEach(b=>b.classList.toggle("active",b===btn));renderCards()}));
    $("#shuffle-cards").addEventListener("click",()=>{for(let i=state.flashcards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[state.flashcards[i],state.flashcards[j]]=[state.flashcards[j],state.flashcards[i]]}renderCards();showToast("Flashcards shuffled")});
    $("#reset-cards").addEventListener("click",()=>{$$(".flashcard").forEach(c=>{c.classList.remove("is-flipped");c.setAttribute("aria-pressed","false")})});renderCards();
  }
  function initQuiz(){
    const shell=$("#quiz-shell");
    const save=()=>writeJSON(KEYS.quiz,state.quiz);
    const renderQ=()=>{
      if(state.quiz.finished){const pct=Math.round(state.quiz.score/content.quiz.length*100);shell.innerHTML=`<div style="text-align:center"><p class="eyebrow">Completed</p><h2>Your score</h2><div class="score-ring" style="--score:${pct}%"><strong>${state.quiz.score}/${content.quiz.length}</strong></div><p>${pct>=85?"Excellent integration of mechanisms and management.":pct>=65?"Good foundation. Review missed explanations and repeat the deck.":"Use the module links below to review the weak areas, then retake the quiz."}</p><button class="primary-button" id="restart-quiz" type="button">Restart quiz</button></div>`;$("#restart-quiz").addEventListener("click",()=>{state.quiz={index:0,score:0,answered:false,finished:false,selected:null};save();renderQ()});return}
      const q=content.quiz[state.quiz.index];shell.innerHTML=`<div class="progress-copy"><span>Question ${state.quiz.index+1} of ${content.quiz.length}</span><strong>Score ${state.quiz.score}</strong></div><div class="quiz-progress"><span style="width:${((state.quiz.index)/content.quiz.length)*100}%"></span></div><p class="quiz-question">${q.q}</p><div class="choice-grid">${q.choices.map((c,i)=>`<button class="choice-button" type="button" data-quiz-answer="${i}">${c}</button>`).join("")}</div><div class="result-box" id="quiz-feedback" ${state.quiz.answered?"":"hidden"}></div><div class="quiz-controls"><button class="secondary-button" id="reset-quiz" type="button">Reset</button><button class="primary-button" id="next-quiz" type="button" ${state.quiz.answered?"":"disabled"}>${state.quiz.index===content.quiz.length-1?"Finish":"Next question"}</button></div>`;
      if(state.quiz.answered){applyAnswerUI(q)}
      $$('[data-quiz-answer]').forEach(btn=>btn.addEventListener("click",()=>{if(state.quiz.answered)return;state.quiz.selected=+btn.dataset.quizAnswer;state.quiz.answered=true;if(state.quiz.selected===q.answer)state.quiz.score++;save();applyAnswerUI(q)}));
      $("#next-quiz").addEventListener("click",()=>{if(!state.quiz.answered)return;if(state.quiz.index===content.quiz.length-1){state.quiz.finished=true}else{state.quiz.index++;state.quiz.answered=false;state.quiz.selected=null}save();renderQ()});
      $("#reset-quiz").addEventListener("click",()=>{state.quiz={index:0,score:0,answered:false,finished:false,selected:null};save();renderQ()});
    };
    const applyAnswerUI=q=>{$$('[data-quiz-answer]').forEach((b,i)=>{b.disabled=true;b.classList.toggle("correct",i===q.answer);b.classList.toggle("wrong",i===state.quiz.selected&&state.quiz.selected!==q.answer)});const f=$("#quiz-feedback");f.hidden=false;f.innerHTML=`<h3>${state.quiz.selected===q.answer?"Correct":"Not quite"}</h3><p>${q.explanation}</p>`;$("#next-quiz").disabled=false};
    renderQ();
  }

  buildNav();
  els.nav.addEventListener("click",e=>{const b=e.target.closest("[data-route]");if(b)navigate(b.dataset.route)});
  window.addEventListener("hashchange",()=>render(routeFromHash()));
  els.menu.addEventListener("click",openSidebar);els.closeSidebar.addEventListener("click",closeSidebar);els.scrim.addEventListener("click",closeSidebar);
  els.resetProgress.addEventListener("click",()=>{state.visited=new Set([state.route]);writeJSON(KEYS.visited,[state.route]);updateNav();updateProgress();showToast("Progress reset")});
  els.clearBookmarks.addEventListener("click",()=>{state.bookmarks=[];writeJSON(KEYS.bookmarks,[]);renderBookmarks();decorateUnits();showToast("Bookmarks cleared")});
  els.bookmarksButton.addEventListener("click",()=>{renderBookmarks();els.bookmarkDialog.showModal()});els.closeBookmarks.addEventListener("click",()=>els.bookmarkDialog.close());
  els.search.addEventListener("input",()=>search(els.search.value));document.addEventListener("click",e=>{if(!e.target.closest(".search-box")&&!e.target.closest(".search-results"))els.searchResults.hidden=true});
  document.addEventListener("keydown",e=>{if(e.key==="/"&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault();els.search.focus()}if(e.key==="Escape"){els.searchResults.hidden=true;closeSidebar();if(els.bookmarkDialog.open)els.bookmarkDialog.close();cancelSpeech()}});
  els.speechRate.value=storage.get(KEYS.rate)||"0.92";els.speechRate.addEventListener("change",()=>storage.set(KEYS.rate,els.speechRate.value));els.stopSpeech.addEventListener("click",cancelSpeech);els.print.addEventListener("click",()=>window.print());
  const savedTheme=storage.get(KEYS.theme)||"light";document.documentElement.dataset.theme=savedTheme;els.theme.addEventListener("click",()=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;storage.set(KEYS.theme,next)});
  if("speechSynthesis" in window){speechSynthesis.onvoiceschanged=loadVoices;loadVoices()}
  renderBookmarks();
  navigate(routeFromHash(),true);
})();
