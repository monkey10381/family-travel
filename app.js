/* ===========================================================
   旅程帳 - 家庭旅行記帳 App
   雲端同步版（Firebase Auth + Firestore）
   =========================================================== */

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

/* ---------------- Firebase / 家庭空間層 ---------------- */
let currentUser = null;     // { uid, email, displayName }
let currentFamilyId = null; // 目前登入使用者所屬的家庭空間 id
let isSigningUp = false;    // 註冊流程進行中時，暫停 onAuthStateChanged 的自動處理，避免資料尚未寫完就被搶先讀取
let unsubscribeFamily = null; // Firestore 即時監聽的取消函式
let isApplyingRemoteUpdate = false; // 避免收到自己剛寫入的資料又重複同步造成迴圈

function emptyDB() {
  const today = todayISO();
  return {
    members: [],       // 由家庭成員（Firebase 使用者）自動組成，不再手動管理
    trips: [{ id: uid(), name: '我的旅程', start: today, end: today }],
    activeTrip: null,
    expenses: [],
    itinerary: [],
  };
}

function genFamilyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 避開易混淆字元
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// 將整包 DB 寫回 Firestore（單一文件儲存，簡化同步邏輯）
async function syncDB() {
  if (!currentFamilyId || isApplyingRemoteUpdate) return;
  try {
    await window.fb.setDoc(
      window.fb.doc(window.fb.db, 'families', currentFamilyId),
      { data: DB, updatedAt: window.fb.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error('同步失敗', err);
    showToast('同步失敗，請確認網路連線');
  }
}

// 開始監聽家庭空間資料，任何人異動都會即時反映
// 回傳一個 Promise，於「第一次」收到資料時 resolve，確保呼叫端渲染畫面前 DB 已就緒
function listenFamily(familyId) {
  if (unsubscribeFamily) { unsubscribeFamily(); unsubscribeFamily = null; }
  const ref = window.fb.doc(window.fb.db, 'families', familyId);
  let firstLoadResolved = false;
  return new Promise((resolve) => {
    unsubscribeFamily = window.fb.onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        if (!firstLoadResolved) { firstLoadResolved = true; resolve(); }
        return;
      }
      const remote = snap.data();
      isApplyingRemoteUpdate = true;
      DB = remote.data || emptyDB();
      if (!DB.activeTrip && DB.trips.length) DB.activeTrip = DB.trips[0].id;
      syncMembersFromRoster(remote.roster || {});
      isApplyingRemoteUpdate = false;
      if (!firstLoadResolved) {
        firstLoadResolved = true;
        resolve();
      } else if (document.getElementById('app')) {
        renderAll();
      }
    }, (err) => {
      console.error('監聽失敗', err);
      if (!firstLoadResolved) { firstLoadResolved = true; resolve(); }
    });
  });
}

// roster：家庭空間內所有已註冊成員的名冊（uid -> {name, color}），與 DB.members 同步
function syncMembersFromRoster(roster) {
  const ids = Object.keys(roster);
  DB.members = ids.map(uidKey => ({
    id: uidKey,
    name: roster[uidKey].name,
    color: roster[uidKey].color,
  }));
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
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000; // 分鐘轉毫秒
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------------- Rendering ---------------- */
function renderAll() {
  if (!DB) return;
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
      syncDB();
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
  if (!DB.members.length) {
    memberListEl.innerHTML = `<div class="empty-state" style="padding:24px 20px;"><div class="d">還沒有成員資料</div></div>`;
  } else {
    memberListEl.innerHTML = DB.members.map(m => `
      <div class="expense-card">
        <div class="avatar" style="width:36px;height:36px;border-radius:50%;background:${m.color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-family:'Noto Serif TC',serif;flex-shrink:0;">${m.name.slice(0,1)}</div>
        <div class="mid"><div class="t1">${escapeHtml(m.name)}</div></div>
        ${currentUser && m.id === currentUser.uid ? '<div class="who" style="color:var(--clay);">你</div>' : ''}
      </div>`).join('');
  }
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
  if (name === 'itinerary' && DB) renderItinerary();
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
  if (!DB.members.length) { showToast('尚未載入家庭成員資料，請稍候再試'); return; }
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
    syncDB();
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
      syncDB();
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
      syncDB();
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
      syncDB();
      closeModal('itinModal');
      state.currentItinDate = date;
      renderAll();
      showToast('已儲存修改');
    } else {
      DB.itinerary.push({
        id: uid(), tripId: DB.activeTrip, date, time: time || '00:00', title, location, note,
      });
      syncDB();
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
        syncDB();
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
      syncDB();
      closeModal('tripModal');
      renderAll();
      showToast('旅程已建立');
    }
  });

  document.getElementById('addTripBtn').addEventListener('click', openTripModal);

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
      syncDB();
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
        syncDB();
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
        syncDB();
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
    syncDB();
    renderAll();
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
}

