
/* Basic single-file web app (no backend). */
const $ = (id)=>document.getElementById(id);

const state = {
  selectedStages: new Set(),
  classCounts: {},
  teachers: [],
  assignments: null,
  schedule: null,
  standby: {},
};

function uid(prefix){ return prefix + Math.random().toString(16).slice(2,10); }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function addAlert(msg, kind="warn"){
  const wrap = $("alerts");
  const badge = kind==="ok"?"ok":(kind==="bad"?"bad":"warn");
  wrap.innerHTML += `<div class="alert"><span class="badge ${badge}">${kind==="ok"?"تم":(kind==="bad"?"تنبيه":"ملاحظة")}</span> ${escapeHtml(msg)}</div>`;
}
function clearAlerts(){ $("alerts").innerHTML=""; }

// UI: stages
function renderStages(){
  const wrap = $("stages");
  wrap.innerHTML = STAGES.map(s=>`
    <label class="card" style="margin:0">
      <div class="row">
        <input type="checkbox" data-stage="${s.id}" />
        <div>
          <div><strong>${s.name}</strong></div>
          <div class="hint">يظهر الصفوف المتاحة بعد الاختيار</div>
        </div>
      </div>
    </label>
  `).join("");
  wrap.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const id = cb.dataset.stage;
      if(cb.checked) state.selectedStages.add(id); else state.selectedStages.delete(id);
      renderGradesConfig();
    });
  });
}
function gradeLabel(stageId, grade){
  const g = Number(grade);
  return stageId.startsWith("prim") ? `الصف ${g} ابتدائي` : `الصف ${g} متوسط`;
}
function renderGradesConfig(){
  const wrap = $("gradesConfig");
  let html = "";
  for(const sid of state.selectedStages){
    const grades = Object.keys(CURRICULUM[sid] || {});
    html += `<div class="card" style="margin:10px 0">
      <div class="row"><strong>${STAGES.find(x=>x.id===sid)?.name||sid}</strong></div>
      <table>
        <thead><tr><th>الصف</th><th>عدد الفصول</th><th>إجمالي الحصص/فصل</th></tr></thead>
        <tbody>
        ${grades.map(g=>{
          const key = `${sid}:${g}`;
          const val = state.classCounts[key] ?? 0;
          const tot = CURRICULUM[sid][g].total;
          return `<tr>
            <td>${gradeLabel(sid,g)}</td>
            <td><input type="number" min="0" max="30" value="${val}" data-grade="${key}" style="width:90px" /></td>
            <td>${tot}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>
    </div>`;
  }
  wrap.innerHTML = html || `<div class="hint">اختر مرحلة لعرض الصفوف.</div>`;
  wrap.querySelectorAll("input[data-grade]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      state.classCounts[inp.dataset.grade] = Number(inp.value||0);
      refreshSectionSelect();
    });
  });
  refreshSectionSelect();
}

// Teachers
function specSelectOptions(){
  $("tSpec").innerHTML = SPEC_OPTIONS.map(s=>`<option>${s}</option>`).join("");
}
function renderTeachers(){
  const wrap = $("teachersTable");
  if(state.teachers.length===0){
    wrap.innerHTML = `<div class="hint">لم يتم إضافة معلمين بعد.</div>`;
    refreshTeacherSelect();
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>#</th><th>الاسم</th><th>التخصص</th><th>النصاب</th><th class="no-print">حذف</th></tr></thead>
    <tbody>
      ${state.teachers.map((t,i)=>`<tr>
        <td>${i+1}</td>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.spec)}</td>
        <td>${t.max}</td>
        <td class="no-print"><button class="btn btn-danger" data-del="${t.id}">حذف</button></td>
      </tr>`).join("")}
    </tbody>
  </table>`;
  wrap.querySelectorAll("button[data-del]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.del;
      state.teachers = state.teachers.filter(x=>x.id!==id);
      delete state.standby[id];
      state.assignments=null; state.schedule=null;
      renderTeachers();
      renderAssignmentSummary();
      renderStandbyConfig();
    });
  });
  refreshTeacherSelect();
}
function refreshTeacherSelect(){
  const sel = $("teacherSelect");
  sel.innerHTML = `<option value="">-- اختر --</option>` + state.teachers.map(t=>`<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.spec)})</option>`).join("");
}

