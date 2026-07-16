/* ===========================================================
   旅程帳 - 家庭旅行記帳 App
   本機儲存版（localStorage），架構預留雲端同步擴充空間
   =========================================================== */

const STORAGE_KEY = 'travel_ledger_data_v1';

const CATEGORIES = [
  { id: 'food',      name: '餐飲', icon: '🍜', color: '#C17654' },
  { id: 'transport', name: '交通', icon: '🚄', color: '#5B7C8D' },
  { id: 'stay',      name: '住宿', icon: '🏨', color: '#7A8C5E' },
  { id: 'shopping',  name: '購物', icon: '🛍️', color: '#B08968' },
  { id: 'ticket',    name: '門票', icon: '🎫', color: '#9C7AA8' },
  { id: 'other',     name: '其他', icon: '✦',  color: '#8B8378' },
];

const MEMBER_COLORS = ['#C17654', '#5B7C8D', '#7A8C5E', '#B08968', '#9C7AA8', '#2C3E35'];

let DB = null;
let state = {
  currentScreen: 'dashboard',
  currentItinDate: null, // YYYY-MM-DD，目前檢視的行程日期
  itinSelectMode: false,
  itinSelectedIds: new Set(),
};

/* ---------------- Storage layer ----------------
   之後要接雲端同步時，只需要把 loadDB / saveDB
   換成呼叫 API（例如 Firebase / Supabase），
   其餘畫面邏輯不需更動。
---------------------------------------------------- */
function loadDB() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
  }
  // 初始示範資料結構
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const start = fmt(today);
  const end = fmt(new Date(today.getTime() + 4 * 86400000));
  return {
    members: [
      { id: 'm1', name: '爸爸', color: '#C17654' },
      { id: 'm2', name: '媽媽', color: '#5B7C8D' },
    ],
    trips: [
      { id: 't1', name: '我的旅程', start, end }
    ],
    activeTrip: 't1',
    expenses: [],
    itinerary: [],
  };
}

function saveDB() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
}