/* ---------------- Auth / 家庭空間 UI ---------------- */
function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hide');
  document.getElementById('app').style.display = 'none';
}
function hideAuthScreen() {
  document.getElementById('authScreen').classList.add('hide');
  document.getElementById('app').style.display = '';
}
function showAuthError(msg) {
  const box = document.getElementById('authErrorBox');
  box.textContent = msg;
  box.classList.add('show');
}
function clearAuthError() {
  const box = document.getElementById('authErrorBox');
  box.classList.remove('show');
  box.textContent = '';
}
function friendlyAuthError(err) {
  const code = err && err.code || '';
  const map = {
    'auth/invalid-email': 'Email 格式不正確',
    'auth/user-not-found': '找不到這個帳號，請確認 Email 或先註冊',
    'auth/wrong-password': '密碼錯誤',
    'auth/invalid-credential': 'Email 或密碼不正確',
    'auth/email-already-in-use': '這個 Email 已經被註冊過了，請改用登入',
    'auth/weak-password': '密碼至少需要 6 個字元',
    'auth/network-request-failed': '網路連線異常，請稍後再試',
    'permission-denied': '沒有權限存取資料庫，請確認 Firestore 安全規則設定',
    'unavailable': '無法連線到伺服器，請檢查網路',
  };
  const friendly = map[code];
  const detail = code || (err && err.message) || '未知錯誤';
  return friendly ? `${friendly}（代碼：${detail}）` : `發生錯誤（代碼：${detail}）`;
}

function wireAuthEvents() {
  // 登入／註冊分頁切換
  document.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      clearAuthError();
      document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('loginForm').classList.toggle('active', btn.dataset.authTab === 'login');
      document.getElementById('signupForm').classList.toggle('active', btn.dataset.authTab === 'signup');
    });
  });

  // 建立新家庭／加入現有家庭 切換
  document.querySelectorAll('[data-family-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-family-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isCreate = btn.dataset.familyMode === 'create';
      document.getElementById('familyNameField').style.display = isCreate ? '' : 'none';
      document.getElementById('familyCodeField').style.display = isCreate ? 'none' : '';
    });
  });

  // 登入
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginSubmitBtn');
    const loading = document.getElementById('loginLoading');
    btn.disabled = true; loading.classList.add('show');
    try {
      await window.fb.signInWithEmailAndPassword(window.fb.auth, email, password);
      // onAuthStateChanged 會接手後續流程
    } catch (err) {
      showAuthError(friendlyAuthError(err));
      btn.disabled = false; loading.classList.remove('show');
    }
  });

  // 註冊
  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const mode = document.querySelector('[data-family-mode].active').dataset.familyMode;
    const familyName = document.getElementById('familyNameInput').value.trim();
    const familyCode = document.getElementById('familyCodeInput').value.trim().toUpperCase();

    if (!name) { showAuthError('請輸入你的稱呼'); return; }
    if (mode === 'create' && !familyName) { showAuthError('請輸入家庭名稱'); return; }
    if (mode === 'join' && !familyCode) { showAuthError('請輸入邀請碼'); return; }

    const btn = document.getElementById('signupSubmitBtn');
    const loading = document.getElementById('signupLoading');
    btn.disabled = true; loading.classList.add('show');
    isSigningUp = true;

    try {
      let familyId = null;

      if (mode === 'join') {
        // 先找出邀請碼對應的家庭空間
        const q = window.fb.query(
          window.fb.collection(window.fb.db, 'families'),
          window.fb.where('code', '==', familyCode)
        );
        const snap = await new Promise((resolve, reject) => {
          const unsub = window.fb.onSnapshot(q, (s) => { unsub(); resolve(s); }, reject);
        });
        if (snap.empty) {
          showAuthError('找不到這個邀請碼，請確認後再試一次');
          btn.disabled = false; loading.classList.remove('show');
          isSigningUp = false;
          return;
        }
        familyId = snap.docs[0].id;
      }

      // 建立帳號
      const cred = await window.fb.createUserWithEmailAndPassword(window.fb.auth, email, password);
      await window.fb.updateProfile(cred.user, { displayName: name });

      if (mode === 'create') {
        familyId = uid() + uid();
        const code = genFamilyCode();
        const initialData = emptyDB();
        initialData.activeTrip = initialData.trips[0].id;
        await window.fb.setDoc(window.fb.doc(window.fb.db, 'families', familyId), {
          name: familyName,
          code,
          ownerUid: cred.user.uid,
          data: initialData,
          roster: {
            [cred.user.uid]: { name, color: MEMBER_COLORS[0] }
          },
          createdAt: window.fb.serverTimestamp(),
          updatedAt: window.fb.serverTimestamp(),
        });
      } else {
        // 加入現有家庭：把自己加進 roster
        const familyRef = window.fb.doc(window.fb.db, 'families', familyId);
        const familySnap = await window.fb.getDocFromServer(familyRef);
        const existingRoster = (familySnap.exists() && familySnap.data().roster) || {};
        const usedColors = Object.values(existingRoster).map(m => m.color);
        const nextColor = MEMBER_COLORS.find(c => !usedColors.includes(c)) || MEMBER_COLORS[Object.keys(existingRoster).length % MEMBER_COLORS.length];
        await window.fb.setDoc(familyRef, {
          roster: { ...existingRoster, [cred.user.uid]: { name, color: nextColor } },
          updatedAt: window.fb.serverTimestamp(),
        }, { merge: true });
      }

      // 記錄使用者所屬的家庭空間 id，供下次登入直接讀取
      await window.fb.setDoc(window.fb.doc(window.fb.db, 'users', cred.user.uid), {
        familyId, name, email,
      });

      // 資料已完整寫入，現在才交給正式的登入流程接手（直接帶入剛拿到的 familyId，避免重新查詢時遇到快取延遲）
      isSigningUp = false;
      await handleSignedIn(cred.user, familyId);
    } catch (err) {
      isSigningUp = false;
      showAuthError(friendlyAuthError(err));
      btn.disabled = false; loading.classList.remove('show');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    if (unsubscribeFamily) { unsubscribeFamily(); unsubscribeFamily = null; }
    await window.fb.signOut(window.fb.auth);
  });
}