// Sections meta
function buildSectionsMeta(){
  const out = [];
  for(const [k,n] of Object.entries(state.classCounts)){
    const count = Number(n||0);
    if(count<=0) continue;
    const [sid, grade] = k.split(":");
    for(let i=1;i<=count;i++){
      const total = CURRICULUM[sid][grade].total;
      out.push({
        key:`${sid}:${grade}:${i}`,
        label:`${STAGES.find(x=>x.id===sid)?.name||sid} - ${gradeLabel(sid,grade)} / ${i}`,
        stageId:sid, grade, sectionNo:i, total
      });
    }
  }
  out.sort((a,b)=>a.key.localeCompare(b.key));
  return out;
}
function refreshSectionSelect(){
  const sel = $("sectionSelect");
  const secs = buildSectionsMeta();
  sel.innerHTML = `<option value="">-- اختر --</option>` + secs.map(s=>`<option value="${s.key}">${escapeHtml(s.label)}</option>`).join("");
}
function sectionLabel(sectionKey){
  const [sid,grade,sec] = sectionKey.split(":");
  return `${STAGES.find(x=>x.id===sid)?.name||sid} - ${gradeLabel(sid,grade)} / ${sec}`;
}

// Demand
function computeDemand(){
  const sections = buildSectionsMeta();
  const perSection = {};
  for(const s of sections){
    const cur = CURRICULUM[s.stageId][s.grade].hours;
    perSection[s.key] = Object.entries(cur).map(([subj,hrs])=>({subject:subj, hours:hrs}));
  }
  return {sections, perSection};
}

// Assignment engine
function assignSubjects(){
  clearAlerts();
  const {sections, perSection} = computeDemand();
  if(sections.length===0){ addAlert("اختر مراحل وأدخل عدد الفصول أولاً.","bad"); return; }
  if(state.teachers.length===0){ addAlert("أضف المعلمين أولاً.","bad"); return; }

  const remaining = {};
  for(const t of state.teachers) remaining[t.id]=t.max;

  const byTeacher = {};
  const bySection = {};
  const unassigned = [];

  for(const s of sections){
    const sk = s.key;
    bySection[sk]=[];
    const needs = perSection[sk].slice().sort((a,b)=>b.hours-a.hours);
    for(const need of needs){
      let left = need.hours;
      const prefs = SUBJECT_PREFS[need.subject] || [];
      const primary = state.teachers.filter(t=>prefs.includes(t.spec)).sort((a,b)=>(remaining[b.id]-remaining[a.id]));
      const fallback = state.teachers.filter(t=>remaining[t.id]>0).sort((a,b)=>(remaining[b.id]-remaining[a.id]));
      for(const pool of [primary, fallback]){
        for(const t of pool){
          if(left<=0) break;
          const can = Math.min(left, remaining[t.id]);
          if(can<=0) continue;
          remaining[t.id]-=can; left-=can;
          bySection[sk].push({subject:need.subject, teacherId:t.id, hours:can});
          if(!byTeacher[t.id]) byTeacher[t.id]={teacher:t, items:[]};
          byTeacher[t.id].items.push({sectionKey:sk, subject:need.subject, hours:can});
        }
        if(left<=0) break;
      }
      if(left>0) unassigned.push({sectionKey:sk, subject:need.subject, hours:left});
    }
  }

  state.assignments = {byTeacher, bySection, unassigned, remaining};
  state.schedule=null;
  renderAssignmentSummary();
  renderStandbyConfig();
  renderScheduleViews();
  addAlert("تم إنشاء الإسناد. حدّد الانتظار ثم أنشئ الجدول.","ok");
}

