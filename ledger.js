/*
 * ตัวคำนวณยอดของแอปสมุดเงิน (ต้นแบบรอบ 1)
 * - แยกจากหน้าจอ เพื่อให้ฐานข้อมูลจริงและแอป Mac/iPhone ในอนาคตใช้ตรรกะเดียวกัน
 * - เงินทุกจำนวนเป็นจำนวนเต็มหน่วยสตางค์ (ไม่ใช้ทศนิยมลอยตัว)
 * - วันที่ทำรายการเก็บเป็นข้อความ YYYY-MM-DD ตามเวลา Asia/Bangkok
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ledger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOOKS = ['personal', 'work'];
  var BOOK_TH = { personal: 'ส่วนตัว', work: 'งาน' };
  var KINDS = ['income', 'expense', 'refund', 'transfer'];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ---------- เงินและวันที่ ----------

  /** "1,234.50" → 123450 · คืน null ถ้าไม่ใช่จำนวนเงินที่ถูกต้อง (เกิน 2 ตำแหน่ง ติดลบ หรือมีตัวอักษร) */
  function toSatang(input) {
    if (typeof input === 'number') {
      if (!isFinite(input) || input < 0) return null;
      input = input.toFixed(2);
    }
    var s = String(input == null ? '' : input).replace(/[,\s฿]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split('.');
    var baht = parseInt(parts[0], 10);
    var st = parts[1] ? parseInt((parts[1] + '0').slice(0, 2), 10) : 0;
    var v = baht * 100 + st;
    return Number.isSafeInteger(v) ? v : null;
  }

  /** 123450 → "1,234.50" */
  function fmt(satang, opts) {
    opts = opts || {};
    var neg = satang < 0;
    var a = Math.abs(satang);
    var baht = Math.floor(a / 100);
    var st = a % 100;
    var s = String(baht).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (st || opts.always2) s += '.' + (st < 10 ? '0' : '') + st;
    return (neg ? '-' : '') + s;
  }

  /** 123450 → "1234.50" สำหรับ CSV (ไม่มีจุลภาค ให้ Numbers/Excel อ่านเป็นตัวเลข) */
  function plain(satang) {
    var neg = satang < 0;
    var a = Math.abs(satang);
    var st = a % 100;
    return (neg ? '-' : '') + Math.floor(a / 100) + '.' + (st < 10 ? '0' : '') + st;
  }

  var BKK = typeof Intl !== 'undefined'
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    : null;

  /** เวลาใด ๆ (Date หรือ ISO) → วันที่ตามเวลากรุงเทพ YYYY-MM-DD */
  function bangkokDate(t) {
    var d = t instanceof Date ? t : new Date(t);
    if (BKK) {
      var p = {};
      BKK.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return p.year + '-' + p.month + '-' + p.day;
    }
    var b = new Date(d.getTime() + 7 * 3600 * 1000);
    return b.toISOString().slice(0, 10);
  }

  /** '2026-11' → { from: '2026-11-01', to: '2026-11-30' } */
  function monthRange(ym) {
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: ym + '-01', to: ym + '-' + (last < 10 ? '0' : '') + last };
  }

  function inRange(date, from, to) {
    return (!from || date >= from) && (!to || date <= to);
  }

  // ---------- ที่เก็บข้อมูล (ต้นแบบเก็บในหน่วยความจำ · รอบ 2 ย้ายไปฐานข้อมูลจริง) ----------

  function createStore() {
    var s = {
      accounts: [],
      categories: [],
      projects: [],
      events: [],
      goals: [],
      budgets: [],
      byRequest: {},
      seq: 0
    };

    function nextId(prefix) {
      s.seq += 1;
      return prefix + '-' + String(s.seq).padStart(5, '0');
    }

    s.addAccount = function (a) {
      var acc = {
        id: a.id || nextId('acc'),
        name: a.name,
        kind: a.kind || 'bank',
        openingDate: a.openingDate || null,
        opening: { personal: (a.opening && a.opening.personal) || 0, work: (a.opening && a.opening.work) || 0 },
        hasOpening: !!a.opening
      };
      s.accounts.push(acc);
      return acc;
    };
    s.addCategory = function (c) {
      var cat = { id: c.id || nextId('cat'), book: c.book, type: c.type, name: c.name };
      s.categories.push(cat);
      return cat;
    };
    s.addProject = function (p) {
      var pr = { id: p.id || nextId('prj'), name: p.name };
      s.projects.push(pr);
      return pr;
    };
    s.addGoal = function (g) {
      var goal = { id: g.id || nextId('goal'), book: g.book, name: g.name, target: g.target, reserves: [] };
      s.goals.push(goal);
      return goal;
    };
    /** กันเงินไว้เพื่อเป้าหมาย: เป็นเครื่องหมายเท่านั้น ไม่สร้างรายจ่ายและไม่ย้ายเงิน */
    s.reserve = function (goalId, amount, date) {
      var g = s.goals.find(function (x) { return x.id === goalId; });
      if (!g || !Number.isSafeInteger(amount) || amount === 0) return { ok: false, error: 'ข้อมูลกันเงินไม่ถูกต้อง' };
      g.reserves.push({ amount: amount, date: date });
      return { ok: true, goal: g };
    };
    s.setBudget = function (b) {
      // b: { book, month: 'YYYY-MM', total, categories: { catId: amount } }
      s.budgets = s.budgets.filter(function (x) { return !(x.book === b.book && x.month === b.month); });
      s.budgets.push({ book: b.book, month: b.month, total: b.total || 0, categories: b.categories || {} });
    };

    s.account = function (id) { return s.accounts.find(function (a) { return a.id === id; }) || null; };
    s.category = function (id) { return s.categories.find(function (c) { return c.id === id; }) || null; };
    s.project = function (id) { return s.projects.find(function (p) { return p.id === id; }) || null; };
    s.get = function (id) { return s.events.find(function (e) { return e.id === id; }) || null; };

    function validate(e) {
      if (KINDS.indexOf(e.kind) < 0) return 'ยังไม่ได้เลือกประเภทรายการ';
      if (!Number.isSafeInteger(e.amount) || e.amount <= 0) return 'จำนวนเงินต้องมากกว่า 0';
      if (!DATE_RE.test(e.date || '')) return 'วันที่ไม่ถูกต้อง';
      if (e.status === 'draft') return null; // ฉบับร่างยังไม่ครบได้ แต่ไม่นับในยอด
      if (e.kind === 'transfer') {
        if (BOOKS.indexOf(e.fromBook) < 0 || BOOKS.indexOf(e.toBook) < 0) return 'ต้องเลือกสมุดต้นทางและปลายทาง';
        if (!e.fromAccount || !e.toAccount) return 'ต้องเลือกบัญชีต้นทางและปลายทาง';
        if (e.fromAccount === e.toAccount && e.fromBook === e.toBook) return 'ต้นทางกับปลายทางเหมือนกัน';
        if (e.settlesDue && e.fromBook === e.toBook) return 'การคืนเงินที่ออกแทนต้องโอนข้ามสมุด';
        return null;
      }
      if (BOOKS.indexOf(e.book) < 0) return 'ต้องเลือกสมุดเงิน ส่วนตัว หรือ งาน';
      if (e.fundedBy && BOOKS.indexOf(e.fundedBy) < 0) return 'แหล่งเงินไม่ถูกต้อง';
      if (e.kind === 'refund' && !e.refundOf) return 'รายการคืนเงินต้องผูกกับรายการเดิม';
      return null;
    }

    /**
     * บันทึกรายการ · requestId เดิมส่งซ้ำ = คืนรายการเดิม ไม่สร้างแถวใหม่
     */
    s.save = function (input, now) {
      if (!input || !input.requestId) return { ok: false, error: 'ไม่มีรหัสคำขอ' };
      var existingId = s.byRequest[input.requestId];
      if (existingId) return { ok: true, event: s.get(existingId), duplicate: true };

      var e = {
        id: null,
        requestId: input.requestId,
        kind: input.kind,
        status: input.status === 'draft' ? 'draft' : 'posted',
        source: input.source || 'manual',
        book: input.book || null,
        amount: input.amount,
        date: input.date,
        categoryId: input.categoryId || null,
        accountId: input.accountId || null,
        fundedBy: input.fundedBy || null,
        projectId: input.projectId || null,
        title: input.title || '',
        note: input.note || '',
        refundOf: input.refundOf || null,
        fromAccount: input.fromAccount || null,
        toAccount: input.toAccount || null,
        fromBook: input.fromBook || null,
        toBook: input.toBook || null,
        settlesDue: !!input.settlesDue,
        deletedAt: null,
        version: 1,
        createdAt: now || new Date().toISOString(),
        updatedAt: now || new Date().toISOString()
      };
      if (e.kind === 'refund' && e.refundOf) {
        var orig = s.get(e.refundOf);
        if (!orig) return { ok: false, error: 'ไม่พบรายการเดิมที่จะคืนเงิน' };
        e.book = e.book || orig.book;
        e.categoryId = e.categoryId || orig.categoryId;
      }
      if (e.kind !== 'transfer' && !e.fundedBy) e.fundedBy = e.book;
      var err = validate(e);
      if (err) return { ok: false, error: err };
      e.id = nextId('txn');
      s.events.push(e);
      s.byRequest[e.requestId] = e.id;
      return { ok: true, event: e, duplicate: false };
    };

    /** แก้ไขพร้อมตรวจรุ่นข้อมูล · รุ่นไม่ตรง = มีอีกเครื่องแก้ก่อน ห้ามเขียนทับเงียบ ๆ */
    s.update = function (id, patch, expectedVersion, now) {
      var e = s.get(id);
      if (!e) return { ok: false, error: 'ไม่พบรายการ' };
      if (expectedVersion !== e.version) return { ok: false, conflict: true, current: Object.assign({}, e) };
      var next = Object.assign({}, e, patch, { id: e.id, requestId: e.requestId, version: e.version + 1, updatedAt: now || new Date().toISOString() });
      if (next.kind !== 'transfer' && (!next.fundedBy || patch.book && !patch.fundedBy && e.fundedBy === e.book)) next.fundedBy = next.book;
      var err = validate(next);
      if (err) return { ok: false, error: err };
      Object.assign(e, next);
      return { ok: true, event: e };
    };

    s.trash = function (id, now) {
      var e = s.get(id);
      if (!e) return { ok: false, error: 'ไม่พบรายการ' };
      e.deletedAt = now || new Date().toISOString();
      e.version += 1;
      return { ok: true, event: e };
    };
    s.restore = function (id) {
      var e = s.get(id);
      if (!e) return { ok: false, error: 'ไม่พบรายการ' };
      e.deletedAt = null;
      e.version += 1;
      return { ok: true, event: e };
    };

    /** รายการที่นับในยอด = บันทึกแล้ว และไม่อยู่ในถังขยะ */
    s.counted = function () {
      return s.events.filter(function (e) { return e.status === 'posted' && !e.deletedAt; });
    };

    return s;
  }

  // ---------- ผลของแต่ละรายการ ----------

  /**
   * แปลงรายการเป็นผลกระทบ 3 ชนิด
   * pnl   = รายรับ/รายจ่ายของสมุด (เงินโอนไม่มี pnl)
   * alloc = เงินในบัญชีจริงที่จัดสรรให้สมุดไหน เปลี่ยนเท่าไร
   * due   = ยอดที่สมุดหนึ่งค้างคืนอีกสมุด (จากการออกเงินแทน)
   */
  function effects(e) {
    var out = { pnl: null, alloc: [], due: null, missingAccount: false };
    if (e.kind === 'income') {
      out.pnl = { book: e.book, type: 'income', amount: e.amount, categoryId: e.categoryId };
      if (e.accountId) out.alloc.push({ accountId: e.accountId, book: e.book, delta: e.amount });
      else out.missingAccount = true;
    } else if (e.kind === 'expense') {
      var payer = e.fundedBy || e.book;
      out.pnl = { book: e.book, type: 'expense', amount: e.amount, categoryId: e.categoryId };
      if (e.accountId) out.alloc.push({ accountId: e.accountId, book: payer, delta: -e.amount });
      else out.missingAccount = true;
      if (payer !== e.book) out.due = { debtor: e.book, creditor: payer, delta: e.amount };
    } else if (e.kind === 'refund') {
      // คืนเงินจากร้าน: ลดรายจ่ายหมวดเดิม ไม่ใช่รายรับ
      out.pnl = { book: e.book, type: 'expense', amount: -e.amount, categoryId: e.categoryId };
      if (e.accountId) out.alloc.push({ accountId: e.accountId, book: e.book, delta: e.amount });
      else out.missingAccount = true;
    } else if (e.kind === 'transfer') {
      out.alloc.push({ accountId: e.fromAccount, book: e.fromBook, delta: -e.amount });
      out.alloc.push({ accountId: e.toAccount, book: e.toBook, delta: e.amount });
      if (e.settlesDue) out.due = { debtor: e.fromBook, creditor: e.toBook, delta: -e.amount };
    }
    return out;
  }

  /** ชื่อชนิดเงินโอนที่ Dan อ่านเข้าใจ */
  function transferLabel(e) {
    if (e.kind !== 'transfer') return '';
    if (e.settlesDue) return 'คืนเงินที่ออกแทน';
    if (e.fromBook === e.toBook) return 'โอนระหว่างบัญชี';
    if (e.fromAccount === e.toAccount) return 'ย้ายเงินข้ามสมุด (บัญชีเดียวกัน)';
    return 'โอนข้ามสมุด';
  }

  // ---------- รายงาน ----------

  /** สรุปรายรับ รายจ่าย ผลต่าง · book = 'personal' | 'work' | 'all' */
  function summary(store, q) {
    q = q || {};
    var book = q.book || 'all';
    var res = { income: 0, expense: 0, net: 0, byCategory: {}, perBook: { personal: { income: 0, expense: 0, net: 0 }, work: { income: 0, expense: 0, net: 0 } }, transfers: 0 };
    store.counted().forEach(function (e) {
      if (!inRange(e.date, q.from, q.to)) return;
      if (e.kind === 'transfer') { res.transfers += 1; return; }
      var p = effects(e).pnl;
      if (!p) return;
      var pb = res.perBook[p.book];
      pb[p.type] += p.amount;
      if (book !== 'all' && p.book !== book) return;
      res[p.type] += p.amount;
      if (p.type === 'expense') res.byCategory[p.categoryId || 'none'] = (res.byCategory[p.categoryId || 'none'] || 0) + p.amount;
    });
    BOOKS.forEach(function (b) { var x = res.perBook[b]; x.net = x.income - x.expense; });
    res.net = res.income - res.expense;
    return res;
  }

  /** ยอดคงเหลือตามที่บันทึก รายบัญชี แยกส่วนของแต่ละสมุด (ยอดจริงนับครั้งเดียว) */
  function balances(store, q) {
    q = q || {};
    var map = {};
    store.accounts.forEach(function (a) {
      map[a.id] = { account: a, byBook: { personal: a.opening.personal, work: a.opening.work }, real: 0 };
    });
    var missing = 0;
    store.counted().forEach(function (e) {
      if (q.to && e.date > q.to) return;
      var ef = effects(e);
      if (ef.missingAccount) missing += 1;
      ef.alloc.forEach(function (x) {
        if (!map[x.accountId]) return;
        map[x.accountId].byBook[x.book] += x.delta;
      });
    });
    var list = Object.keys(map).map(function (k) {
      var r = map[k];
      r.real = r.byBook.personal + r.byBook.work;
      return r;
    });
    var total = { personal: 0, work: 0, real: 0 };
    list.forEach(function (r) { total.personal += r.byBook.personal; total.work += r.byBook.work; total.real += r.real; });
    var noOpening = store.accounts.filter(function (a) { return !a.hasOpening; }).length;
    return { accounts: list, total: total, missingAccount: missing, noOpening: noOpening };
  }

  /** ยอดค้างคืนระหว่างสมุด · บวก = งานค้างคืนเงินส่วนตัว */
  function dues(store) {
    var workOwesPersonal = 0;
    store.counted().forEach(function (e) {
      var d = effects(e).due;
      if (!d) return;
      if (d.debtor === 'work' && d.creditor === 'personal') workOwesPersonal += d.delta;
      else if (d.debtor === 'personal' && d.creditor === 'work') workOwesPersonal -= d.delta;
    });
    return { workOwesPersonal: workOwesPersonal };
  }

  /** สถานะงบ · งบรวมคือเพดานเดียว งบหมวดเป็นส่วนย่อยของงบรวม ไม่บวกซ้ำ */
  function budget(store, book, month) {
    var b = store.budgets.find(function (x) { return x.book === book && x.month === month; });
    var r = monthRange(month);
    var sum = summary(store, { book: book, from: r.from, to: r.to });
    if (!b) return { exists: false, spent: sum.expense };
    var cats = Object.keys(b.categories).map(function (cid) {
      var spent = sum.byCategory[cid] || 0;
      return { categoryId: cid, limit: b.categories[cid], spent: spent, left: b.categories[cid] - spent };
    });
    var inCatBudgets = cats.reduce(function (t, c) { return t + c.spent; }, 0);
    var catLimits = cats.reduce(function (t, c) { return t + c.limit; }, 0);
    return {
      exists: true,
      total: b.total,
      spent: sum.expense,
      left: b.total - sum.expense,
      categories: cats,
      outsideCategoryBudgets: sum.expense - inCatBudgets,
      categoryLimitsSum: catLimits,
      categoryLimitsOverTotal: catLimits > b.total
    };
  }

  function goalProgress(goal) {
    var reserved = goal.reserves.reduce(function (t, r) { return t + r.amount; }, 0);
    return { reserved: reserved, left: Math.max(0, goal.target - reserved), pct: goal.target ? Math.min(100, Math.round(reserved * 100 / goal.target)) : 0 };
  }

  /** ค้นหาและกรอง (เคารพตัวกรองสมุดและช่วงวันที่) */
  function filter(store, q) {
    q = q || {};
    var text = (q.text || '').trim().toLowerCase();
    var amt = text ? toSatang(text) : null;
    return store.events.filter(function (e) {
      if (q.trash ? !e.deletedAt : e.deletedAt) return false;
      if (!q.includeDrafts && e.status === 'draft') return false;
      if (q.book && q.book !== 'all') {
        var inBook = e.kind === 'transfer' ? (e.fromBook === q.book || e.toBook === q.book) : e.book === q.book;
        if (!inBook && !(e.status === 'draft' && !e.book)) return false;
      }
      if (!inRange(e.date, q.from, q.to)) return false;
      if (q.kind && q.kind !== 'all' && (q.kind === 'expense' ? (e.kind !== 'expense' && e.kind !== 'refund') : e.kind !== q.kind)) return false;
      if (q.categoryId && e.categoryId !== q.categoryId) return false;
      if (q.accountId && e.accountId !== q.accountId && e.fromAccount !== q.accountId && e.toAccount !== q.accountId) return false;
      if (q.projectId && e.projectId !== q.projectId) return false;
      if (text) {
        var cat = store.category(e.categoryId);
        var hay = [e.title, e.note, cat && cat.name, (store.account(e.accountId) || {}).name, (store.project(e.projectId) || {}).name].join(' ').toLowerCase();
        if (hay.indexOf(text) < 0 && !(amt !== null && amt === e.amount)) return false;
      }
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); });
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var KIND_TH = { income: 'รายรับ', expense: 'รายจ่าย', refund: 'คืนเงินจากร้าน', transfer: 'โอน' };

  /** CSV สำหรับ Numbers/Excel · มี BOM ให้ภาษาไทยไม่เพี้ยน · จำนวนเงินมีเครื่องหมายตามผลต่อยอด */
  function toCSV(store, q) {
    q = q || {};
    var rows = [['รหัสรายการ', 'วันที่', 'สมุด', 'ประเภท', 'หมวด', 'บัญชี', 'รายละเอียด', 'โครงการ', 'จำนวนเงิน (บาท)', 'ผลต่อผลต่างเดือน (บาท)', 'หมายเหตุ']];
    store.counted().filter(function (e) {
      if (!inRange(e.date, q.from, q.to)) return false;
      if (q.book && q.book !== 'all') return e.kind === 'transfer' ? (e.fromBook === q.book || e.toBook === q.book) : e.book === q.book;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (e) {
      var p = effects(e).pnl;
      var signed = !p ? 0 : (p.type === 'income' ? p.amount : -p.amount);
      var bookTxt = e.kind === 'transfer' ? BOOK_TH[e.fromBook] + ' → ' + BOOK_TH[e.toBook] : BOOK_TH[e.book];
      var acc = e.kind === 'transfer'
        ? (store.account(e.fromAccount) || {}).name + ' → ' + (store.account(e.toAccount) || {}).name
        : (store.account(e.accountId) || {}).name || 'ยังไม่ระบุ';
      rows.push([e.id, e.date, bookTxt, e.kind === 'transfer' ? transferLabel(e) : KIND_TH[e.kind], (store.category(e.categoryId) || {}).name || '', acc, e.title, (store.project(e.projectId) || {}).name || '', plain(e.amount), plain(signed), e.note]);
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  return {
    BOOKS: BOOKS, BOOK_TH: BOOK_TH, KIND_TH: KIND_TH,
    toSatang: toSatang, fmt: fmt, plain: plain, bangkokDate: bangkokDate, monthRange: monthRange,
    createStore: createStore, effects: effects, transferLabel: transferLabel,
    summary: summary, balances: balances, dues: dues, budget: budget, goalProgress: goalProgress,
    filter: filter, toCSV: toCSV
  };
});