/* ---------------- Helpers ---------------- */
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtMoney(n) { return 'NT$ ' + Math.round(n).toLocaleString('zh-Hant'); }
function getCat(id) { return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]; }
function getMember(id) { return DB.members.find(m => m.id === id); }
function activeTrip() { return DB.trips.find(t => t.id === DB.activeTrip) || DB.trips[0]; }
function tripExpenses() {
  return DB.expenses.filter(e => e.tripId === DB.activeTrip);
}
function tripItinerary() {
  return DB.itinerary.filter(i => i.tripId === DB.activeTrip);
}
function tripDayCount() {
  const t = activeTrip();
  if (!t) return 1;
  const s = new Date(t.start), e = new Date(t.end);
  const diff = Math.round((e - s) / 86400000) + 1;
  return Math.max(1, diff || 1);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日（週${weekNames[d.getDay()]}）`;
}
function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtWeekShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const weekNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return weekNames[d.getDay()];
}
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------------- Rendering ---------------- */
function renderAll() {
  renderTripSelect();
  renderDashboard();
  renderLedger();
  renderItinerary();
  renderSettings();
}

function renderTripSelect() {
  const sel = document.getElementById('tripSelect');
  sel.innerHTML = DB.trips.map(t => `<option value="${t.id}" ${t.id === DB.activeTrip ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
}

function renderDashboard() {
  const exps = tripExpenses();
  const total = exps.reduce((s, e) => s + e.amount, 0);
  document.getElementById('dashTotal').textContent = fmtMoney(total);
  document.getElementById('dashSub').textContent = exps.length ? `共 ${exps.length} 筆支出` : '尚無支出紀錄，點右下角新增';

  const days = tripDayCount();
  document.getElementById('dashDays').textContent = days;
  document.getElementById('dashAvg').textContent = fmtMoney(days ? total / days : 0);

  // category bars
  const catTotals = {};
  exps.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
  const catBarsEl = document.getElementById('dashCatBars');
  const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  if (!sortedCats.length) {
    catBarsEl.innerHTML = `<div class="empty-state"><div class="ico">🍡</div><div class="t">還沒有支出資料</div><div class="d">新增第一筆支出後這裡會顯示分類統計</div></div>`;
  } else {
    catBarsEl.innerHTML = sortedCats.map(([catId, amt]) => {
      const cat = getCat(catId);
      const pct = total ? Math.round((amt / total) * 100) : 0;
      return `
        <div class="cat-bar-row">
          <div class="cat-icon" style="background:${cat.color}22;">${cat.icon}</div>
          <div class="info">
            <div class="top"><span>${cat.name}</span><span class="amt">${fmtMoney(amt)}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${cat.color};"></div></div>
          </div>
        </div>`;
    }).join('');
  }

  // who row
  const whoTotals = {};
  exps.forEach(e => { whoTotals[e.paidBy] = (whoTotals[e.paidBy] || 0) + e.amount; });
  const whoRowEl = document.getElementById('dashWhoRow');
  if (!DB.members.length) {
    whoRowEl.innerHTML = `<div style="font-size:12.5px;color:var(--warmgray);">尚未新增家庭成員，請至設定頁新增</div>`;
  } else {
    whoRowEl.innerHTML = DB.members.map(m => `
      <div class="who-chip">
        <div class="avatar" style="background:${m.color};">${m.name.slice(0,1)}</div>
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="amt" style="color:${m.color};">${fmtMoney(whoTotals[m.id] || 0)}</div>
      </div>`).join('');
  }

  // today's itinerary preview
  const tISO = todayISO();
  const todayEl = document.getElementById('dashTodayItin');
  const items = tripItinerary().filter(i => i.date === tISO).sort((a,b) => a.time.localeCompare(b.time));
  if (!items.length) {
    todayEl.innerHTML = `<div class="empty-state" style="padding:30px 20px;"><div class="ico">🧭</div><div class="d">今天（${fmtDateShort(tISO)}）還沒有安排行程</div></div>`;
  } else {
    todayEl.innerHTML = `<div class="timeline">` + items.map(i => itinCardHtml(i, false)).join('') + `</div>`;
  }
}

function renderLedger() {
  const exps = tripExpenses().slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const listEl = document.getElementById('ledgerList');
  if (!exps.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="ico">🧾</div><div class="t">還沒有任何支出紀錄</div><div class="d">點擊右下角「＋」開始記錄旅程花費</div></div>`;
    return;
  }
  const byDate = {};
  exps.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dates = Object.keys(byDate).sort().reverse();

  listEl.innerHTML = dates.map(date => {
    const items = byDate[date];
    const daySum = items.reduce((s, e) => s + e.amount, 0);
    const d = new Date(date);
    const label = `${d.getMonth() + 1}月${d.getDate()}日`;
    return `
      <div class="ledger-day">
        <div class="date-head"><span>${label}</span><span class="dsum">${fmtMoney(daySum)}</span></div>
        ${items.map(e => expenseCardHtml(e)).join('')}
      </div>`;
  }).join('');
}

function expenseCardHtml(e) {
  const cat = getCat(e.category);
  const payer = getMember(e.paidBy);
  return `
    <div class="expense-card" data-id="${e.id}" data-type="expense" style="cursor:pointer;">
      <div class="cat-icon" style="background:${cat.color}22;">${cat.icon}</div>
      <div class="mid">
        <div class="t1">${escapeHtml(e.title)}</div>
        <div class="t2">${cat.name}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
      </div>
      <div class="right">
        <div class="amt">${fmtMoney(e.amount)}</div>
        <div class="who" style="color:${payer ? payer.color : 'var(--warmgray)'}">${payer ? escapeHtml(payer.name) : '未指定'}</div>
      </div>
      <button class="del" data-del-expense="${e.id}" style="margin-left:6px; flex-shrink:0;">刪除</button>
    </div>`;
}

function renderItinerary() {
  if (!state.currentItinDate) state.currentItinDate = todayISO();
  const curDate = state.currentItinDate;

  if (state.currentScreen === 'itinerary') {
    document.getElementById('fabWrap').style.display = state.itinSelectMode ? 'none' : 'flex';
  }

  // 膠囊列：只列出「已經有安排行程」的日期（依日期排序），不顯示未安排的日期
  const usedDates = Array.from(new Set(tripItinerary().map(i => i.date))).sort();
  const tabsEl = document.getElementById('itinDayTabs');

  // 若目前檢視日期沒有行程，改為第一個有行程的日期（若完全沒有行程則維持原值僅顯示空狀態）
  if (usedDates.length && !usedDates.includes(curDate)) {
    state.currentItinDate = usedDates[0];
  }
  const activeDate = state.currentItinDate;

  let tabs = `<button id="itinPrevDay" style="flex-shrink:0; width:38px; height:38px;" ${usedDates.length < 2 ? 'disabled' : ''}>‹</button>`;
  if (!usedDates.length) {
    tabs += `<span style="flex-shrink:0; font-size:12px; color:var(--warmgray); padding:9px 6px; white-space:nowrap;">尚無已排定的行程日期</span>`;
  } else {
    usedDates.forEach((iso) => {
      const active = iso === activeDate;
      tabs += `<button class="${active ? 'active' : ''}" data-date="${iso}">${fmtWeekShort(iso)}<br><span style="font-size:10px;opacity:.7">${fmtDateShort(iso)}</span></button>`;
    });
  }
  tabs += `<button id="itinNextDay" style="flex-shrink:0; width:38px; height:38px;" ${usedDates.length < 2 ? 'disabled' : ''}>›</button>`;
  if (usedDates.length) {
    tabs += `<button id="itinSelectToggle" style="flex-shrink:0; display:flex; align-items:center; gap:5px; padding:0 14px; height:38px; border-radius:20px; border:1px solid ${state.itinSelectMode ? 'var(--danger)' : 'var(--line)'}; background:${state.itinSelectMode ? 'rgba(178,76,58,0.08)' : '#fff'}; font-family:'Noto Sans TC', sans-serif; font-weight:500; font-size:12.5px; color:${state.itinSelectMode ? 'var(--danger)' : 'var(--ink-soft)'}; white-space:nowrap;">${state.itinSelectMode ? '取消選取' : '選取刪除'}</button>`;
  }
  tabsEl.innerHTML = tabs;

  const selectToggle = document.getElementById('itinSelectToggle');
  if (selectToggle) {
    selectToggle.addEventListener('click', () => {
      state.itinSelectMode = !state.itinSelectMode;
      state.itinSelectedIds.clear();
      renderItinerary();
    });
  }

  if (usedDates.length >= 2) {
    document.getElementById('itinPrevDay').addEventListener('click', () => {
      const idx = usedDates.indexOf(activeDate);
      if (idx > 0) { state.currentItinDate = usedDates[idx - 1]; renderItinerary(); }
    });
    document.getElementById('itinNextDay').addEventListener('click', () => {
      const idx = usedDates.indexOf(activeDate);
      if (idx < usedDates.length - 1) { state.currentItinDate = usedDates[idx + 1]; renderItinerary(); }
    });
  }
  tabsEl.querySelectorAll('button[data-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentItinDate = btn.dataset.date;
      renderItinerary();
    });
  });

  const items = usedDates.length ? tripItinerary().filter(i => i.date === activeDate).sort((a, b) => a.time.localeCompare(b.time)) : [];
  const tlEl = document.getElementById('itinTimeline');
  if (!usedDates.length) {
    tlEl.innerHTML = `<div class="empty-state"><div class="ico">🗺️</div><div class="t">還沒有安排任何行程</div><div class="d">點擊右下角「＋」在旅程日期範圍內新增行程</div></div>`;
  } else if (!items.length) {
    tlEl.innerHTML = `<div class="empty-state"><div class="ico">🗺️</div><div class="t">${fmtDateLabel(activeDate)}尚無行程</div><div class="d">點擊右下角「＋」安排這天的行程</div></div>`;
  } else {
    tlEl.innerHTML = items.map(i => itinCardHtml(i, true)).join('');
  }

  renderItinBatchBar();
}

function renderItinBatchBar() {
  let bar = document.getElementById('itinBatchBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'itinBatchBar';
    bar.className = 'batch-bar';
    document.getElementById('app').appendChild(bar);
  }
  if (!state.itinSelectMode) {
    bar.classList.remove('show');
    bar.innerHTML = '';
    return;
  }

  const activeDate = state.currentItinDate;
  const visibleItems = tripItinerary().filter(i => i.date === activeDate);
  const visibleIds = visibleItems.map(i => i.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => state.itinSelectedIds.has(id));
  const n = state.itinSelectedIds.size;

  bar.classList.add('show');
  bar.innerHTML = `
    <button id="itinSelectAllBtn" style="background:none; border:1px solid rgba(251,246,239,0.4); color:var(--cream); border-radius:12px; padding:9px 14px; font-size:12.5px; font-family:'Noto Sans TC', sans-serif; font-weight:500;">${allSelected ? '取消全選' : '全選本日'}</button>
    <span style="flex:1; text-align:center; font-size:12.5px;">已選取 ${n} 筆</span>
    <button id="itinBatchDeleteBtn" ${n === 0 ? 'disabled' : ''} style="${n === 0 ? 'opacity:0.4;' : ''}">刪除選取項目</button>
  `;

  document.getElementById('itinSelectAllBtn').addEventListener('click', () => {
    if (allSelected) {
      visibleIds.forEach(id => state.itinSelectedIds.delete(id));
    } else {
      visibleIds.forEach(id => state.itinSelectedIds.add(id));
    }
    renderItinerary();
  });

  const delBtn = document.getElementById('itinBatchDeleteBtn');
  if (n > 0) {
    delBtn.addEventListener('click', () => {
      DB.itinerary = DB.itinerary.filter(i => !state.itinSelectedIds.has(i.id));
      state.itinSelectedIds.clear();
      state.itinSelectMode = false;
      saveDB();
      renderAll();
      showToast(`已刪除 ${n} 筆行程`);
    });
  }
}

function itinCardHtml(i, editable) {
  const sel = state.itinSelectMode;
  const checked = state.itinSelectedIds.has(i.id);
  return `
    <div class="timeline-item">
      <div class="timeline-card ${sel ? 'select-mode' : ''} ${checked ? 'is-checked' : ''}" data-id="${i.id}" data-type="itin">
        ${sel
          ? `<label class="itin-check"><input type="checkbox" data-check-itin="${i.id}" ${checked ? 'checked' : ''}></label>`
          : (editable ? `<div class="card-actions"><button class="del" data-edit-itin="${i.id}" style="color:var(--mist);">修改</button><button class="del" data-del-itin="${i.id}">刪除</button></div>` : '')}
        <div class="time">${i.time || '--:--'} ${editable ? '' : `· ${fmtDateShort(i.date)}`}</div>
        <div class="title">${escapeHtml(i.title)}</div>
        ${i.note ? `<div class="note">${escapeHtml(i.note)}</div>` : ''}
        ${i.location ? `<div class="meta"><span>📍 ${escapeHtml(i.location)}</span></div>` : ''}
      </div>
    </div>`;
}

function renderSettings() {
  const tripListEl = document.getElementById('tripList');
  tripListEl.innerHTML = DB.trips.map(t => `
    <div class="expense-card" data-trip-id="${t.id}" style="flex-wrap:wrap; ${t.id === DB.activeTrip ? 'border-color:var(--clay);' : ''}">
      <div class="cat-icon" style="background:${t.id === DB.activeTrip ? 'var(--clay)22' : 'var(--cream-2)'};">✈️</div>
      <div class="mid">
        <div class="t1">${escapeHtml(t.name)}</div>
        <div class="t2">${t.start} ~ ${t.end}</div>
      </div>
      <div class="right" style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
        ${t.id === DB.activeTrip ? '<div class="who" style="color:var(--clay);">使用中</div>' : `<button class="btn-secondary" style="margin:0;padding:6px 10px;font-size:11px;" data-select-trip="${t.id}">切換</button>`}
        <button class="btn-secondary" style="margin:0;padding:6px 10px;font-size:11px;" data-edit-trip="${t.id}">編輯</button>
      </div>
      <div style="width:100%; display:flex; justify-content:flex-end; margin-top:8px;">
        <button class="del" data-del-trip="${t.id}" ${DB.trips.length <= 1 ? 'disabled' : ''} style="text-align:right; max-width:220px; line-height:1.5; ${DB.trips.length <= 1 ? 'opacity:0.35;' : ''}">刪除此旅程</button>
      </div>
    </div>`).join('');

  const memberListEl = document.getElementById('memberList');
  memberListEl.innerHTML = DB.members.map(m => `
    <div class="expense-card">
      <div class="avatar" style="width:36px;height:36px;border-radius:50%;background:${m.color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-family:'Noto Serif TC',serif;flex-shrink:0;">${m.name.slice(0,1)}</div>
      <div class="mid"><div class="t1">${escapeHtml(m.name)}</div></div>
      <button class="del" style="float:none; color:var(--danger);" data-del-member="${m.id}">刪除</button>
    </div>`).join('');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------- Screen navigation ---------------- */
function goScreen(name) {
  if (state.currentScreen === 'itinerary' && name !== 'itinerary') {
    state.itinSelectMode = false;
    state.itinSelectedIds.clear();
  }
  state.currentScreen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  document.getElementById('fabWrap').style.display = (name === 'settings') ? 'none' : 'flex';
  document.getElementById('mainScroll').scrollTop = 0;
  if (name === 'itinerary') renderItinerary();
}

/* ---------------- Modals ---------------- */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function buildCatGrid(selectedCat) {
  const el = document.getElementById('expCatGrid');
  const sel = selectedCat || CATEGORIES[0].id;
  el.innerHTML = CATEGORIES.map((c) => `
    <button type="button" class="cat-pick ${c.id === sel ? 'sel' : ''}" data-cat="${c.id}">
      <span class="ic">${c.icon}</span>${c.name}
    </button>`).join('');
  el.querySelectorAll('.cat-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.cat-pick').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
    });
  });
}

function buildWhoRow(selectedWho) {
  const el = document.getElementById('expWhoRow');
  const sel = selectedWho || (DB.members[0] && DB.members[0].id);
  el.innerHTML = DB.members.map((m) => `
    <button type="button" class="who-pick ${m.id === sel ? 'sel' : ''}" data-who="${m.id}">${escapeHtml(m.name)}</button>`).join('');
  el.querySelectorAll('.who-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.who-pick').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
    });
  });
}

function openExpenseModal(editId) {
  if (!DB.members.length) { showToast('請先到設定頁新增家庭成員'); goScreen('settings'); return; }
  const editing = editId ? DB.expenses.find(x => x.id === editId) : null;
  buildCatGrid(editing ? editing.category : null);
  buildWhoRow(editing ? editing.paidBy : null);
  document.getElementById('expModalTitle').textContent = editing ? '修改支出' : '新增支出';
  document.getElementById('expEditId').value = editing ? editing.id : '';
  document.getElementById('expAmount').value = editing ? editing.amount : '';
  document.getElementById('expTitle').value = editing ? editing.title : '';
  document.getElementById('expNote').value = editing ? editing.note : '';
  document.getElementById('expDate').value = editing ? editing.date : todayISO();
  document.getElementById('saveExpenseBtn').textContent = editing ? '儲存修改' : '儲存支出';
  openModal('expenseModal');
  setTimeout(() => document.getElementById('expAmount').focus(), 300);
}

function openItinModal(editId) {
  const t = activeTrip();
  const dateInput = document.getElementById('itinDate');
  dateInput.removeAttribute('min');
  dateInput.removeAttribute('max');

  const editing = editId ? DB.itinerary.find(i => i.id === editId) : null;
  document.getElementById('itinModalTitle').textContent = editing ? '修改行程' : '新增行程';
  document.getElementById('itinEditId').value = editing ? editing.id : '';
  document.getElementById('itinDate').value = editing ? editing.date : todayISO();
  document.getElementById('itinTime').value = editing ? editing.time : '';
  document.getElementById('itinTitle').value = editing ? editing.title : '';
  document.getElementById('itinLocation').value = editing ? editing.location : '';
  document.getElementById('itinNote').value = editing ? editing.note : '';
  document.getElementById('saveItinBtn').textContent = editing ? '儲存修改' : '儲存行程';
  document.getElementById('itinDateHint').textContent = t ? `旅程參考範圍：${t.start} ～ ${t.end}（可自由選擇其他日期）` : '';
  openModal('itinModal');
}

function openTripModal(editId) {
  const editing = editId ? DB.trips.find(t => t.id === editId) : null;
  document.getElementById('tripModalTitle').textContent = editing ? '編輯旅程' : '新增旅程';
  document.getElementById('tripEditId').value = editing ? editing.id : '';
  const today = todayISO();
  document.getElementById('tripName').value = editing ? editing.name : '';
  document.getElementById('tripStart').value = editing ? editing.start : today;
  document.getElementById('tripEnd').value = editing ? editing.end : today;
  document.getElementById('tripEnd').min = editing ? editing.start : today;
  document.getElementById('saveTripBtn').textContent = editing ? '儲存修改' : '建立旅程';
  openModal('tripModal');
}

function buildMemberColorRow() {
  const el = document.getElementById('memberColorRow');
  el.innerHTML = MEMBER_COLORS.map((c, idx) => `
    <button type="button" class="who-pick ${idx === 0 ? 'sel' : ''}" data-color="${c}" style="border-color:${c}; ${idx===0?`background:${c}22;color:${c};`:''}">●</button>`).join('');
  el.querySelectorAll('.who-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.who-pick').forEach(b => { b.classList.remove('sel'); b.style.background=''; b.style.color=''; });
      btn.classList.add('sel');
      btn.style.background = btn.dataset.color + '22';
      btn.style.color = btn.dataset.color;
    });
  });
}

function openMemberModal() {
  document.getElementById('memberName').value = '';
  buildMemberColorRow();
  openModal('memberModal');
}

/* ---------------- Event wiring ---------------- */
function wireEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => goScreen(btn.dataset.screen));
  });

  document.getElementById('fabBtn').addEventListener('click', () => {
    if (state.currentScreen === 'itinerary') openItinModal();
    else openExpenseModal();
  });

  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('active'); });
  });

  document.getElementById('tripSelect').addEventListener('change', (e) => {
    DB.activeTrip = e.target.value;
    state.currentItinDate = activeTrip() ? activeTrip().start : todayISO();
    saveDB();
    renderAll();
  });

  document.getElementById('saveExpenseBtn').addEventListener('click', () => {
    const editId = document.getElementById('expEditId').value;
    const amount = parseFloat(document.getElementById('expAmount').value);
    const title = document.getElementById('expTitle').value.trim();
    const date = document.getElementById('expDate').value;
    const note = document.getElementById('expNote').value.trim();
    const catBtn = document.querySelector('#expCatGrid .cat-pick.sel');
    const whoBtn = document.querySelector('#expWhoRow .who-pick.sel');

    if (!amount || amount <= 0) { showToast('請輸入有效金額'); return; }
    if (!title) { showToast('請輸入項目名稱'); return; }
    if (!date) { showToast('請選擇日期'); return; }

    const category = catBtn ? catBtn.dataset.cat : 'other';
    const paidBy = whoBtn ? whoBtn.dataset.who : (DB.members[0] && DB.members[0].id);

    if (editId) {
      const item = DB.expenses.find(x => x.id === editId);
      if (item) {
        Object.assign(item, { amount, title, note, date, category, paidBy });
      }
      saveDB();
      closeModal('expenseModal');
      renderAll();
      showToast('已儲存修改');
    } else {
      DB.expenses.push({
        id: uid(),
        tripId: DB.activeTrip,
        amount, title, note, date,
        time: new Date().toTimeString().slice(0, 5),
        category, paidBy,
      });
      saveDB();
      closeModal('expenseModal');
      renderAll();
      showToast('已新增支出');
    }
  });

  document.getElementById('saveItinBtn').addEventListener('click', () => {
    const editId = document.getElementById('itinEditId').value;
    const date = document.getElementById('itinDate').value;
    const time = document.getElementById('itinTime').value;
    const title = document.getElementById('itinTitle').value.trim();
    const location = document.getElementById('itinLocation').value.trim();
    const note = document.getElementById('itinNote').value.trim();
    const t = activeTrip();

    if (!date) { showToast('請選擇日期'); return; }
    if (!title) { showToast('請輸入行程名稱'); return; }

    if (t) {
      if (date < t.start) t.start = date;
      if (date > t.end) t.end = date;
    }

    if (editId) {
      const item = DB.itinerary.find(i => i.id === editId);
      if (item) {
        Object.assign(item, { date, time: time || '00:00', title, location, note });
      }
      saveDB();
      closeModal('itinModal');
      state.currentItinDate = date;
      renderAll();
      showToast('已儲存修改');
    } else {
      DB.itinerary.push({
        id: uid(), tripId: DB.activeTrip, date, time: time || '00:00', title, location, note,
      });
      saveDB();
      closeModal('itinModal');
      state.currentItinDate = date;
      renderAll();
      showToast('已新增行程');
    }
  });

  document.getElementById('tripStart').addEventListener('change', (e) => {
    const endInput = document.getElementById('tripEnd');
    endInput.min = e.target.value;
    if (endInput.value && endInput.value < e.target.value) {
      endInput.value = e.target.value;
    }
  });

  document.getElementById('saveTripBtn').addEventListener('click', () => {
    const editId = document.getElementById('tripEditId').value;
    const name = document.getElementById('tripName').value.trim();
    const start = document.getElementById('tripStart').value;
    const end = document.getElementById('tripEnd').value;
    if (!name) { showToast('請輸入旅程名稱'); return; }
    if (!start || !end || start > end) { showToast('請確認日期區間正確'); return; }

    if (editId) {
      const trip = DB.trips.find(t => t.id === editId);
      if (trip) {
        const outOfRange = DB.itinerary.some(i => i.tripId === editId && (i.date < start || i.date > end));
        Object.assign(trip, { name, start, end });
        saveDB();
        closeModal('tripModal');
        if (state.currentItinDate < start || state.currentItinDate > end) state.currentItinDate = start;
        renderAll();
        showToast(outOfRange ? '旅程已更新（部分既有行程日期已超出新範圍，但資料仍保留）' : '旅程已更新');
      }
    } else {
      const id = uid();
      DB.trips.push({ id, name, start, end });
      DB.activeTrip = id;
      state.currentItinDate = start;
      saveDB();
      closeModal('tripModal');
      renderAll();
      showToast('旅程已建立');
    }
  });

  document.getElementById('saveMemberBtn').addEventListener('click', () => {
    const name = document.getElementById('memberName').value.trim();
    const colorBtn = document.querySelector('#memberColorRow .who-pick.sel');
    if (!name) { showToast('請輸入姓名'); return; }
    DB.members.push({ id: uid(), name, color: colorBtn ? colorBtn.dataset.color : MEMBER_COLORS[0] });
    saveDB();
    closeModal('memberModal');
    renderAll();
    showToast('已新增成員');
  });

  document.getElementById('addTripBtn').addEventListener('click', openTripModal);
  document.getElementById('addMemberBtn').addEventListener('click', openMemberModal);

  document.getElementById('itinDayTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-date]');
    if (!btn) return;
    state.currentItinDate = btn.dataset.date;
    renderItinerary();
  });

  document.getElementById('itinTimeline').addEventListener('click', (e) => {
    // 選取模式：點擊卡片（非按鈕/checkbox）也能切換勾選
    if (state.itinSelectMode) {
      const checkbox = e.target.closest('[data-check-itin]');
      const card = e.target.closest('.timeline-card[data-id]');
      if (!card) return;
      const id = card.dataset.id;
      if (checkbox) {
        if (checkbox.checked) state.itinSelectedIds.add(id); else state.itinSelectedIds.delete(id);
      } else {
        if (state.itinSelectedIds.has(id)) state.itinSelectedIds.delete(id); else state.itinSelectedIds.add(id);
      }
      renderItinerary();
      return;
    }

    const edit = e.target.closest('[data-edit-itin]');
    if (edit) { openItinModal(edit.dataset.editItin); return; }

    const del = e.target.closest('[data-del-itin]');
    if (!del) return;
    if (del.dataset.confirming === '1') {
      DB.itinerary = DB.itinerary.filter(i => i.id !== del.dataset.delItin);
      saveDB();
      renderAll();
      showToast('已刪除行程');
    } else {
      del.dataset.confirming = '1';
      del.textContent = '確定刪除？';
      del.style.color = 'var(--danger)';
      del.style.fontWeight = '700';
      setTimeout(() => {
        if (del.isConnected) {
          del.dataset.confirming = '0';
          del.textContent = '刪除';
          del.style.fontWeight = '';
        }
      }, 2500);
    }
  });

  document.getElementById('ledgerList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-expense]');
    if (del) {
      if (del.dataset.confirming === '1') {
        DB.expenses = DB.expenses.filter(x => x.id !== del.dataset.delExpense);
        saveDB();
        renderAll();
        showToast('已刪除支出');
      } else {
        del.dataset.confirming = '1';
        del.textContent = '確定？';
        del.style.color = 'var(--danger)';
        del.style.fontWeight = '700';
        setTimeout(() => {
          if (del.isConnected) {
            del.dataset.confirming = '0';
            del.textContent = '刪除';
            del.style.fontWeight = '';
          }
        }, 2500);
      }
      return;
    }
    const card = e.target.closest('.expense-card[data-id]');
    if (!card) return;
    openExpenseModal(card.dataset.id);
  });

  document.getElementById('tripList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-trip]');
    if (editBtn) { openTripModal(editBtn.dataset.editTrip); return; }

    const delBtn = e.target.closest('[data-del-trip]');
    if (delBtn) {
      if (DB.trips.length <= 1) { showToast('至少要保留一個旅程'); return; }
      if (delBtn.dataset.confirming === '1') {
        const tripId = delBtn.dataset.delTrip;
        DB.trips = DB.trips.filter(t => t.id !== tripId);
        DB.expenses = DB.expenses.filter(x => x.tripId !== tripId);
        DB.itinerary = DB.itinerary.filter(i => i.tripId !== tripId);
        if (DB.activeTrip === tripId) {
          DB.activeTrip = DB.trips[0].id;
          state.currentItinDate = activeTrip().start;
        }
        saveDB();
        renderAll();
        showToast('已刪除旅程與其所有支出、行程紀錄');
      } else {
        delBtn.dataset.confirming = '1';
        delBtn.textContent = '確定刪除？（含全部支出行程）';
        delBtn.style.fontWeight = '700';
        setTimeout(() => {
          if (delBtn.isConnected) {
            delBtn.dataset.confirming = '0';
            delBtn.textContent = '刪除此旅程';
            delBtn.style.fontWeight = '';
          }
        }, 3000);
      }
      return;
    }

    const btn = e.target.closest('[data-select-trip]');
    if (!btn) return;
    DB.activeTrip = btn.dataset.selectTrip;
    state.currentItinDate = activeTrip() ? activeTrip().start : todayISO();
    saveDB();
    renderAll();
  });

  document.getElementById('memberList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-member]');
    if (!btn) return;
    if (btn.dataset.confirming === '1') {
      DB.members = DB.members.filter(m => m.id !== btn.dataset.delMember);
      saveDB();
      renderAll();
      showToast('已刪除成員');
    } else {
      btn.dataset.confirming = '1';
      btn.textContent = '確定刪除？';
      setTimeout(() => {
        if (btn.isConnected) {
          btn.dataset.confirming = '0';
          btn.textContent = '刪除';
        }
      }, 2500);
    }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `旅程帳備份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出備份');
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.trips || !data.members) throw new Error('invalid');
        DB = data;
        saveDB();
        renderAll();
        showToast('已匯入備份');
      } catch (err) {
        showToast('檔案格式錯誤，匯入失敗');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

/* ---------------- Init ---------------- */
function init() {
  DB = loadDB();
  if (!DB.activeTrip && DB.trips.length) DB.activeTrip = DB.trips[0].id;
  const t = activeTrip();
  const today = todayISO();
  state.currentItinDate = (t && today >= t.start && today <= t.end) ? today : (t ? t.start : today);
  saveDB();
  wireEvents();
  renderAll();
  goScreen('dashboard');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