function renderAssignmentSummary(){
  const wrap = $("assignmentSummary");
  if(!state.assignments){ wrap.innerHTML = `<div class="hint">لم يتم الإسناد بعد.</div>`; $("unassignedSummary").innerHTML=""; return; }
  const {byTeacher, remaining} = state.assignments;
  const rows = state.teachers.map(t=>{
    const items = byTeacher[t.id]?.items || [];
    const load = items.reduce((s,x)=>s+x.hours,0);
    const rem = remaining[t.id] ?? (t.max-load);
    const subjects = {};
    for(const it of items) subjects[it.subject]=(subjects[it.subject]||0)+it.hours;
    const subjStr = Object.entries(subjects).sort((a,b)=>b[1]-a[1]).map(([s,h])=>`${s} (${h})`).join("، ");
    return `<tr>
      <td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.spec)}</td><td>${t.max}</td><td>${load}</td><td>${rem}</td>
      <td style="text-align:right">${escapeHtml(subjStr||"-")}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table>
    <thead><tr><th>المعلم</th><th>التخصص</th><th>النصاب</th><th>المسند</th><th>المتبقي</th><th>تفاصيل</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  // unassigned
  const un = state.assignments.unassigned || [];
  const uwrap = $("unassignedSummary");
  if(un.length===0){ uwrap.innerHTML = `<div class="badge ok">لا توجد حصص غير مسندة</div>`; }
  else{
    const rows2 = un.map(u=>`<tr><td>${escapeHtml(sectionLabel(u.sectionKey))}</td><td>${escapeHtml(u.subject)}</td><td>${u.hours}</td></tr>`).join("");
    uwrap.innerHTML = `<div class="badge warn">يوجد عجز/حصص غير مسندة</div>
      <table><thead><tr><th>الفصل</th><th>المادة</th><th>حصص</th></tr></thead><tbody>${rows2}</tbody></table>`;
  }
}

// Standby config
function renderStandbyConfig(){
  const wrap = $("standbyConfig");
  if(!state.assignments){ wrap.innerHTML = `<div class="hint">نفّذ الإسناد أولاً.</div>`; $("standbyReports").innerHTML=""; return; }
  const {remaining} = state.assignments;
  const rows = state.teachers.map(t=>{
    const rem = remaining[t.id] ?? 0;
    const val = Number(state.standby[t.id]||0);
    return `<tr>
      <td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.spec)}</td><td>${t.max}</td><td>${t.max-rem}</td><td>${rem}</td>
      <td><input type="number" min="0" max="${rem}" value="${val}" data-standby="${t.id}" style="width:90px"/></td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table>
    <thead><tr><th>المعلم</th><th>التخصص</th><th>النصاب</th><th>المسند</th><th>المتبقي</th><th>انتظار</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="no-print"><button id="btnApplyStandby" class="btn">تطبيق الانتظار</button></div>`;
  wrap.querySelectorAll("input[data-standby]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const tid = inp.dataset.standby;
      const max = Number(inp.max||0);
      let v = Number(inp.value||0);
      if(isNaN(v)) v=0;
      v = Math.max(0, Math.min(max, v));
      inp.value = v;
      state.standby[tid]=v;
    });
  });
  $("btnApplyStandby").onclick = ()=>{
    addAlert("تم حفظ حصص الانتظار.","ok");
    renderStandbyReports();
  };
  renderStandbyReports();
}
function renderStandbyReports(afterSchedule=false){
  const wrap = $("standbyReports");
  if(!state.assignments){ wrap.innerHTML=""; return; }
  const placed = afterSchedule ? (state.schedule?.standbyPlaced||{}) : {};
  const rows = state.teachers.map(t=>{
    const des = Number(state.standby[t.id]||0);
    const plc = afterSchedule ? (placed[t.id]||0) : "";
    const rem = afterSchedule ? Math.max(0, des-(placed[t.id]||0)) : "";
    const status = afterSchedule ? `<span class="badge ${(plc===des)?"ok":"warn"}">${(plc===des)?"مكتمل":"غير مكتمل"}</span>` : "";
    return `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.spec)}</td><td>${des}</td>${afterSchedule?`<td>${plc}</td><td>${rem}</td><td>${status}</td>`:""}</tr>`;
  }).join("");
  wrap.innerHTML = afterSchedule
    ? `<table><thead><tr><th>المعلم</th><th>التخصص</th><th>مطلوب</th><th>مجدول</th><th>متبقي</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<table><thead><tr><th>المعلم</th><th>التخصص</th><th>انتظار مطلوب</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Scheduling