async function handleSignedIn(user, knownFamilyId) {
  currentUser = { uid: user.uid, email: user.email, displayName: user.displayName };
  clearAuthError();
  // 重置登入表單狀態，避免下次登出再登入時卡在 loading
  const loginBtn = document.getElementById('loginSubmitBtn');
  const loginLoading = document.getElementById('loginLoading');
  const signupBtn = document.getElementById('signupSubmitBtn');
  const signupLoading = document.getElementById('signupLoading');
  if (loginBtn) { loginBtn.disabled = false; loginLoading.classList.remove('show'); }
  if (signupBtn) { signupBtn.disabled = false; signupLoading.classList.remove('show'); }

  try {
    let familyId = knownFamilyId;

    if (!familyId) {
      // 一般登入：從 users/{uid} 讀取所屬家庭空間
      // 用 getDocFromServer 強制跳過本地快取，避免讀到過期或空白的資料
      const userDoc = await window.fb.getDocFromServer(window.fb.doc(window.fb.db, 'users', user.uid));
      if (!userDoc.exists() || !userDoc.data().familyId) {
        showAuthError('找不到你的家庭空間資料，請聯絡管理者或重新註冊');
        await window.fb.signOut(window.fb.auth);
        return;
      }
      familyId = userDoc.data().familyId;
    }

    currentFamilyId = familyId;

    hideAuthScreen();
    await listenFamily(currentFamilyId);
    const t = activeTrip();
    const today = todayISO();
    state.currentItinDate = (t && today >= t.start && today <= t.end) ? today : (t ? t.start : today);
    renderAll();
    goScreen('dashboard');

    // 家庭代碼顯示可以晚一點補上，不影響主流程
    window.fb.getDoc(window.fb.doc(window.fb.db, 'families', currentFamilyId)).then(familyDoc => {
      if (familyDoc.exists()) {
        document.getElementById('familyCodeDisplay').textContent = familyDoc.data().code || '------';
      }
    }).catch(() => {});
  } catch (err) {
    console.error(err);
    showAuthError(`載入家庭空間時發生錯誤（代碼：${(err && err.code) || (err && err.message) || '未知'}）`);
  }
}

function handleSignedOut() {
  currentUser = null;
  currentFamilyId = null;
  DB = null;
  if (unsubscribeFamily) { unsubscribeFamily(); unsubscribeFamily = null; }
  showAuthScreen();
  document.getElementById('loginForm').reset();
  document.getElementById('signupForm').reset();
}

/* ---------------- Init ---------------- */
function init() {
  wireAuthEvents();
  wireEvents();

  window.fb.onAuthStateChanged(window.fb.auth, (user) => {
    if (isSigningUp) return; // 註冊流程會在資料寫完後自行呼叫 handleSignedIn，這裡先不處理
    if (user) handleSignedIn(user);
    else handleSignedOut();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function boot() {
  if (window.fb) { init(); }
  else { window.addEventListener('firebase-ready', init, { once: true }); }
}

document.addEventListener('DOMContentLoaded', boot);
