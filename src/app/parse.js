/* レシートOCRテキストから 合計・日付・店名 を推定する */
(function (g) {
  "use strict";

  function toHalf(s) {
    return s
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/[，、]/g, ",").replace(/[．。]/g, ".").replace(/：/g, ":")
      .replace(/／/g, "/").replace(/[－ー−–—](?=\d)/g, "-")
      .replace(/[￥\\]/g, "¥").replace(/　/g, " ");
  }

  var CJK = "぀-ヿ㐀-鿿ｦ-ﾟ";
  var reCjkGap = new RegExp("([" + CJK + "])\\s+(?=[" + CJK + "])", "g");

  // OCRのよくある読み違いを直す（¥→半/Y/羊、0→O、1→l など）
  function fixNumbers(l) {
    return l
      .replace(/[半羊芋辛Y](?=\s*[\dlIOo])/g, "¥")
      .replace(/(\d)\s*[Oo〇]/g, "$10").replace(/[Oo〇](?=\s*\d)/g, function (m, i, all) { return /[\d¥,]/.test(all.charAt(i - 1) || "") ? "0" : m; })
      .replace(/(\d)\s*[lI|]/g, "$11").replace(/[lI|](?=\d)/g, function (m, i, all) { return /[\d¥,]/.test(all.charAt(i - 1) || "") ? "1" : m; })
      .replace(/(\d)\s*,\s*(?=\d{3}(?!\d))/g, "$1,")              // "1 , 080" → "1,080"
      .replace(/(\d)\s*\.\s*(?=\d{3}(?!\d))/g, "$1,")             // "1.080" → "1,080"
      .replace(/¥\s+(?=\d)/g, "¥")
      .replace(/(\d)\s+(?=\d{3}(?!\d))/g, function (m, d, i, all) { // "1 080" → "1080"（¥直後の金額のみ）
        var before = all.slice(Math.max(0, i - 6), i + 1);
        return /¥\d{1,3}$/.test(before) ? d : m;
      })
      .replace(/¥[\d,\s]+/g, function (m) { return m.replace(/\s+/g, "").replace(/,?$/, "") + " "; })   // "¥1 6 0" → "¥160"
      .replace(/(^|[^\d\s])\s*(\d(?: ,?\d){2,6})\s*$/, function (m, a, d) { return a + " " + d.replace(/[\s]/g, ""); }) // 行末の "3 6 0"
      .replace(/(\d)\s*[※*＊軽]+/g, "$1")
      .replace(/(\d)円/g, "$1");
  }

  function normLine(l) {
    return fixNumbers(toHalf(l).replace(reCjkGap, "$1")).replace(/\s+/g, " ").trim();
  }

  // 行（または行の一部）から金額らしい数値を取り出す。右端（最後）の値を優先。
  function amountsIn(s) {
    var out = [];
    var re = /(¥)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?![\d%点個gｇ:\/.年月日時分])/g, m;
    while ((m = re.exec(s))) {
      var raw = m[2];
      var prev = s.charAt(m.index - 1);
      if (/[\d\/:\-.]/.test(prev)) continue;                       // 日付・時刻・電話番号の一部
      var n = parseInt(raw.replace(/,/g, ""), 10);
      if (n > 0 && n < 10000000) out.push({ n: n, yen: !!m[1] || /,/.test(raw) });
    }
    return out;
  }

  // 「合計」はOCRで「合言十」「合訂」「含計」などに化けやすい
  var STRONG = /(合[計言訂許汁針什卞]|含計|合言十|総[計言]|会計|請求|お?支払|お買[上い]|税込[計合]|ご利用額)/;
  var SUB = /小[計言訂]/;
  var EXCLUDE = /(預|釣|対象|消費税|内税|外税|税額|税率|税等|点数|ポイント|pt|値引|割引|クーポン|残高|税|現金|お返し|おつり|釣銭|交通系|クレジット|電子マネー|ID|No)/;
  var NOT_ITEM = /(TEL|電話|登録番号|領収|レシート|責|担当|レジ|店|No\.|#|\d{4}[\/年.-]\d{1,2}|\d{1,2}:\d{2})/;

  function findTotal(lines) {
    var strong = [], sub = [], yenAll = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var excl = EXCLUDE.test(l.replace(/税込/g, ""));
      var am = amountsIn(l);
      if (!excl) am.forEach(function (a) { if (a.yen) yenAll.push(a.n); });
      if (excl) continue;
      var isSub = SUB.test(l);
      var isStrong = !isSub && STRONG.test(l);
      if (!isStrong && !isSub) continue;
      var key = l.match(isStrong ? STRONG : SUB);
      var vals = amountsIn(l.slice(key.index + key[0].length));
      if (!vals.length && i + 1 < lines.length && !EXCLUDE.test(lines[i + 1])) vals = amountsIn(lines[i + 1]);
      if (!vals.length) continue;
      (isStrong ? strong : sub).push(vals[vals.length - 1].n);
    }
    if (strong.length) return { value: Math.max.apply(null, strong), sure: true };
    if (sub.length) return { value: Math.max.apply(null, sub), sure: false };
    var items = findItems(lines);
    if (items.length > 1) return { value: items.reduce(function (s, it) { return s + it.price; }, 0), sure: false };
    if (yenAll.length) return { value: Math.max.apply(null, yenAll), sure: false };
    return null;
  }

  // 品目（名前＋右端の金額）を拾う
  function findItems(lines) {
    var items = [];
    var started = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (SUB.test(l) || STRONG.test(l)) { if (started) break; else continue; }
      if (EXCLUDE.test(l.replace(/税込/g, "")) || NOT_ITEM.test(l)) continue;
      var m = l.match(/^(.*?[A-Za-z぀-ヿ㐀-鿿ｦ-ﾟ].*?)\s*(¥?\s?(?:\d{1,3}(?:,\d{3})+|\d+))\s*$/);
      if (!m) continue;
      var name = m[1].replace(/[\s.・…:]+$/, "").replace(/^[\s*※・]+/, "").trim();
      var price = parseInt(m[2].replace(/[¥,\s]/g, ""), 10);
      var letters = (name.match(new RegExp("[" + CJK + "A-Za-z]", "g")) || []).length;
      if (letters < 2 || !price || price > 1000000) continue;
      if (!/[¥,]/.test(m[2]) && price < 10) continue;
      items.push({ name: name.slice(0, 30), price: price });
      started = true;
      if (items.length >= 40) break;
    }
    return items;
  }

  // 「合計」が読めなかった時にユーザーが選べる候補（多い順に最大6つ）
  function findCandidates(lines, total) {
    var seen = {}, out = [];
    function add(n) { if (!seen[n] && n >= 10) { seen[n] = 1; out.push(n); } }
    if (total) add(total);
    var all = [];
    lines.forEach(function (l) { if (!/(預|釣|お返し|おつり|税|点数|TEL|電話)/.test(l)) amountsIn(l).forEach(function (a) { all.push(a); }); });
    all.filter(function (a) { return a.yen; }).sort(function (a, b) { return b.n - a.n; }).forEach(function (a) { add(a.n); });
    all.sort(function (a, b) { return b.n - a.n; }).forEach(function (a) { add(a.n); });
    return out.slice(0, 6);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function findDate(text, now) {
    now = now || new Date();
    var t = toHalf(text).replace(reCjkGap, "$1");
    var cands = [];
    var m, re;
    re = /(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/g;
    while ((m = re.exec(t))) cands.push([+m[1], +m[2], +m[3]]);
    re = /令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/g;
    while ((m = re.exec(t))) cands.push([2018 + (m[1] === "元" ? 1 : +m[1]), +m[2], +m[3]]);
    re = /R\s*(\d{1,2})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/g;
    while ((m = re.exec(t))) cands.push([2018 + +m[1], +m[2], +m[3]]);
    re = /(?:^|[^\d])(\d{2})[\/.](\d{1,2})[\/.](\d{1,2})(?!\d)/g;
    while ((m = re.exec(t))) cands.push([2000 + +m[1], +m[2], +m[3]]);
    var y0 = now.getFullYear();
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c[0] < y0 - 2 || c[0] > y0 + 1 || c[1] < 1 || c[1] > 12 || c[2] < 1 || c[2] > 31) continue;
      return c[0] + "-" + pad(c[1]) + "-" + pad(c[2]);
    }
    return null;
  }

  var SKIP_STORE = /(領収|レシート|いらっしゃ|ありがと|登録番号|TEL|Tel|電話|毎度|ご来店|営業時間|http|www|#|No\.|責)/;

  function findStore(lines) {
    var picked = -1;
    for (var i = 0; i < Math.min(lines.length, 7); i++) {
      var l = lines[i];
      if (!l || SKIP_STORE.test(l)) continue;
      if (/\d{2,4}-\d{2,4}-\d{3,4}/.test(l) || /T\d{10,}/.test(l)) continue;
      if (/\d{4}[\/年.-]\d{1,2}/.test(l)) continue;
      var letters = (l.match(new RegExp("[" + CJK + "A-Za-z]", "g")) || []).length;
      if (letters < 2 || letters < l.replace(/\s/g, "").length * 0.5) continue;
      picked = i; break;
    }
    if (picked < 0) return null;
    var name = lines[picked].replace(/[^\s0-9A-Za-z&'・ー\-぀-ヿ㐀-鿿ｦ-ﾟ]/g, "").trim();
    var next = lines[picked + 1];
    if (next && /店$/.test(next.replace(/\s/g, "")) && next.length <= 16 && !/店$/.test(name)) {
      name += " " + next.replace(/\s/g, "");
    }
    return name.slice(0, 30) || null;
  }

  var CAT_RULES = [
    ["外食", /(すき家|吉野家|松屋|マクドナルド|マック|モス|ケンタッキー|サイゼリヤ|ガスト|スターバックス|スタバ|ドトール|タリーズ|コメダ|CoCo壱|ココイチ|ラーメン|らーめん|食堂|カフェ|珈琲|寿司|すし|居酒屋|丸亀|はなまる|バーミヤン|ジョナサン|デニーズ|餃子の王将|日高屋|天丼|てんや|レストラン)/],
    ["食費", /(セブン|ローソン|ファミリーマート|ファミマ|ミニストップ|デイリー|イオン|AEON|西友|イトーヨーカドー|ヨーカドー|ライフ|マルエツ|まいばすけっと|ベルク|ヤオコー|業務スーパー|OK|オーケー|スーパー|成城石井|カルディ|肉|青果|ベーカリー|パン)/],
    ["日用品", /(マツモトキヨシ|マツキヨ|ウエルシア|ツルハ|サンドラッグ|ココカラ|スギ薬局|ドラッグ|薬局|ダイソー|DAISO|セリア|キャンドゥ|ニトリ|無印|MUJI|ホームセンター|カインズ|コーナン|ロフト|ハンズ)/],
    ["交通", /(JR|鉄道|駅|バス|タクシー|交通|Suica|PASMO|メトロ|京成|京葉|モノレール|ENEOS|出光|コスモ石油|ガソリン|駐車)/],
    ["衣服", /(ユニクロ|UNIQLO|GU|しまむら|ZARA|H&M|ABC-MART|靴)/],
    ["趣味", /(書店|本屋|紀伊國屋|TSUTAYA|蔦屋|ブックオフ|アニメイト|ゲーム|ヨドバシ|ビックカメラ|映画|シネマ|カラオケ)/],
    ["医療", /(病院|クリニック|医院|歯科|調剤)/],
    ["通信", /(ドコモ|docomo|au|ソフトバンク|楽天モバイル|ahamo|povo)/]
  ];

  function guessCategory(store, text) {
    // 店名で決まればそれを優先し、決まらない時だけ本文の先頭を見る
    var i;
    if (store) for (i = 0; i < CAT_RULES.length; i++) if (CAT_RULES[i][1].test(store)) return CAT_RULES[i][0];
    var s = (text || "").slice(0, 120);
    for (i = 0; i < CAT_RULES.length; i++) if (CAT_RULES[i][1].test(s)) return CAT_RULES[i][0];
    return null;
  }

  // Google レンズ等で「品名の列」と「金額の列」が別々にコピーされた時、行ごとに組み直す
  function rejoinColumns(lines) {
    var isAmt = function (l) { return /^[(（]?\s*¥?\s?-?(\d{1,3}(,\d{3})+|\d+)\s*[)）]?$/.test(l) && /¥|,|\d{2,}/.test(l); };
    var out = lines.slice();
    for (var guard = 0; guard < 10; guard++) {
      var best = null;
      for (var i = 0; i < out.length; i++) {
        if (!isAmt(out[i])) continue;
        var j = i; while (j < out.length && isAmt(out[j])) j++;
        var k = j - i;
        if (k >= 3 && i - k >= 0) {
          var labels = out.slice(i - k, i);
          if (labels.every(function (l) { return !isAmt(l) && !/\d{1,3},\d{3}|¥\d/.test(l); })) { best = [i, j, k]; break; }
        }
        i = j;
      }
      if (!best) break;
      var st = best[0], en = best[1], n = best[2];
      var merged = [];
      for (var m = 0; m < n; m++) merged.push(out[st - n + m] + " " + out[st + m]);
      out = out.slice(0, st - n).concat(merged, out.slice(en));
    }
    return out;
  }

  function parseReceipt(text, now) {
    var lines = String(text || "").split(/\r?\n/).map(normLine).filter(function (l) { return l.length; });
    lines = rejoinColumns(lines);
    var total = findTotal(lines);
    var store = findStore(lines);
    var items = findItems(lines);
    return {
      total: total ? total.value : null,
      items: items,
      candidates: findCandidates(lines, total && total.value),
      totalSure: total ? total.sure : false,
      date: findDate(lines.join("\n"), now),
      store: store,
      category: guessCategory(store, lines.join("\n")),
      lines: lines
    };
  }

  /* ---------- カード明細CSV ---------- */
  function csvRows(text) {
    var rows = [], row = [], f = "", q = false;
    text = text.replace(/^﻿/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === "," || c === "\t") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return toHalf(x).trim(); }); });
  }
  function cellDate(s, now) {
    var m = s.match(/^(20\d{2}|\d{2})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?$/);
    if (!m) m = s.match(/^(20\d{2})(\d{2})(\d{2})$/);
    if (!m) return null;
    var y = +m[1]; if (y < 100) y += 2000;
    var mo = +m[2], d = +m[3], y0 = (now || new Date()).getFullYear();
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < y0 - 5 || y > y0 + 1) return null;
    return y + "-" + pad(mo) + "-" + pad(d);
  }
  function cellAmount(s) {
    var t = s.replace(/[¥円\s]/g, "");
    if (!/^-?\d{1,3}(,\d{3})*$|^-?\d+$/.test(t)) return null;
    return parseInt(t.replace(/,/g, ""), 10);
  }
  // 楽天カード / Vpass / MyJCB 等の形式差を吸収するため、見出しがあれば列名で、なければ中身で列を決める
  function parseCardCsv(text, now) {
    var rows = csvRows(text).filter(function (r) { return r.some(function (c) { return c; }); });
    var H = { date: /(利用日|ご利用日|取引日|日付|購入日)/, store: /(利用店|ご利用先|加盟店|摘要|内容|店名|利用先|ご利用内容)/, amount: /(利用金額|ご利用金額|請求金額|支払金額|金額|支払総額)/ };
    var col = null;
    for (var i = 0; i < Math.min(rows.length, 15) && !col; i++) {
      var r = rows[i], c = {};
      r.forEach(function (h, j) {
        if (c.date == null && H.date.test(h)) c.date = j;
        else if (c.store == null && H.store.test(h)) c.store = j;
        else if (c.amount == null && H.amount.test(h)) c.amount = j;
      });
      if (c.date != null && c.amount != null) { c.from = i + 1; col = c; }
    }
    var out = [], skipped = 0;
    rows.slice(col ? col.from : 0).forEach(function (r) {
      var date = null, amount = null, store = "";
      if (col) {
        date = cellDate(r[col.date] || "", now);
        amount = cellAmount(r[col.amount] || "");
        store = col.store != null ? r[col.store] || "" : "";
      }
      if (!date) for (var j = 0; j < r.length && !date; j++) date = cellDate(r[j], now);
      if (amount == null) {
        // 先頭寄りの金額（利用金額）を採る。支払回数などの小さな数は除外
        for (j = 0; j < r.length; j++) { var a = cellAmount(r[j]); if (a != null && Math.abs(a) >= 10 && !cellDate(r[j], now)) { amount = a; break; } }
      }
      if (!store) r.forEach(function (x) {
        if (!cellDate(x, now) && cellAmount(x) == null && /[^\d\s\-\/.:]/.test(x) && x.length > store.length && !/^(1回|一括|分割|リボ|本人|家族)/.test(x)) store = x;
      });
      if (!date || amount == null) return;
      if (amount <= 0) { skipped++; return; }
      out.push({ date: date, amount: amount, store: store.slice(0, 40) });
    });
    return { items: out, skipped: skipped };
  }

  var api = { parseReceipt: parseReceipt, guessCategory: guessCategory, toHalf: toHalf, parseCardCsv: parseCardCsv };
  g.KakeiboParse = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