function emptySectionGrid(total){
  const lens = dayLengthsForTotal(total);
  const grid = [];
  for(let d=0;d<5;d++){
    const row = new Array(7).fill(null);
    for(let p=0;p<7;p++){
      row[p] = (p<lens[d]) ? "" : null;
    }
    grid.push(row);
  }
  return {grid,lens};
}
function buildSchedule(){
  clearAlerts();
  if(!state.assignments){ addAlert("نفّذ الإسناد أولاً.","bad"); return; }
  const sections = buildSectionsMeta();
  if(sections.length===0){ addAlert("لا توجد فصول.","bad"); return; }

  // teacher occupancy
  const teacherOcc = {};
  for(const t of state.teachers){
    teacherOcc[t.id]=Array.from({length:5},()=>Array(7).fill(null)); // null free, else sectionKey or STANDBY
  }

  // lessons per section expanded
  const lessonsBySection = {};
  for(const s of sections){
    const ass = state.assignments.bySection[s.key] || [];
    const expanded = [];
    for(const it of ass){
      for(let i=0;i<it.hours;i++) expanded.push({subject:it.subject, teacherId:it.teacherId});
    }
    const un = (state.assignments.unassigned||[]).filter(u=>u.sectionKey===s.key);
    for(const u of un){
      for(let i=0;i<u.hours;i++) expanded.push({subject:u.subject, teacherId:null});
    }
    // order by frequency desc
    const freq = {};
    for(const l of expanded) freq[l.subject]=(freq[l.subject]||0)+1;
    expanded.sort((a,b)=>(freq[b.subject]-freq[a.subject]));
    lessonsBySection[s.key]=expanded;
  }

  function weeklyHours(sectionKey){
    const [sid,grade]=sectionKey.split(":");
    return CURRICULUM[sid][grade].hours;
  }

  function canPlace(sectionKey, grid, lens, day, period, lesson){
    if(grid[day][period] !== "") return false;
    if(lesson.teacherId && teacherOcc[lesson.teacherId][day][period] !== null) return false;

    const subj = lesson.subject;
    if(CONSTRAINTS.noConsecutive.has(subj)){
      const left = period>0 ? grid[day][period-1] : null;
      const right = period<6 ? grid[day][period+1] : null;
      if(left && left.subject===subj) return false;
      if(right && right.subject===subj) return false;
    }
    if(CONSTRAINTS.maxConsecutive2.has(subj)){
      const p0 = period-2>=0 ? grid[day][period-2] : null;
      const p1 = period-1>=0 ? grid[day][period-1] : null;
      const p2 = period+1<=6 ? grid[day][period+1] : null;
      const p3 = period+2<=6 ? grid[day][period+2] : null;
      if(p0 && p1 && p0.subject===subj && p1.subject===subj) return false;
      if(p1 && p2 && p1.subject===subj && p2.subject===subj) return false;
      if(p2 && p3 && p2.subject===subj && p3.subject===subj) return false;
    }
    const wh = weeklyHours(sectionKey);
    const weekly = wh[subj];
    if(CONSTRAINTS.noRepeatIfWeeklyLE5 && weekly!==undefined && weekly<=5){
      for(let p=0;p<lens[day];p++){
        const c = grid[day][p];
        if(c && c.subject===subj) return false;
      }
    }
    return true;
  }

  function scoreSlot(grid, day, period, lesson){
    let sc=0;
    const subj=lesson.subject;
    // avoid always same period
    let same=0;
    for(let d=0;d<5;d++){
      const c = grid[d][period];
      if(c && c.subject===subj) same++;
    }
    sc -= same*2;
    // slight preference to fill earlier to reduce leftover
    sc += (6-period)*0.05;
    return sc;
  }

  const sectionSchedules = {};
  const unscheduled = [];

  for(const s of sections){
    const {grid,lens} = emptySectionGrid(s.total);
    for(const lesson of lessonsBySection[s.key]){
      let best=null;
      for(let d=0;d<5;d++){
        for(let p=0;p<7;p++){
          if(p>=lens[d]) continue;
          if(!canPlace(s.key,grid,lens,d,p,lesson)) continue;
          const sc = scoreSlot(grid,d,p,lesson);
          if(!best || sc>best.sc) best={d,p,sc};
        }
      }
      if(best){
        grid[best.d][best.p]={subject:lesson.subject, teacherId:lesson.teacherId};
        if(lesson.teacherId) teacherOcc[lesson.teacherId][best.d][best.p]=s.key;
      }else{
        unscheduled.push({sectionKey:s.key, subject:lesson.subject, teacherId:lesson.teacherId});
      }
    }
    sectionSchedules[s.key]={meta:s,grid,lens};
  }

  // derive global lens (school day)
  const globalLens = sections.some(x=>x.total===33) ? [7,7,7,6,6] : [7,7,7,7,7];

  // place standby inside teacher grids, last periods first, respecting globalLens
  const standbyPlaced = {};
  for(const t of state.teachers){
    let desired = Number(state.standby[t.id]||0);
    standbyPlaced[t.id]=0;
    if(desired<=0) continue;
    const dayOrder=[4,3,2,1,0];
    const periodOrder=[6,5,4,3,2,1,0];
    for(const d of dayOrder){
      for(const p of periodOrder){
        if(desired<=0) break;
        if(p>=globalLens[d]) continue;
        if(teacherOcc[t.id][d][p]!==null) continue;
        teacherOcc[t.id][d][p]=SUBJECTS.STANDBY;
        desired--; standbyPlaced[t.id]++;
      }
      if(desired<=0) break;
    }
  }

  // build teacher printable grids
  const teacherSchedules = {};
  for(const t of state.teachers){
    const g = Array.from({length:5},(_,d)=>Array.from({length:7},(_,p)=>{
      const v = teacherOcc[t.id][d][p];
      return v===null ? "" : v;
    }));
    teacherSchedules[t.id]={teacher:t, grid:g};
  }

  state.schedule={sections:sectionSchedules, teachers:teacherSchedules, unscheduled, standbyPlaced, globalLens};
  renderScheduleViews();
  renderStandbyReports(true);
  if(unscheduled.length) addAlert(`تعذر جدولة ${unscheduled.length} حصة بسبب القيود/التعارضات. راجع تقرير التعذر.`, "warn");
  else addAlert("تم إنشاء الجدول المبدئي بدون حصص متعذرة.","ok");
}

