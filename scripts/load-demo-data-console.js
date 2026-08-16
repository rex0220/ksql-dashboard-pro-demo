/**
 * kSQL Dashboard Pro — デモデータ投入(ブラウザーの開発ツール console 用)
 *
 * kintone の画面を開いた状態で、開発ツール(F12)の Console に**全文を貼って Enter**。
 * ログイン中のセッションをそのまま使うので、パスワードも API トークンも要りません。
 *
 *   - 売上明細  … 1,500 件 / 直近 24 か月
 *   - 月次目標  … 288 件(担当者 12 名 × 24 か月)。**売上明細の実績から逆算**して作る
 *   - 商品分類マスタ … 40 件(大 4 + 中 12 + 商品 24)
 *
 * 乱数は種固定ですが、**同じ数字が出るのは「同じ実行日」のときだけ**です。
 * 月ごとの件数は実行日で決まり、そこから先の抽選が全部ずれるため、
 * **日をまたいで入れ直すと分類別の件数も金額も変わります。**
 * 記事の数字を保ったまま入れ直すときは END に撮影日を入れてください。
 *
 * 下の CONFIG に**アプリ番号を書いてから**実行します。APP が 0 のままなら何もしません。
 * 中身だけ先に見たいときは APPLY を false にすると、通信せず要約だけ出ます。
 */
