/*
 * ตัวเชื่อมฐานข้อมูลจริง (Supabase) ของสมุดเงิน · รอบ 2
 * - รับ client ของ supabase-js ที่ล็อกอินแล้ว · ทุกคำสั่งทำงานด้วยสิทธิ์ของ Dan (RLS ที่ฐานข้อมูล)
 * - บันทึกผ่าน save_transaction · แก้ผ่าน update_transaction (ส่งรุ่นที่เห็นอยู่ไปด้วย)
 * - ยอดอ่านจาก view: v_balances v_pnl v_dues v_inbox v_missing_account · v_bank_check (รอบ 3 · ถ้ายังไม่ได้รัน 004 = ข้ามไป)
 * - แปลงแถวของฐานข้อมูลเป็นรูปเดียวกับ ledger.js เพื่อให้หน้าจอและแผนภูมิเดิมใช้ต่อได้ทั้งหมด
 * - ไม่มีข้อมูลจริงหรือคีย์ลับในไฟล์นี้
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Remote = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOOKS = ['personal', 'work'];
  var PAGE = 1000; // Data API ส่งได้ครั้งละไม่เกิน 1,000 แถว

  // ---------- แปลงชื่อช่อง ----------
  var TX = {
    requestId: 'request_id', kind: 'kind', status: 'status', source: 'source', sourceRef: 'source_ref',
    book: 'book', amount: 'amount', date: 'date', occurredAt: 'occurred_at', categoryId: 'category_id',
    accountId: 'account_id', fundedBy: 'funded_by', projectId: 'project_id', payee: 'payee', title: 'title',
    note: 'note', refundOf: 'refund_of', fromAccount: 'from_account', toAccount: 'to_account',
    fromBook: 'from_book', toBook: 'to_book', settlesDue: 'settles_due', deletedAt: 'deleted_at'
  };
  var NULLABLE = { categoryId: 1, accountId: 1, fundedBy: 1, projectId: 1, refundOf: 1, fromAccount: 1, toAccount: 1, fromBook: 1, toBook: 1, book: 1, sourceRef: 1, occurredAt: 1, payee: 1, deletedAt: 1 };

  /** ช่องแบบหน้าจอ (camelCase) → แถวฐานข้อมูล (snake_case) · ช่องว่างของรหัส = null */
  function txToRow(o) {
    var r = {};
    Object.keys(TX).forEach(function (k) {
      if (!(k in o) || o[k] === undefined) return;
      var v = o[k];
      if (NULLABLE[k] && v === '') v = null;
      r[TX[k]] = v;
    });
    return r;
  }
  function num(v) { return v == null ? 0 : Number(v); }
  /** แถวฐานข้อมูล → รายการแบบ ledger.js */
  function rowToTx(r) {
    var e = { id: r.id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at };
    Object.keys(TX).forEach(function (k) { e[k] = r[TX[k]] === undefined ? null : r[TX[k]]; });
    e.amount = num(r.amount);
    e.settlesDue = !!r.settles_due;
    e.title = r.title || '';
    e.note = r.note || '';
    return e;
  }
  function accToStore(a) {
    return {
      id: a.id, name: a.name, kind: a.kind, bankHint: a.bank_hint || '', openingDate: a.opening_date || null,
      opening: { personal: num(a.opening_personal), work: num(a.opening_work) }, hasOpening: !!a.has_opening, archived: !!a.archived
    };
  }
  function accToRow(a) {
    var r = { name: a.name, kind: a.kind || 'bank', bank_hint: a.bankHint || null, opening_date: a.openingDate || null, archived: !!a.archived };
    if (a.opening) { r.opening_personal = a.opening.personal || 0; r.opening_work = a.opening.work || 0; }
    if ('hasOpening' in a) r.has_opening = !!a.hasOpening;
    return r;
  }

  // ---------- คำขอ ----------
  function check(res) {
    if (res.error) {
      var e = new Error(res.error.message || 'ฐานข้อมูลตอบกลับผิดพลาด');
      e.code = res.error.code; e.details = res.error.details;
      throw e;
    }
    return res.data;
  }
  function fetchAll(client, table, orderCols) {
    var out = [];
    function page(from) {
      var q = client.from(table).select('*');
      orderCols.forEach(function (c) { q = q.order(c, { ascending: true }); });
      return q.range(from, from + PAGE - 1).then(function (res) {
        var rows = check(res) || [];
        out = out.concat(rows);
        return rows.length === PAGE ? page(from + PAGE) : out;
      });
    }
    return page(0);
  }

  var LOAD = {
    accounts: ['accounts', ['created_at', 'id']],
    categories: ['categories', ['sort', 'created_at', 'id']],
    projects: ['projects', ['created_at', 'id']],
    transactions: ['transactions', ['created_at', 'id']],
    budgets: ['budgets', ['book', 'month']],
    budgetCats: ['budget_categories', ['book', 'month', 'category_id']],
    goals: ['goals', ['created_at', 'id']],
    reserves: ['goal_reserves', ['created_at', 'id']],
    recurring: ['recurring', ['created_at', 'id']],
    quick: ['quick_items', ['sort', 'id']],
    vBalances: ['v_balances', ['account_id']],
    vPnl: ['v_pnl', ['id']],
    vDues: ['v_dues', ['user_id']],
    vInbox: ['v_inbox', ['created_at', 'id']],
    vMissing: ['v_missing_account', ['id']],
    vBankCheck: ['v_bank_check', ['account_id'], true] // ไม่บังคับ: ยังไม่ได้รัน 004 → ไม่มีการเทียบยอดกับ SMS แต่แอปใช้ได้ตามปกติ
  };

  /** โหลดทุกตารางและ view ของผู้ใช้ที่ล็อกอินอยู่ */
  function loadAll(client) {
    var keys = Object.keys(LOAD);
    return Promise.all(keys.map(function (k) {
      var p = fetchAll(client, LOAD[k][0], LOAD[k][1]);
      return LOAD[k][2] ? p.catch(function () { return []; }) : p;
    })).then(function (lists) {
      var raw = {};
      keys.forEach(function (k, i) { raw[k] = lists[i]; });
      return raw;
    });
  }

  /** สร้างที่เก็บข้อมูลรูปเดียวกับ ledger.js จากข้อมูลที่โหลดมา + แนบยอดจาก view */
  function buildStore(L, raw) {
    var s = L.createStore();
    raw.accounts.forEach(function (a) { s.accounts.push(accToStore(a)); });
    raw.categories.forEach(function (c) { s.categories.push({ id: c.id, book: c.book, type: c.type, name: c.name, sort: c.sort || 0, archived: !!c.archived }); });
    raw.projects.forEach(function (p) { s.projects.push({ id: p.id, name: p.name, archived: !!p.archived }); });
    raw.transactions.forEach(function (r) { var e = rowToTx(r); s.events.push(e); s.byRequest[e.requestId] = e.id; });
    raw.budgets.forEach(function (b) { s.budgets.push({ book: b.book, month: b.month, total: num(b.total), categories: {} }); });
    raw.budgetCats.forEach(function (c) {
      var b = s.budgets.find(function (x) { return x.book === c.book && x.month === c.month; });
      if (b) b.categories[c.category_id] = num(c.amount);
    });
    raw.goals.forEach(function (g) { s.goals.push({ id: g.id, book: g.book, name: g.name, target: num(g.target), archived: !!g.archived, reserves: [] }); });
    raw.reserves.forEach(function (r) {
      var g = s.goals.find(function (x) { return x.id === r.goal_id; });
      if (g) g.reserves.push({ id: r.id, amount: num(r.amount), date: r.date });
    });
    s.recurring = raw.recurring.map(function (r) { return { id: r.id, name: r.name, template: r.template || {}, dayOfMonth: r.day_of_month, nextDate: r.next_date, active: !!r.active }; });
    s.quick = raw.quick.map(function (q) { return { id: q.id, label: q.label, template: q.template || {}, sort: q.sort || 0 }; });
    s.views = {
      balances: raw.vBalances.map(function (b) { return { accountId: b.account_id, personal: num(b.personal), work: num(b.work), real: num(b.real) }; }),
      pnl: raw.vPnl.map(function (p) { return { id: p.id, date: p.date, book: p.book, categoryId: p.category_id, projectId: p.project_id, type: p.type, amount: num(p.amount) }; }),
      dues: raw.vDues.length ? num(raw.vDues[0].work_owes_personal) : 0,
      inbox: raw.vInbox.map(function (r) { return r.id; }),
      missing: raw.vMissing.length,
      bankCheck: (raw.vBankCheck || []).map(function (b) { return { accountId: b.account_id, name: b.name, at: b.at, bank: num(b.bank_balance), app: num(b.app_balance), drafts: Number(b.drafts_before) || 0 }; }),
      loadedAt: new Date()
    };
    return s;
  }

  // ---------- ยอดจาก view (รูปผลลัพธ์เดียวกับ ledger.js) ----------
  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }

  function summary(s, q) {
    q = q || {};
    var book = q.book || 'all';
    var res = { income: 0, expense: 0, net: 0, byCategory: {}, perBook: { personal: { income: 0, expense: 0, net: 0 }, work: { income: 0, expense: 0, net: 0 } }, transfers: 0 };
    s.views.pnl.forEach(function (p) {
      if (!inRange(p.date, q.from, q.to)) return;
      res.perBook[p.book][p.type] += p.amount;
      if (book !== 'all' && p.book !== book) return;
      res[p.type] += p.amount;
      if (p.type === 'expense') res.byCategory[p.categoryId || 'none'] = (res.byCategory[p.categoryId || 'none'] || 0) + p.amount;
    });
    s.counted().forEach(function (e) { if (e.kind === 'transfer' && inRange(e.date, q.from, q.to)) res.transfers += 1; });
    BOOKS.forEach(function (b) { var x = res.perBook[b]; x.net = x.income - x.expense; });
    res.net = res.income - res.expense;
    return res;
  }

  function balances(s) {
    var byId = {};
    s.views.balances.forEach(function (b) { byId[b.accountId] = b; });
    var list = s.accounts.map(function (a) {
      var b = byId[a.id] || { personal: a.opening.personal, work: a.opening.work, real: a.opening.personal + a.opening.work };
      return { account: a, byBook: { personal: b.personal, work: b.work }, real: b.real };
    });
    var total = { personal: 0, work: 0, real: 0 };
    list.forEach(function (r) { total.personal += r.byBook.personal; total.work += r.byBook.work; total.real += r.real; });
    return { accounts: list, total: total, missingAccount: s.views.missing, noOpening: s.accounts.filter(function (a) { return !a.hasOpening && !a.archived; }).length };
  }

  function dues(s) { return { workOwesPersonal: s.views.dues }; }

  function budget(s, L, book, month) {
    var b = s.budgets.find(function (x) { return x.book === book && x.month === month; });
    var r = L.monthRange(month);
    var sum = summary(s, { book: book, from: r.from, to: r.to });
    if (!b) return { exists: false, spent: sum.expense };
    var cats = Object.keys(b.categories).map(function (cid) {
      var spent = sum.byCategory[cid] || 0;
      return { categoryId: cid, limit: b.categories[cid], spent: spent, left: b.categories[cid] - spent };
    });
    var inCat = cats.reduce(function (t, c) { return t + c.spent; }, 0);
    var lim = cats.reduce(function (t, c) { return t + c.limit; }, 0);
    return { exists: true, total: b.total, spent: sum.expense, left: b.total - sum.expense, categories: cats, outsideCategoryBudgets: sum.expense - inCat, categoryLimitsSum: lim, categoryLimitsOverTotal: lim > b.total };
  }

  /** รายจ่ายรายวันของเดือน (ใช้กับแผนภูมิใช้เงินเร็วแค่ไหน) */
  function dailyExpense(s, book, from, to, days) {
    var daily = []; for (var i = 0; i < days; i++) daily.push(0);
    s.views.pnl.forEach(function (p) {
      if (p.type !== 'expense' || !inRange(p.date, from, to)) return;
      if (book !== 'all' && p.book !== book) return;
      daily[+p.date.slice(8) - 1] += p.amount;
    });
    return daily;
  }

  /**
   * ตรวจไขว้: ยอดจาก view ของฐานข้อมูล ต้องตรงกับที่ ledger.js คำนวณจากรายการชุดเดียวกัน
   * คืนรายการจุดที่ไม่ตรง (ว่าง = ตรงทั้งหมด)
   */
  function crossCheck(s, L) {
    var bad = [];
    var a = summary(s, {}), b = L.summary(s, {});
    BOOKS.forEach(function (bk) { ['income', 'expense'].forEach(function (t) { if (a.perBook[bk][t] !== b.perBook[bk][t]) bad.push(bk + ' ' + t + ': ฐานข้อมูล ' + a.perBook[bk][t] + ' / ในเครื่อง ' + b.perBook[bk][t]); }); });
    var vb = balances(s), lb = L.balances(s);
    lb.accounts.forEach(function (r) {
      var v = vb.accounts.find(function (x) { return x.account.id === r.account.id; });
      if (!v || v.byBook.personal !== r.byBook.personal || v.byBook.work !== r.byBook.work) bad.push('ยอดบัญชี ' + r.account.name);
    });
    if (vb.missingAccount !== lb.missingAccount) bad.push('จำนวนรายการไม่ระบุบัญชี');
    if (dues(s).workOwesPersonal !== L.dues(s).workOwesPersonal) bad.push('ยอดค้างคืนระหว่างสมุด');
    var drafts = s.events.filter(function (e) { return e.status === 'draft' && !e.deletedAt; }).length;
    if (drafts !== s.views.inbox.length) bad.push('จำนวนร่างในกล่องรอยืนยัน');
    return bad;
  }

  // ---------- เขียน ----------
  function create(client) {
    var api = {
      client: client,
      loadAll: function () { return loadAll(client); },

      /** บันทึกรายการ · requestId เดิม = คืนรายการเดิม ไม่สร้างซ้ำ */
      saveTxn: function (input) {
        return client.rpc('save_transaction', { p: txToRow(input) }).then(function (res) {
          var d = check(res);
          var row = Array.isArray(d) ? d[0] : d;
          return { ok: true, event: rowToTx(row.txn), duplicate: !!row.duplicate };
        });
      },
      /** แก้รายการ · รุ่นไม่ตรง → { conflict, current } ไม่เขียนทับ */
      updateTxn: function (id, patch, expectedVersion) {
        var p = txToRow(patch);
        delete p.request_id;
        return client.rpc('update_transaction', { p_id: id, p_patch: p, p_expected_version: expectedVersion }).then(function (res) {
          var d = check(res);
          var row = Array.isArray(d) ? d[0] : d;
          return row.conflict ? { ok: false, conflict: true, current: rowToTx(row.txn) } : { ok: true, event: rowToTx(row.txn) };
        });
      },

      saveAccount: function (a) {
        var row = accToRow(a);
        var q = a.id ? client.from('accounts').update(row).eq('id', a.id) : client.from('accounts').insert(row);
        return q.then(check);
      },
      saveCategory: function (c) {
        var row = { book: c.book, type: c.type, name: c.name, archived: !!c.archived };
        if (c.sort != null) row.sort = c.sort;
        var q = c.id ? client.from('categories').update({ name: c.name, archived: !!c.archived }).eq('id', c.id) : client.from('categories').insert(row);
        return q.then(check);
      },
      addCategories: function (list) { return client.from('categories').insert(list).then(check); },
      saveProject: function (p) {
        var q = p.id ? client.from('projects').update({ name: p.name, archived: !!p.archived }).eq('id', p.id) : client.from('projects').insert({ name: p.name });
        return q.then(check);
      },
      setBudget: function (book, month, total, cats) {
        return client.rpc('set_budget', { p_book: book, p_month: month, p_total: total, p_cats: cats || {} }).then(check);
      },
      saveGoal: function (g) {
        var q = g.id ? client.from('goals').update({ name: g.name, target: g.target, archived: !!g.archived }).eq('id', g.id)
          : client.from('goals').insert({ book: g.book, name: g.name, target: g.target });
        return q.then(check);
      },
      reserve: function (goalId, amount, date) { return client.from('goal_reserves').insert({ goal_id: goalId, amount: amount, date: date }).then(check); },
      saveQuick: function (q) {
        var row = { label: q.label, template: q.template, sort: q.sort || 0 };
        return (q.id ? client.from('quick_items').update(row).eq('id', q.id) : client.from('quick_items').insert(row)).then(check);
      },
      deleteQuick: function (id) { return client.from('quick_items').delete().eq('id', id).then(check); },
      saveRecurring: function (r) {
        var row = { name: r.name, template: r.template, day_of_month: r.dayOfMonth, next_date: r.nextDate, active: r.active !== false };
        return (r.id ? client.from('recurring').update(row).eq('id', r.id) : client.from('recurring').insert(row)).then(check);
      },
      deleteRecurring: function (id) { return client.from('recurring').delete().eq('id', id).then(check); },
      runRecurring: function (today) { return client.rpc('run_recurring', { p_today: today }).then(check).then(function (n) { return Number(n) || 0; }); },
      backup: function () { return client.rpc('backup_snapshot').then(check); }
    };
    return api;
  }

  return {
    create: create, buildStore: buildStore, txToRow: txToRow, rowToTx: rowToTx,
    summary: summary, balances: balances, dues: dues, budget: budget, dailyExpense: dailyExpense, crossCheck: crossCheck
  };
});