function renderScheduleViews(){
  $("sectionTables").innerHTML="";
  $("teacherTables").innerHTML="";
  refreshSectionSelect();
  refreshTeacherSelect();
}

function renderSectionTable(sec){
  const {meta,grid,lens}=sec;
  const head = `<div class="row"><strong>${escapeHtml(meta.label)}</strong> <span class="badge">${meta.total} حصة</span></div>`;
  const thead = `<thead><tr><th>اليوم/الحصة</th>${Array.from({length:7},(_,i)=>`<th>${i+1}</th>`).join("")}</tr></thead>`;
  const tbody = DAYS.map((day,di)=>{
    const tds = Array.from({length:7},(_,pi)=>{
      if(pi>=lens[di]) return `<td style="background:#fff"></td>`;
      const cell = grid[di][pi];
      if(cell==="") return `<td></td>`;
      const tname = cell.teacherId ? (state.teachers.find(t=>t.id===cell.teacherId)?.name||"") : "غير مسند";
      return `<td><div>${escapeHtml(cell.subject)}</div><div class="hint">${escapeHtml(tname)}</div></td>`;
    }).join("");
    return `<tr><th>${day}</th>${tds}</tr>`;
  }).join("");
  return `${head}<table>${thead}<tbody>${tbody}</tbody></table>`;
}
function renderTeacherTable(tsec){
  const {teacher,grid}=tsec;
  const lens = state.schedule?.globalLens || [7,7,7,7,7];
  const head = `<div class="row"><strong>${escapeHtml(teacher.name)} (${escapeHtml(teacher.spec)})</strong> <span class="badge">نصاب ${teacher.max}</span></div>`;
  const thead = `<thead><tr><th>اليوم/الحصة</th>${Array.from({length:7},(_,i)=>`<th>${i+1}</th>`).join("")}</tr></thead>`;
  const tbody = DAYS.map((day,di)=>{
    const tds = Array.from({length:7},(_,pi)=>{
      if(pi>=lens[di]) return `<td style="background:#fff"></td>`;
      const cell = grid[di][pi];
      if(cell==="") return `<td></td>`;
      if(cell===SUBJECTS.STANDBY) return `<td><div>${SUBJECTS.STANDBY}</div></td>`;
      return `<td><div>${escapeHtml(sectionLabel(cell))}</div></td>`;
    }).join("");
    return `<tr><th>${day}</th>${tds}</tr>`;
  }).join("");
  return `${head}<table>${thead}<tbody>${tbody}</tbody></table>`;
}
function renderUnscheduledTable(list){
  const rows = list.map(u=>{
    const tname = u.teacherId ? (state.teachers.find(t=>t.id===u.teacherId)?.name||"") : "غير مسند";
    return `<tr><td>${escapeHtml(sectionLabel(u.sectionKey))}</td><td>${escapeHtml(u.subject)}</td><td>${escapeHtml(tname)}</td></tr>`;
  }).join("");
  return `<div class="badge warn">تقرير التعذر</div>
    <table><thead><tr><th>الفصل</th><th>المادة</th><th>المعلم</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderOneSection(key){
  const wrap=$("sectionTables");
  if(!state.schedule){ wrap.innerHTML=`<div class="hint">أنشئ الجدول أولاً.</div>`; return; }
  const sec=state.schedule.sections[key];
  if(!sec){ wrap.innerHTML=`<div class="hint">لم يتم العثور على الفصل.</div>`; return; }
  wrap.innerHTML = renderSectionTable(sec);
  const uns = state.schedule.unscheduled.filter(u=>u.sectionKey===key);
  if(uns.length) wrap.innerHTML += renderUnscheduledTable(uns);
}
function renderAllSections(){
  const wrap=$("sectionTables");
  if(!state.schedule){ wrap.innerHTML=`<div class="hint">أنشئ الجدول أولاً.</div>`; return; }
  const secs=Object.values(state.schedule.sections);
  wrap.innerHTML = secs.map(s=>`<div class="schedule-block">${renderSectionTable(s)}</div>`).join("");
}
function renderOneTeacher(tid){
  const wrap=$("teacherTables");
  if(!state.schedule){ wrap.innerHTML=`<div class="hint">أنشئ الجدول أولاً.</div>`; return; }
  const tsec=state.schedule.teachers[tid];
  if(!tsec){ wrap.innerHTML=`<div class="hint">لم يتم العثور على المعلم.</div>`; return; }
  wrap.innerHTML = renderTeacherTable(tsec);
}
function renderAllTeachers(){
  const wrap=$("teacherTables");
  if(!state.schedule){ wrap.innerHTML=`<div class="hint">أنشئ الجدول أولاً.</div>`; return; }
  const ts=Object.values(state.schedule.teachers);
  wrap.innerHTML = ts.map(t=>`<div class="schedule-block">${renderTeacherTable(t)}</div>`).join("");
}

// Export/Import/LocalStorage
function exportState(){
  const payload={v:1, selectedStages:Array.from(state.selectedStages), classCounts:state.classCounts, teachers:state.teachers, standby:state.standby};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="school-data.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  addAlert("تم تصدير البيانات (JSON).","ok");
}
function importState(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const p=JSON.parse(String(reader.result||"{}"));
      state.selectedStages=new Set(p.selectedStages||[]);
      state.classCounts=p.classCounts||{};
      state.teachers=p.teachers||[];
      state.standby=p.standby||{};
      state.assignments=null; state.schedule=null;
      document.querySelectorAll('#stages input[type=checkbox]').forEach(cb=>cb.checked=state.selectedStages.has(cb.dataset.stage));
      renderGradesConfig(); renderTeachers(); renderAssignmentSummary(); renderStandbyConfig(); renderScheduleViews();
      addAlert("تم الاستيراد. نفّذ الإسناد ثم إنشاء الجدول.","ok");
    }catch(e){ addAlert("فشل الاستيراد: ملف غير صالح.","bad"); }
  };
  reader.readAsText(file);
}
function saveLocal(){
  const payload={selectedStages:Array.from(state.selectedStages), classCounts:state.classCounts, teachers:state.teachers, standby:state.standby};
  localStorage.setItem("school_tool_state_v1", JSON.stringify(payload));
  addAlert("تم الحفظ محليًا.","ok");
}
function loadLocal(){
  const raw=localStorage.getItem("school_tool_state_v1");
  if(!raw){ addAlert("لا يوجد حفظ محلي.","warn"); return; }
  try{
    const p=JSON.parse(raw);
    state.selectedStages=new Set(p.selectedStages||[]);
    state.classCounts=p.classCounts||{};
    state.teachers=p.teachers||[];
    state.standby=p.standby||{};
    state.assignments=null; state.schedule=null;
    document.querySelectorAll('#stages input[type=checkbox]').forEach(cb=>cb.checked=state.selectedStages.has(cb.dataset.stage));
    renderGradesConfig(); renderTeachers(); renderAssignmentSummary(); renderStandbyConfig(); renderScheduleViews();
    addAlert("تم الاسترجاع.","ok");
  }catch(e){ addAlert("فشل الاسترجاع.","bad"); }
}
function clearAll(){
  if(!confirm("مسح كل البيانات؟")) return;
  state.selectedStages=new Set(); state.classCounts={}; state.teachers=[]; state.assignments=null; state.schedule=null; state.standby={};
  localStorage.removeItem("school_tool_state_v1");
  document.querySelectorAll('#stages input[type=checkbox]').forEach(cb=>cb.checked=false);
  renderGradesConfig(); renderTeachers(); renderAssignmentSummary(); renderStandbyConfig(); renderScheduleViews();
  clearAlerts(); addAlert("تم مسح البيانات.","ok");
}

// init
function init(){
  specSelectOptions();
  renderStages();
  renderGradesConfig();
  renderTeachers();
  renderAssignmentSummary();
  renderStandbyConfig();
  refreshSectionSelect();
  refreshTeacherSelect();

  $("btnAddTeacher").onclick=()=>{
    const name=$("tName").value.trim();
    const spec=$("tSpec").value;
    const max=Number($("tRank").value);
    if(!name){ alert("أدخل اسم المعلم"); return; }
    state.teachers.push({id:uid("t_"), name, spec, max});
    $("tName").value="";
    state.assignments=null; state.schedule=null;
    renderTeachers(); renderAssignmentSummary(); renderStandbyConfig(); renderScheduleViews();
  };

  $("btnAssign").onclick=assignSubjects;
  $("btnBuildSchedule").onclick=buildSchedule;

  $("btnShowSection").onclick=()=>{
    const key=$("sectionSelect").value; if(!key) return;
    renderOneSection(key);
  };
  $("btnShowAllSections").onclick=renderAllSections;

  $("btnShowTeacher").onclick=()=>{
    const tid=$("teacherSelect").value; if(!tid) return;
    renderOneTeacher(tid);
  };
  $("btnShowAllTeachers").onclick=renderAllTeachers;

  $("btnPrint").onclick=()=>window.print();
  $("btnExport").onclick=exportState;
  $("importFile").addEventListener("change",(e)=>{
    const f=e.target.files?.[0]; if(f) importState(f);
    e.target.value="";
  });
  $("btnSave").onclick=saveLocal;
  $("btnLoad").onclick=loadLocal;
  $("btnClear").onclick=clearAll;
}

document.addEventListener("DOMContentLoaded", init);