(async () => {
  "use strict";

  /* ====== ここを書き換える ================================================= */
  const CONFIG = {
    /** 売上明細のアプリ番号(アプリの URL の /k/4239/ の部分) */
    APP: 0,
    /** 月次目標のアプリ番号。0 にすると売上明細だけ入れる */
    GOAL: 0,
    /** 商品分類マスタのアプリ番号。0 にすると入れない */
    MASTER: 0,

    /** 書き込む。**false にすると下見**になり、何件どう入るかの要約だけ出して通信しません */
    APPLY: true,

    /** 投入前に既存レコードを全削除する。2 回目以降は true にする(伝票番号が重複禁止のため) */
    CLEAN: false,

    /**
     * ユーザー選択フィールド `担当者user` に入れるログイン名。
     * 既定は**ログイン中のあなた 1 名**で、担当者一覧の先頭(佐藤 健一)に割り当たります。
     * これで「自分の担当分だけ」のペインが動きます。最大 12 名。
     */
    USERS: [kintone.getLoginUser().code],

    /** 日付の終端。"" ならば今日。記事と同じ数字にしたいときだけ "2026-08-15" のように固定する */
    END: "",
  };
  /* ========================================================================= */

  const TOTAL = 1500;
  const MONTHS = 24;

  /* ---- マスタ値 ----------------------------------------------------------- */

  /**
   * **単価帯を分類ごとに変えるのが要点。** 単価が一様だと件数のグラフと金額のグラフが
   * 同じ形になり、複合 2 軸・単位の使い分け・増減の向きが絵に出ない。
   * この配分だと件数の 1 位は「コピー用紙」、金額の 1 位は「導入コンサルティング」になる。
   */
  const CATEGORIES = [
    { major: "事務用品",     name: "コピー用紙",           weight: 16, unit: [3000, 9000],       items: ["A4 コピー用紙 5000 枚", "A3 コピー用紙 2500 枚"] },
    { major: "事務用品",     name: "文具",                 weight: 13, unit: [1000, 6000],       items: ["ボールペン 100 本セット", "ふせん・マーカー詰合せ"] },
    { major: "事務用品",     name: "ファイル用品",         weight: 8,  unit: [2000, 7000],       items: ["クリアファイル 200 冊", "パイプ式ファイル 100 冊"] },
    { major: "OA 機器",      name: "PC 周辺機器",          weight: 12, unit: [12000, 60000],     items: ["ワイヤレスマウス・キーボード", "27 インチ液晶モニター"] },
    { major: "OA 機器",      name: "プリンタ",             weight: 11, unit: [40000, 180000],    items: ["A3 レーザープリンタ", "複合機(A4 カラー)"] },
    { major: "OA 機器",      name: "ネットワーク機器",     weight: 6,  unit: [30000, 150000],    items: ["無線 LAN アクセスポイント", "L2 スイッチ 24 ポート"] },
    { major: "オフィス家具", name: "チェア",               weight: 9,  unit: [20000, 90000],     items: ["メッシュチェア(標準)", "エルゴノミクスチェア"] },
    { major: "オフィス家具", name: "デスク",               weight: 7,  unit: [30000, 120000],    items: ["平机 W1200", "昇降デスク W1400"] },
    { major: "オフィス家具", name: "収納家具",             weight: 5,  unit: [15000, 70000],     items: ["書庫(引違い)", "ロッカー 6 人用"] },
    { major: "サービス",     name: "保守サポート",         weight: 7,  unit: [80000, 300000],    items: ["ハードウェア保守(年間)", "ヘルプデスク保守(年間)"] },
    { major: "サービス",     name: "導入コンサルティング", weight: 4,  unit: [200000, 900000],   items: ["業務分析コンサルティング", "移行支援コンサルティング"] },
    { major: "サービス",     name: "運用アウトソーシング", weight: 2,  unit: [300000, 1200000],  items: ["運用アウトソーシング(標準)", "運用アウトソーシング(24 時間)"] },
  ];

  /** 大分類ごとの数量帯。事務用品はまとめ買い、サービスは 1〜3 件 */
  const QTY = { "事務用品": [10, 200], "OA 機器": [1, 20], "オフィス家具": [1, 30], "サービス": [1, 3] };

  /**
   * **担当者の重みはトップとボトムで 2.6 倍。** 均等に振るとランキング表も横棒も
   * 全部同じ長さになり、Top N の記事が成立しない。
   * USERS のログイン名は**この順で先頭から**割り当てる。
   */
  const REPS = [
    { name: "佐藤 健一", dept: "第一営業部",       weight: 13 },
    { name: "鈴木 美咲", dept: "第一営業部",       weight: 11 },
    { name: "高橋 誠",   dept: "第二営業部",       weight: 10 },
    { name: "田中 亜紀", dept: "第二営業部",       weight: 9 },
    { name: "伊藤 剛",   dept: "第三営業部",       weight: 9 },
    { name: "渡辺 綾",   dept: "第三営業部",       weight: 8 },
    { name: "山本 拓也", dept: "西日本営業部",     weight: 8 },
    { name: "中村 花",   dept: "西日本営業部",     weight: 7 },
    { name: "小林 悠",   dept: "パートナー営業部", weight: 7 },
    { name: "加藤 真理", dept: "パートナー営業部", weight: 6 },
    { name: "吉田 直樹", dept: "公共営業部",       weight: 6 },
    { name: "山田 香織", dept: "公共営業部",       weight: 5 },
  ];

  /** 8 区分。CVD パレットの 8 系列を見せるため */
  const REGIONS = [
    { name: "関東", weight: 28 }, { name: "近畿", weight: 16 }, { name: "東海", weight: 12 },
    { name: "北海道・東北", weight: 10 }, { name: "九州・沖縄", weight: 10 },
    { name: "甲信越・北陸", weight: 9 }, { name: "中国", weight: 8 }, { name: "四国", weight: 7 },
  ];

  /** 60 社。一様に引くとランクは A 20% / B 45% / C 35% になる */
  const CUSTOMERS = (() => {
    const heads = ["青葉", "朝日", "一光", "上原", "桜和", "加賀", "北星", "小泉", "三共", "昭和",
                   "新光", "第一", "高砂", "中央", "東和", "西山", "日進", "初穂", "富士見", "緑川"];
    const tails = ["商事", "工業", "製作所"];
    const list = [];
    for (const h of heads) for (const t of tails) list.push(`${h}${t}`);
    return list.map((name, i) => ({ name, rank: i < 12 ? "A" : i < 39 ? "B" : "C" }));
  })();

  /** 顧客ランクは**取引規模**に効かせる(単価ではなく数量)。同じ商品の単価が客先で変わるのは不自然 */
  const RANK_QTY = { A: 1.6, B: 1.0, C: 0.7 };

  /**
   * 売上明細のステータス。「取消」があると `WHERE 売上ステータス <> '取消'` の例が書ける。
   *
   * **フィールドコードは `売上ステータス`。**`ステータス` は kintone の予約コード
   * (プロセス管理)で、そのままではフィールドを作れない。
   */
  const STATUS = [{ name: "確定", weight: 70 }, { name: "保留", weight: 20 }, { name: "取消", weight: 10 }];

  /** 月ごとの季節性(1 月始まり)。3 月と 9 月が山、8 月と 1 月が谷 */
  const SEASON = [0.85, 0.95, 1.35, 1.0, 0.95, 1.05, 0.95, 0.8, 1.25, 1.0, 1.0, 1.1];

  /** 商品分類マスタ 40 件(大 4 + 中 12 + 商品 24)。CATEGORIES から導出する */
  function masterRows() {
    const majors = [...new Set(CATEGORIES.map((c) => c.major))];
    const rows = [];
    let order = 0;
    majors.forEach((major, mi) => {
      rows.push([`C${mi + 1}`, major, "", 1, ++order, ""]);
      CATEGORIES.filter((c) => c.major === major).forEach((cat, ci) => {
        rows.push([`C${mi + 1}${ci + 1}`, cat.name, `C${mi + 1}`, 2, ++order, ""]);
        cat.items.forEach((item, ii) => {
          /* 標準単価は帯の中央を品目でずらす(同じ分類の 2 品目が同額だと不自然)。
             明細の単価はこの前後に散る */
          const mid = (cat.unit[0] + cat.unit[1]) / 2;
          const std = Math.round((mid * (ii === 0 ? 0.8 : 1.2)) / 100) * 100;
          rows.push([`P${mi + 1}${ci + 1}${ii + 1}`, item, `C${mi + 1}${ci + 1}`, 3, ++order, std]);
        });
      });
    });
    return rows;
  }

  /* ---- 乱数・日付 --------------------------------------------------------- */

  const END = new Date(`${CONFIG.END || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const USERS = CONFIG.USERS.map((s) => String(s).trim()).filter(Boolean);

  let seed = 20260815;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (n) => Math.floor(rnd() * n);
  /** 重み付き抽選。weights は非負の配列 */
  const weighted = (weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let x = rnd() * total;
    for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i;
    return weights.length - 1;
  };

  const ymd = (d) => d.toISOString().slice(0, 10);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  /** 直近 24 か月。末尾が「今月」(実行日の属する月) */
  function buildMonths() {
    const ey = END.getUTCFullYear();
    const em = END.getUTCMonth();
    const out = [];
    for (let i = 0; i < MONTHS; i++) {
      const d = new Date(Date.UTC(ey, em - (MONTHS - 1 - i), 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const full = daysInMonth(y, m);
      /* 今月は実行日までしかデータを作らない。件数が少なくなるのは実運用と同じ */
      const days = i === MONTHS - 1 ? END.getUTCDate() : full;
      out.push({ i, y, m, days, full, key: `${y}-${String(m + 1).padStart(2, "0")}` });
    }
    return out;
  }

  /* ---- 生成 --------------------------------------------------------------- */

  function generate() {
    const months = buildMonths();

    /* 月ごとの件数。季節性 × 緩やかな成長。今月は実行日までで按分する */
    const w = months.map((mo, i) => {
      const growth = 0.85 + (0.3 * i) / (MONTHS - 1);
      const prorate = i === MONTHS - 1 ? mo.days / mo.full : 1;
      return SEASON[mo.m] * growth * prorate;
    });
    const sum = w.reduce((s, v) => s + v, 0);
    const counts = w.map((v) => Math.floor((TOTAL * v) / sum));
    /* 端数は重みの大きい月から配る */
    let rest = TOTAL - counts.reduce((s, v) => s + v, 0);
    const order = w.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) counts[order[k][1]]++;

    /* 前月比のため、今月と先月には必ず一定数を置く */
    counts[MONTHS - 1] = Math.max(counts[MONTHS - 1], 8);
    counts[MONTHS - 2] = Math.max(counts[MONTHS - 2], 20);

    /**
     * **「運用アウトソーシング」は 24 か月のうち 9 か月しか取引が無い。**
     * 分類別の月次推移で月が飛ぶので、GENERATE_SERIES による 0 埋めが絵になる。
     * 全分類が毎月あると 0 埋めの効果が見えない。
     */
    const sparse = CATEGORIES.findIndex((c) => c.name === "運用アウトソーシング");
    const idx = months.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = pick(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const sparseMonths = new Set(idx.slice(0, 9));

    const rows = [];
    for (const mo of months) {
      /* 日の重み。**土日を平日の 25% に落とす** — 週の周期が出て、取引の無い日が自然に生まれる */
      const dayW = [];
      for (let d = 1; d <= mo.days; d++) {
        const dow = new Date(Date.UTC(mo.y, mo.m, d)).getUTCDay();
        dayW.push(dow === 0 || dow === 6 ? 0.25 : 1);
      }
      /* この月に出せる分類の重み(疎な分類は該当月以外 0)。
         **出る月には厚めに出す** — 素の weight 2 のままだと全期間で 9 件しか出ず、
         9 か月に散らずに 4 か月へ固まってしまい、月次の 0 埋めが絵にならない */
      const catW = CATEGORIES.map((c, ci) =>
        ci === sparse ? (sparseMonths.has(mo.i) ? c.weight * 5 : 0) : c.weight);

      for (let n = 0; n < counts[mo.i]; n++) {
        const day = weighted(dayW) + 1;
        const cat = CATEGORIES[weighted(catW)];
        const rep = REPS[weighted(REPS.map((r) => r.weight))];
        const region = REGIONS[weighted(REGIONS.map((r) => r.weight))].name;
        const cust = CUSTOMERS[pick(CUSTOMERS.length)];
        const status = STATUS[weighted(STATUS.map((s) => s.weight))].name;

        const [qMin, qMax] = QTY[cat.major];
        const qty = Math.max(1, Math.round((qMin + pick(qMax - qMin + 1)) * RANK_QTY[cust.rank]));
        const unit = Math.round((cat.unit[0] + pick(cat.unit[1] - cat.unit[0] + 1)) / 100) * 100;

        rows.push({
          date: ymd(new Date(Date.UTC(mo.y, mo.m, day))),
          customer: cust.name,
          rank: cust.rank,
          region,
          dept: rep.dept,
          rep: rep.name,
          major: cat.major,
          category: cat.name,
          item: cat.items[pick(2)],
          qty,
          unit,
          amount: qty * unit,
          status,
        });
      }
    }

    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    breakSome(rows);
    rows.forEach((r, i) => { r.slip = `S-${String(i + 1).padStart(6, "0")}`; });
    return rows;
  }

  /**
   * データ品質チェックの例のために、**約 1.5% だけ**壊す。
   * 多いと集計値が汚れて、他の記事の数字が「なんだか変」に見える。
   * 22 件なら合計への影響は誤差で、品質チェックのペインでは明確に浮かぶ。
   *
   * 未来日付は**翌月以降**に飛ばす。今月内に置くと THIS_MONTH() の集計に混ざる。
   */
  function breakSome(rows) {
    const spread = (n) => {
      const out = [];
      /* 期間全体に散らす。先頭に固めると明細表の 1 ページ目が壊れたレコードだらけになる */
      for (let k = 0; k < n; k++) out.push(Math.floor(((k + 0.5) / n) * rows.length));
      return out;
    };

    for (const i of spread(6)) { rows[i].customer = ""; rows[i].broken = true; }
    for (const i of spread(5).map((v) => (v + 37) % rows.length)) {
      rows[i].unit = 0; rows[i].amount = 0; rows[i].broken = true;
    }
    for (const i of spread(4).map((v) => (v + 91) % rows.length)) {
      rows[i].qty = -rows[i].qty; rows[i].amount = rows[i].qty * rows[i].unit;
      rows[i].broken = true;
    }
    const future = ["特注品(型番なし)", "サンプル品", "旧型モニター 22 インチ", "テスト商品"];
    for (let k = 0; k < 4; k++) {
      const i = (spread(4)[k] + 143) % rows.length;
      rows[i].item = future[k]; rows[i].broken = true;
    }
    for (let k = 0; k < 3; k++) {
      const i = (spread(3)[k] + 211) % rows.length;
      const d = new Date(END.getTime() + (40 + k * 120) * 86400000);
      rows[i].date = ymd(d); rows[i].broken = true;
    }
  }

  /**
   * 月次目標を**実績から逆算**して作る。目標を独立に振ると達成率が全員 300% や 20% になり、
   * プログレスバーも条件付きカラーも絵にならない。
   *
   * 係数 0.85〜1.25 で割るので、**達成と未達が混ざる**。
   * 今月だけは実行日按分で実績が少ないため例外にし、**達成率 82% 前後**を狙う。
   */
  function buildGoals(rows) {
    const months = buildMonths();
    const actual = new Map();                                   // `担当者|年月` → 確定の売上
    for (const r of rows) {
      if (r.status !== "確定" || r.broken) continue;
      const key = `${r.rep}|${r.date.slice(0, 7)}`;
      actual.set(key, (actual.get(key) ?? 0) + r.amount);
    }
    /* 実績が 0 の月に備えた担当者ごとの平均 */
    const avg = new Map();
    for (const rep of REPS) {
      const vals = months.map((mo) => actual.get(`${rep.name}|${mo.key}`) ?? 0).filter((v) => v > 0);
      avg.set(rep.name, vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 1000000);
    }

    const goals = [];
    for (const rep of REPS) {
      for (const mo of months) {
        const isCurrent = mo.i === MONTHS - 1;
        /* **今月は平均へ逃がさない。** 月半ばで実績の少ない担当者に月平均から作った目標を
           当てると達成率が数 % になり、全社の達成率も狙いの 82% から大きく下振れする */
        const base = isCurrent
          ? (actual.get(`${rep.name}|${mo.key}`) ?? 0)
          : (actual.get(`${rep.name}|${mo.key}`) ?? avg.get(rep.name));
        const coef = isCurrent ? 0.82 : 0.85 + rnd() * 0.4;
        const goal = Math.max(100000, Math.round(base / coef / 10000) * 10000);
        goals.push({ rep: rep.name, dept: rep.dept, ym: mo.key, goal });
      }
    }
    return goals;
  }

  /* ---- 下見の要約 --------------------------------------------------------- */

  const man = (v) => `${Math.round(v / 10000).toLocaleString()} 万`;

  function summarize(rows, goals) {
    const by = (key) => {
      const m = new Map();
      for (const r of rows) {
        const k = typeof key === "function" ? key(r) : r[key];
        const e = m.get(k) ?? { n: 0, amt: 0 };
        e.n++; e.amt += r.amount; m.set(k, e);
      }
      return [...m.entries()];
    };

    console.log(`件数: ${rows.length}   期間: ${rows[0].date} 〜 ${rows[rows.length - 1].date}`);

    /* 内訳は 50 行近くある。**畳んでおく** — 開いたままだと、この下に出す
       「書き込みました」「下見です」がスクロールの外へ流れて読まれない */
    console.groupCollapsed("■ 月別(件数 / 金額)— 山谷があるか、右肩上がり一直線になっていないか");
    for (const [k, v] of by((r) => r.date.slice(0, 7)).sort()) {
      console.log(`${k}  ${String(v.n).padStart(3)} 件  ${man(v.amt).padStart(10)}`);
    }
    console.groupEnd();

    console.groupCollapsed("■ 分類別 — 件数の順位と金額の順位が入れ替わるか(上位 N + その他の前提)");
    const cats = by("category");
    const byN = [...cats].sort((a, b) => b[1].n - a[1].n);
    const byA = [...cats].sort((a, b) => b[1].amt - a[1].amt);
    for (let i = 0; i < cats.length; i++) {
      console.log(`${String(i + 1).padStart(2)}. 件数 ${byN[i][0].padEnd(14)} ${String(byN[i][1].n).padStart(4)} 件`
        + `   |  金額 ${byA[i][0].padEnd(14)} ${man(byA[i][1].amt).padStart(10)}`);
    }
    const top4 = byN.slice(0, 4).reduce((s, [, v]) => s + v.n, 0);
    console.log(`上位 4 分類で ${Math.round((top4 / rows.length) * 100)}%(50% 前後なら狙いどおり)`);
    console.groupEnd();

    console.groupCollapsed("■ 担当者別 — トップとボトムで 2.5 倍前後か(ランキングが絵になるか)");
    const reps = by("rep").sort((a, b) => b[1].amt - a[1].amt);
    for (const [k, v] of reps) console.log(`${k.padEnd(10)} ${String(v.n).padStart(4)} 件  ${man(v.amt).padStart(10)}`);
    /* 金額の順に並べて表示しているので、比は**件数の最大 / 最小**から取る(並び順で拾わない) */
    const ns = reps.map(([, v]) => v.n);
    console.log(`件数の比: ${(Math.max(...ns) / Math.min(...ns)).toFixed(1)} 倍`);
    console.groupEnd();

    const sparse = rows.filter((r) => r.category === "運用アウトソーシング");
    const sparseM = new Set(sparse.map((r) => r.date.slice(0, 7)));
    console.log(`\n■ 0 埋めの出番: 運用アウトソーシングは ${MONTHS} か月中 ${sparseM.size} か月だけ取引あり`
      + `(${sparse.length} 件)`);

    const days = new Set(rows.map((r) => r.date));
    console.log(`■ 取引のあった日: ${days.size} 日(日次の 0 埋めが効くか)`);

    const months = buildMonths();
    const curKey = months[MONTHS - 1].key;
    const cur = rows.filter((r) => r.date.slice(0, 7) === curKey && r.date <= ymd(END)).length;
    console.log(`■ 今月 ${cur} 件 / 先月 ${rows.filter((r) => r.date.slice(0, 7) === months[MONTHS - 2].key).length} 件`
      + "(前月比。今月は実行日までなので少ない)");

    const broken = rows.filter((r) => r.broken).length;
    console.log(`\n■ 壊れたレコード: ${broken} 件(${((broken / rows.length) * 100).toFixed(1)}%)`);
    console.log(`  顧客名なし ${rows.filter((r) => r.customer === "").length}`
      + ` / 金額ゼロ ${rows.filter((r) => r.amount === 0).length}`
      + ` / 数量マイナス ${rows.filter((r) => r.qty < 0).length}`
      + ` / 未来日付 ${rows.filter((r) => r.date > ymd(END)).length}`);

    if (goals) {
      const act = new Map();
      for (const r of rows) {
        if (r.status !== "確定" || r.broken || r.date.slice(0, 7) !== curKey) continue;
        act.set(r.rep, (act.get(r.rep) ?? 0) + r.amount);
      }
      const cg = goals.filter((g) => g.ym === curKey);
      const rates = cg.map((g) => Math.round(((act.get(g.rep) ?? 0) / g.goal) * 100));
      const whole = Math.round(([...act.values()].reduce((s, v) => s + v, 0)
        / cg.reduce((s, g) => s + g.goal, 0)) * 100);
      console.log(`\n■ 月次目標: ${goals.length} 件。今月の達成率 — 全社 ${whole}%(狙い 82% 前後)`
        + ` / 担当者別 ${Math.min(...rates)}〜${Math.max(...rates)}%`);
    }

    if (USERS.length) {
      console.log(`\n■ 担当者user: 先頭 ${USERS.length} 名へ割り当て`);
      USERS.forEach((u, i) => console.log(`  ${REPS[i]?.name ?? "(担当者が足りません)"} ← ${u}`));
      const n = rows.filter((r) => REPS.findIndex((x) => x.name === r.rep) < USERS.length).length;
      console.log(`  対象レコード ${n} 件(全体の ${Math.round((n / rows.length) * 100)}%)`);
    } else {
      console.log("\n■ 担当者user: USERS が空のため書き込みません(「自分の担当分だけ」のペインは 0 件になります)");
    }
  }

  /* ---- kintone REST ------------------------------------------------------- */

  /**
   * ログイン中のセッションで呼ぶ。`kintone.api` は CSRF トークンを付けてくれるので、
   * 書き込みも含めてこれに任せる。**認証情報を書く欄はどこにもない。**
   */
  const api = (path, method, body) =>
    kintone.api(kintone.api.url(path, true), method, body);

  /** 担当者名 → ユーザー選択の値。割り当ての無い担当者は空 */
  const userOf = (rep) => {
    const i = REPS.findIndex((r) => r.name === rep);
    return i >= 0 && i < USERS.length ? [{ code: USERS[i] }] : [];
  };

  /** 売上明細 1 件のレコード。**検証と本投入で同じ形を使う** */
  function salesRecord(r, override = {}) {
    return {
      伝票番号:       { value: r.slip },
      売上日:         { value: r.date },
      顧客名:         { value: r.customer },
      顧客ランク:     { value: r.rank },
      地域:           { value: r.region },
      部署:           { value: r.dept },
      担当者名:       { value: r.rep },
      ...(USERS.length ? { 担当者user: { value: userOf(r.rep) } } : {}),
      大分類:         { value: r.major },
      商品カテゴリ:   { value: r.category },
      商品名:         { value: r.item },
      数量:           { value: String(r.qty) },
      単価:           { value: String(r.unit) },
      金額:           { value: String(r.amount) },
      売上ステータス: { value: r.status },
      ...override,
    };
  }

  /**
   * ログイン名を**投入前に**検証する。
   * 1,500 件を入れ終えてから「そんなユーザーはいない」で落ちるのが最悪なので、
   * 1 件だけ書いてみて、通ったら消す。
   *
   * **試すのは実レコードと同じ形。**ユーザー選択だけの record を送ると必須項目で弾かれ、
   * 「ログイン名が悪い」と誤って報告してしまう。
   */
  async function probeUsers(app, sample) {
    const bad = [];
    const made = [];
    for (const code of USERS) {
      const record = salesRecord(sample, {
        伝票番号:   { value: `PROBE-${code}` },       // 重複禁止なので本番の番号は使わない
        担当者user: { value: [{ code }] },
      });
      try {
        const r = await api("/k/v1/record.json", "POST", { app, record });
        made.push(Number(r.id));
      } catch (e) {
        bad.push({ code, text: e && e.message ? e.message : String(e) });
      }
    }
    if (made.length) await api("/k/v1/records.json", "DELETE", { app, ids: made });
    if (bad.length) {
      for (const b of bad) console.error(`  ${b.code}: ${b.text}`);
      throw new Error(`次のログイン名を 担当者user へ設定できませんでした: ${bad.map((b) => b.code).join(", ")}`
        + " / ログイン名の綴りと、売上明細にユーザー選択フィールド 担当者user があるかを確認してください。");
    }
  }

  async function fetchAllIds(app) {
    const ids = [];
    for (;;) {
      const query = `$id > ${ids.length ? ids[ids.length - 1] : 0} order by $id asc limit 500`;
      /* GET は第 3 引数のオブジェクトがクエリ文字列になる。URL へ自分で並べない */
      const data = await api("/k/v1/records.json", "GET", { app, query, fields: ["$id"] });
      if (data.records.length === 0) return ids;
      for (const r of data.records) ids.push(Number(r.$id.value));
    }
  }

  async function deleteAll(app) {
    const ids = await fetchAllIds(app);
    for (let i = 0; i < ids.length; i += 100) {
      await api("/k/v1/records.json", "DELETE", { app, ids: ids.slice(i, i + 100) });
    }
    return ids.length;
  }

  async function insert(app, list, toRecord, label) {
    for (let i = 0; i < list.length; i += 100) {
      const records = list.slice(i, i + 100).map(toRecord);
      await api("/k/v1/records.json", "POST", { app, records });
      console.log(`  ${label} ${Math.min(i + 100, list.length)}/${list.length}`);
    }
  }

  /* ---- 実行 --------------------------------------------------------------- */

  if (typeof kintone === "undefined") {
    throw new Error("kintone の画面で実行してください(kintone が見つかりません)。");
  }
  if (USERS.length > REPS.length) throw new Error(`USERS は最大 ${REPS.length} 件です`);
  /* **アプリ番号が入っていないと何もできない。** ここで止めるのが唯一の安全装置で、
     読者は必ず自分でアプリ番号を書くことになる */
  if (CONFIG.APPLY && !CONFIG.APP) {
    throw new Error("CONFIG.APP に売上明細のアプリ番号を書いてください(URL の /k/4239/ の 4239 の部分)");
  }

  /* **モードを最初に出す。** 要約の後ろに置いていたら「実行しても変わらない」と
     迷わせた(実際の報告)。読む前に、これから何が起きるかを言う */
  console.log(CONFIG.APPLY
    ? `▼ 書き込みます: APP${CONFIG.APP}`
      + `${CONFIG.GOAL ? ` / APP${CONFIG.GOAL}` : ""}${CONFIG.MASTER ? ` / APP${CONFIG.MASTER}` : ""}`
      + `${CONFIG.CLEAN ? "(既存レコードを全削除してから)" : ""}`
    : "▼ 下見モードです(CONFIG.APPLY が false のため、何も書き込みません)");

  const rows = generate();
  const goals = CONFIG.GOAL ? buildGoals(rows) : null;

  summarize(rows, goals);

  if (!CONFIG.APPLY) {
    console.log("\n下見モードなので、ここで終わりです。投入するには CONFIG.APPLY を true にしてください。");
    return;
  }

  if (USERS.length) {
    console.log("\nログイン名を確認しています…");
    await probeUsers(CONFIG.APP, rows[0]);
    console.log("  OK");
  }

  if (CONFIG.CLEAN) {
    console.log("既存レコードを削除しています…");
    console.log(`  売上明細 ${await deleteAll(CONFIG.APP)} 件`);
    if (CONFIG.GOAL) console.log(`  月次目標 ${await deleteAll(CONFIG.GOAL)} 件`);
    if (CONFIG.MASTER) console.log(`  商品分類マスタ ${await deleteAll(CONFIG.MASTER)} 件`);
  }

  /* マスタを先に入れる。明細の商品名との突き合わせは、マスタが揃っていないと確かめられない */
  if (CONFIG.MASTER) {
    const master = masterRows();
    await insert(CONFIG.MASTER, master, (m) => ({
      分類コード: { value: m[0] },
      分類名:     { value: m[1] },
      親コード:   { value: m[2] },
      階層:       { value: String(m[3]) },
      表示順:     { value: String(m[4]) },
      標準単価:   { value: m[5] === "" ? "" : String(m[5]) },
    }), "商品分類マスタ");
    console.log(`APP${CONFIG.MASTER} へ ${master.length} 件を投入しました`);
  }

  await insert(CONFIG.APP, rows, (r) => salesRecord(r), "売上明細");
  console.log(`APP${CONFIG.APP} へ ${rows.length} 件を投入しました`);

  if (CONFIG.GOAL) {
    await insert(CONFIG.GOAL, goals, (g) => ({
      担当者名: { value: g.rep },
      年月:     { value: g.ym },
      部署:     { value: g.dept },
      目標金額: { value: String(g.goal) },
    }), "月次目標");
    console.log(`APP${CONFIG.GOAL} へ ${goals.length} 件を投入しました`);
  }

  console.log("\n完了しました。一覧を再読み込みしてください。");
})().catch((e) => console.error("失敗しました:", e && e.message ? e.message : e));
