/*
 * ชุดทดสอบยอด · ใช้ข้อมูลสมมติทั้งหมด
 * รันได้ทั้งใน node (node run-tests.js) และในหน้าต้นแบบ (เมนู เพิ่มเติม → ผลทดสอบยอด)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.runLedgerTests = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return function runLedgerTests(L) {
    var results = [];
    var rid = 0;
    function req() { rid += 1; return 'req-test-' + rid; }
    function t(group, name, fn) {
      try {
        var detail = fn();
        results.push({ group: group, name: name, pass: true, detail: detail || '' });
      } catch (err) {
        results.push({ group: group, name: name, pass: false, detail: err.message });
      }
    }
    function eq(a, b, label) {
      if (a !== b) throw new Error((label || 'ค่า') + ': ได้ ' + a + ' แต่ควรเป็น ' + b);
    }
    var B = function (n) { return n * 100; }; // บาท → สตางค์

    // ร้านทดสอบ: บัญชีหลักใช้ร่วมทั้งสองสมุด + เงินสด
    function fresh() {
      var s = L.createStore();
      s.addAccount({ id: 'main', name: 'บัญชีหลัก', openingDate: '2026-11-01', opening: { personal: B(10000), work: B(3000) } });
      s.addAccount({ id: 'cash', name: 'เงินสด', openingDate: '2026-11-01', opening: { personal: B(1000), work: 0 } });
      s.addAccount({ id: 'wallet', name: 'กระเป๋าออนไลน์', openingDate: '2026-11-01', opening: { personal: B(500), work: 0 } });
      s.addCategory({ id: 'food', book: 'personal', type: 'expense', name: 'อาหาร' });
      s.addCategory({ id: 'goods', book: 'personal', type: 'expense', name: 'ของใช้' });
      s.addCategory({ id: 'sale', book: 'work', type: 'income', name: 'ขายผลงาน' });
      s.addCategory({ id: 'equip', book: 'work', type: 'expense', name: 'อุปกรณ์' });
      return s;
    }
    var M = { from: '2026-11-01', to: '2026-11-30' };
    function sumP(s) { return L.summary(s, Object.assign({ book: 'personal' }, M)); }
    function sumW(s) { return L.summary(s, Object.assign({ book: 'work' }, M)); }
    function bal(s, acc) { return L.balances(s).accounts.find(function (r) { return r.account.id === acc; }); }

    // ---------- 5 เหตุการณ์จากตารางใน brief ----------
    var G1 = 'เหตุการณ์ตัวอย่างใน brief';
    var s = fresh();

    t(G1, 'ซื้อกาแฟส่วนตัว 80 บาท', function () {
      s.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(80), date: '2026-11-03', categoryId: 'food', accountId: 'cash', title: 'กาแฟ' });
      eq(sumP(s).expense, B(80), 'รายจ่ายส่วนตัว');
      eq(sumW(s).expense, 0, 'รายจ่ายงาน');
      eq(bal(s, 'cash').real, B(920), 'เงินสด');
      return 'รายจ่ายส่วนตัว 80 · เงินสดเหลือ 920';
    });

    t(G1, 'ขายภาพได้ 5,000 บาท', function () {
      s.save({ requestId: req(), kind: 'income', book: 'work', amount: B(5000), date: '2026-11-05', categoryId: 'sale', accountId: 'main', title: 'ขายภาพ' });
      eq(sumW(s).income, B(5000), 'รายรับงาน');
      eq(sumP(s).income, 0, 'รายรับส่วนตัว');
      eq(bal(s, 'main').real, B(18000), 'บัญชีหลัก');
      return 'รายรับงาน 5,000 · บัญชีหลัก 13,000 → 18,000';
    });

    t(G1, 'เติมเงินส่วนตัวให้งาน 2,000 บาท (บัญชีเดียวกัน)', function () {
      var before = { p: sumP(s), w: sumW(s), real: bal(s, 'main').real, bp: bal(s, 'main').byBook.personal, bw: bal(s, 'main').byBook.work };
      s.save({ requestId: req(), kind: 'transfer', fromBook: 'personal', toBook: 'work', fromAccount: 'main', toAccount: 'main', amount: B(2000), date: '2026-11-06', title: 'เติมทุนงาน' });
      eq(sumP(s).expense, before.p.expense, 'รายจ่ายส่วนตัว');
      eq(sumW(s).income, before.w.income, 'รายรับงาน');
      eq(bal(s, 'main').real, before.real, 'ยอดจริงบัญชีหลัก');
      eq(bal(s, 'main').byBook.personal, before.bp - B(2000), 'ส่วนของส่วนตัว');
      eq(bal(s, 'main').byBook.work, before.bw + B(2000), 'ส่วนของงาน');
      return 'รายรับรายจ่ายไม่เปลี่ยน · ส่วนตัว −2,000 งาน +2,000 · ยอดจริงเท่าเดิม';
    });

    t(G1, 'จ่ายอุปกรณ์งาน 600 บาทจากเงินส่วนตัว', function () {
      var realBefore = bal(s, 'cash').real;
      s.save({ requestId: req(), kind: 'expense', book: 'work', fundedBy: 'personal', amount: B(600), date: '2026-11-08', categoryId: 'equip', accountId: 'cash', title: 'กระดาษวาดรูป' });
      eq(sumW(s).expense, B(600), 'รายจ่ายงาน');
      eq(sumP(s).expense, B(80), 'รายจ่ายส่วนตัว (ยังเป็นแค่กาแฟ)');
      eq(bal(s, 'cash').real, realBefore - B(600), 'เงินสด');
      eq(L.dues(s).workOwesPersonal, B(600), 'งานค้างคืนส่วนตัว');
      return 'รายจ่ายงาน 600 ครั้งเดียว · งานค้างคืนส่วนตัว 600';
    });

    t(G1, 'คืนเงินออกแทนงาน 600 บาท', function () {
      var pw = sumW(s), pp = sumP(s);
      s.save({ requestId: req(), kind: 'transfer', fromBook: 'work', toBook: 'personal', fromAccount: 'main', toAccount: 'cash', settlesDue: true, amount: B(600), date: '2026-11-10', title: 'คืนค่ากระดาษ' });
      eq(sumW(s).expense, pw.expense, 'รายจ่ายงาน');
      eq(sumP(s).income, pp.income, 'รายรับส่วนตัว');
      eq(L.dues(s).workOwesPersonal, 0, 'ยอดค้างคืน');
      eq(sumW(s).expense, B(600), 'รายจ่ายงานรวม');
      return 'ไม่มีรายรับรายจ่ายเพิ่ม · ยอดค้างคืนเป็น 0 · รายจ่ายงานยังเป็น 600';
    });

    // ---------- เกณฑ์ตรวจรับเพิ่มเติม ----------
    var G2 = 'เกณฑ์ตรวจรับ';

    t(G2, 'รายจ่ายส่วนตัวไม่ไปโผล่ในยอดงาน และกลับกัน', function () {
      var s2 = fresh();
      s2.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(250), date: '2026-11-02', categoryId: 'food', accountId: 'main' });
      eq(sumW(s2).expense, 0, 'รายจ่ายงาน');
      s2.save({ requestId: req(), kind: 'expense', book: 'work', amount: B(400), date: '2026-11-02', categoryId: 'equip', accountId: 'main' });
      eq(sumP(s2).expense, B(250), 'รายจ่ายส่วนตัว');
      return 'ส่วนตัว 250 · งาน 400 ไม่ปนกัน';
    });

    t(G2, 'บัญชีเดียวใช้สองสมุด ยอดจริงไม่นับซ้ำ', function () {
      var b = L.balances(s);
      var main = bal(s, 'main');
      eq(main.real, main.byBook.personal + main.byBook.work, 'ยอดจริง = ส่วนตัว + งาน');
      eq(b.total.real, b.total.personal + b.total.work, 'ยอดรวมทุกบัญชี');
      // ตรวจกับการคิดมืออิสระ: ตั้งต้น 14,500 −80 +5,000 −600 = 18,820 (เงินโอนไม่เปลี่ยนยอดรวม)
      eq(b.total.real, B(18820), 'ยอดรวมทุกบัญชี');
      return 'ยอดรวมทุกบัญชี 18,820 = คิดมือ 14,500 − 80 + 5,000 − 600';
    });

    t(G2, 'มุมมองรวม = ส่วนตัว + งาน และไม่นับเงินโอน', function () {
      var all = L.summary(s, Object.assign({ book: 'all' }, M));
      eq(all.income, sumP(s).income + sumW(s).income, 'รายรับรวม');
      eq(all.expense, sumP(s).expense + sumW(s).expense, 'รายจ่ายรวม');
      eq(all.income, B(5000), 'รายรับรวม (เงินโอน 2,000 และ 600 ไม่ถูกนับ)');
      return 'รายรับรวม 5,000 · รายจ่ายรวม 680 · เงินโอน ' + all.transfers + ' รายการไม่ถูกนับ';
    });

    t(G2, 'โอนระหว่างบัญชีตัวเองในสมุดเดียวกัน', function () {
      var s3 = fresh();
      s3.save({ requestId: req(), kind: 'transfer', fromBook: 'personal', toBook: 'personal', fromAccount: 'main', toAccount: 'wallet', amount: B(1000), date: '2026-11-04' });
      eq(sumP(s3).income + sumP(s3).expense, 0, 'รายรับรายจ่าย');
      eq(bal(s3, 'main').real, B(12000), 'บัญชีหลัก');
      eq(bal(s3, 'wallet').real, B(1500), 'กระเป๋าออนไลน์');
      return 'บัญชีหลัก −1,000 · กระเป๋าออนไลน์ +1,000 · ผลต่างเดือนไม่เปลี่ยน';
    });

    t(G2, 'ส่งคำขอเดิมซ้ำ (เน็ตช้าแล้วกดซ้ำ) ไม่เกิดรายการซ้ำ', function () {
      var s4 = fresh();
      var input = { requestId: 'req-same', kind: 'expense', book: 'personal', amount: B(55), date: '2026-11-02', categoryId: 'food', accountId: 'cash' };
      var a = s4.save(input), b = s4.save(input), c = s4.save(input);
      eq(s4.events.length, 1, 'จำนวนรายการ');
      eq(b.event.id, a.event.id, 'รหัสรายการ');
      eq(c.duplicate, true, 'รู้ว่าเป็นคำขอซ้ำ');
      return 'ส่ง 3 ครั้ง ได้รายการเดียว รหัส ' + a.event.id;
    });

    t(G2, 'ย้ายเข้าถังขยะแล้วกู้คืน ยอดเปลี่ยนตาม', function () {
      var s5 = fresh();
      var r = s5.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(300), date: '2026-11-02', categoryId: 'goods', accountId: 'main' });
      s5.trash(r.event.id);
      eq(sumP(s5).expense, 0, 'รายจ่ายหลังลบ');
      eq(bal(s5, 'main').real, B(13000), 'บัญชีหลังลบ');
      s5.restore(r.event.id);
      eq(sumP(s5).expense, B(300), 'รายจ่ายหลังกู้คืน');
      eq(bal(s5, 'main').real, B(12700), 'บัญชีหลังกู้คืน');
      return 'ลบ: 0 → กู้คืน: 300';
    });

    t(G2, 'ฉบับร่างไม่นับในยอด งบ หรือกราฟ', function () {
      var s6 = fresh();
      s6.save({ requestId: req(), status: 'draft', source: 'slip', kind: 'expense', amount: B(1250), date: '2026-11-02' });
      eq(sumP(s6).expense + sumW(s6).expense, 0, 'รายจ่าย');
      eq(L.balances(s6).total.real, B(14500), 'ยอดรวม');
      return 'ร่าง 1,250 (ยังไม่รู้สมุด) ไม่ถูกนับ';
    });

    t(G2, 'คืนเงินจากร้านลดรายจ่ายหมวดเดิม ไม่เพิ่มรายรับ', function () {
      var s7 = fresh();
      var o = s7.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(1290), date: '2026-11-02', categoryId: 'goods', accountId: 'main' });
      s7.save({ requestId: req(), kind: 'refund', refundOf: o.event.id, amount: B(290), date: '2026-11-04', accountId: 'main' });
      eq(sumP(s7).income, 0, 'รายรับ');
      eq(sumP(s7).expense, B(1000), 'รายจ่าย');
      eq(sumP(s7).byCategory.goods, B(1000), 'หมวดของใช้');
      var bad = s7.save({ requestId: req(), kind: 'refund', amount: B(10), date: '2026-11-04', book: 'personal', accountId: 'main' });
      eq(bad.ok, false, 'คืนเงินที่ไม่ผูกรายการเดิมต้องไม่ผ่าน');
      return 'ของใช้ 1,290 − คืน 290 = 1,000 · รายรับยัง 0';
    });

    t(G2, 'ยอดตั้งต้นไม่เป็นรายรับ', function () {
      var s8 = fresh();
      eq(sumP(s8).income + sumW(s8).income, 0, 'รายรับ');
      eq(L.balances(s8).total.real, B(14500), 'ยอดคงเหลือตามที่บันทึก');
      return 'ตั้งต้น 14,500 อยู่ในยอดคงเหลือ ไม่อยู่ในรายรับ';
    });

    t(G2, 'กันเงินเพื่อเป้าหมายไม่เป็นรายจ่าย', function () {
      var s9 = fresh();
      var g = s9.addGoal({ book: 'personal', name: 'เงินสำรอง', target: B(10000) });
      s9.reserve(g.id, B(2500), '2026-11-02');
      eq(sumP(s9).expense, 0, 'รายจ่าย');
      eq(L.balances(s9).total.real, B(14500), 'ยอดคงเหลือ');
      eq(L.goalProgress(g).reserved, B(2500), 'ยอดที่กันไว้');
      return 'กันไว้ 2,500 · รายจ่ายยัง 0';
    });

    t(G2, 'สองเครื่องแก้รายการเดียวกัน ไม่เขียนทับเงียบ ๆ', function () {
      var s10 = fresh();
      var r = s10.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(100), date: '2026-11-02', categoryId: 'food', accountId: 'cash' });
      var v = r.event.version;
      var iphone = s10.update(r.event.id, { amount: B(120) }, v);
      var imac = s10.update(r.event.id, { amount: B(150) }, v);
      eq(iphone.ok, true, 'iPhone แก้ก่อน');
      eq(imac.conflict, true, 'iMac ต้องได้คำเตือน');
      eq(s10.get(r.event.id).amount, B(120), 'ยอดที่บันทึก');
      return 'iMac ได้คำเตือนชนกัน · ยอดยังเป็น 120 ของ iPhone';
    });

    t(G2, 'รายการใกล้เที่ยงคืนตกวันตามเวลากรุงเทพ', function () {
      eq(L.bangkokDate('2026-11-30T16:59:00Z'), '2026-11-30', '23:59 น. 30 พ.ย.');
      eq(L.bangkokDate('2026-11-30T17:00:00Z'), '2026-12-01', '00:00 น. 1 ธ.ค.');
      eq(L.monthRange('2026-02').to, '2026-02-28', 'วันสุดท้ายของ ก.พ. 2569');
      eq(L.monthRange('2028-02').to, '2028-02-29', 'ก.พ. ปีอธิกสุรทิน');
      return '23:59 น. อยู่ 30 พ.ย. · 00:00 น. อยู่ 1 ธ.ค.';
    });

    t(G2, 'ยอดสตางค์ไม่คลาดเคลื่อน', function () {
      eq(L.toSatang('0.10') + L.toSatang('0.20'), L.toSatang('0.30'), '0.10 + 0.20');
      eq(L.toSatang('1,234.56'), 123456, 'อ่าน 1,234.56');
      eq(L.toSatang('1.234'), null, 'ทศนิยม 3 ตำแหน่งต้องไม่ผ่าน');
      eq(L.toSatang('-5'), null, 'ติดลบต้องไม่ผ่าน');
      eq(L.fmt(123405), '1,234.05', 'แสดง 1,234.05');
      var s11 = fresh(), tot = 0;
      for (var i = 0; i < 100; i++) { s11.save({ requestId: req(), kind: 'expense', book: 'personal', amount: 1, date: '2026-11-02', categoryId: 'food', accountId: 'cash' }); tot += 1; }
      eq(sumP(s11).expense, 100, 'บวก 1 สตางค์ 100 ครั้ง');
      return '0.10 + 0.20 = 0.30 พอดี · 1 สตางค์ × 100 = 1.00 บาท';
    });

    t(G2, 'CSV ตรงกับหน้าจอ และภาษาไทยไม่เสีย', function () {
      var csv = L.toCSV(s, Object.assign({ book: 'all' }, M));
      eq(csv.charCodeAt(0), 0xFEFF, 'มี BOM ให้ Excel อ่านไทย');
      var lines = csv.slice(1).split('\n');
      eq(lines[0].indexOf('รหัสรายการ') === 0, true, 'หัวตารางภาษาไทย');
      var net = 0;
      lines.slice(1).forEach(function (ln) {
        var cells = ln.split(',');
        net += L.toSatang(cells[cells.length - 2].replace('-', '')) * (cells[cells.length - 2][0] === '-' ? -1 : 1);
      });
      var scr = L.summary(s, Object.assign({ book: 'all' }, M));
      eq(net, scr.net, 'ผลต่างจาก CSV เทียบหน้าจอ');
      eq(lines.length - 1, s.counted().length, 'จำนวนแถว');
      return 'ผลต่างใน CSV ' + L.fmt(net) + ' = หน้าจอ ' + L.fmt(scr.net) + ' · ' + (lines.length - 1) + ' แถว';
    });

    t(G2, 'งบรวมไม่ถูกบวกซ้ำกับงบหมวด', function () {
      var s12 = fresh();
      s12.setBudget({ book: 'personal', month: '2026-11', total: B(5000), categories: { food: B(2000), goods: B(1000) } });
      s12.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(500), date: '2026-11-02', categoryId: 'food', accountId: 'cash' });
      s12.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(700), date: '2026-11-02', categoryId: null, accountId: 'cash' });
      var b = L.budget(s12, 'personal', '2026-11');
      eq(b.total, B(5000), 'เพดานงบ');
      eq(b.spent, B(1200), 'ใช้ไป');
      eq(b.left, B(3800), 'เหลือ');
      eq(b.outsideCategoryBudgets, B(700), 'ใช้นอกงบหมวด');
      return 'งบ 5,000 ใช้ 1,200 เหลือ 3,800 (ไม่ใช่ 5,000 + 3,000)';
    });

    t(G2, 'รายการไม่ระบุบัญชี ระบบบอกว่ายอดคงเหลือยังไม่ครบ', function () {
      var s13 = fresh();
      s13.save({ requestId: req(), kind: 'expense', book: 'personal', amount: B(40), date: '2026-11-02', categoryId: 'food', title: 'ที่จอดรถ' });
      eq(sumP(s13).expense, B(40), 'ยังนับในรายจ่าย');
      eq(L.balances(s13).missingAccount, 1, 'จำนวนรายการไม่ระบุบัญชี');
      return 'นับในรายจ่าย · ยอดคงเหลือขึ้นเตือน 1 รายการ';
    });

    t(G2, 'รายรับรายจ่ายที่ไม่ระบุสมุด บันทึกไม่ได้ (ยกเว้นฉบับร่าง)', function () {
      var s14 = fresh();
      var r = s14.save({ requestId: req(), kind: 'expense', amount: B(300), date: '2026-11-02', accountId: 'cash' });
      eq(r.ok, false, 'ต้องไม่ผ่าน');
      return 'ข้อความ: ' + r.error;
    });

    return results;
  };
});
