#!/usr/bin/env node
/**
 * Qiita「表示タイプ別 実践ガイド」(K-133)用のデモアプリへ、記事の絵を作るための
 * データを投入する。設計は docs/internal/plans/K138-デモアプリ設計.md。
 *
 * - 売上明細  … 1,500 件 / 直近 24 か月
 * - 月次目標  … 288 件(担当者 12 名 × 24 か月)。**売上明細の実績から逆算**して作る
 * - 商品分類マスタ … このスクリプトでは扱わない(40 件の CSV で完成する)
 *
 * 乱数は種固定ですが、**同じ数字が出るのは「同じ実行日」のときだけ**です。
 * 月ごとの件数は実行日で決まり(今月は実行日までで按分)、そこから先の抽選が
 * 全部ずれるため、**日をまたいで入れ直すと分類別の件数も金額も変わります。**
 *
 *   → **記事の数字を保ったまま入れ直すときは `--end <撮影日>` を必ず付ける。**
 *     付けなければ「今日基準の 24 か月」になります(撮影前の仕込みはこちらでよい)。
 *
 * データは「見せたい機能」から逆算して分布を決めてあります(K138 §0)。
 * 数字をいじるときは、その機能が絵として成立するかを確かめてください。
 *
 *   node load-demo-data.mjs                     下見(分布の要約のみ。通信しない)
 *   node load-demo-data.mjs --apply             投入を実行する
 *   node load-demo-data.mjs --apply --clean     既存レコードを全削除してから投入
 *   node load-demo-data.mjs --csv docs/samples/apps   配布 CSV 3 本を書き出す(通信しない)
 *
 * 環境変数:
 *   KINTONE_BASE_URL   https://xxxxx.cybozu.com
 *   KINTONE_USERNAME / KINTONE_PASSWORD   または   KINTONE_API_TOKEN
 *   (API トークンを使う場合は、両アプリで「レコード閲覧・追加・削除」を許可)
 *
 * 引数:
 *   --app 1234       売上明細のアプリ番号
 *   --goal 1235      月次目標のアプリ番号(省略すると売上明細だけ投入する)
 *   --master 1236    商品分類マスタのアプリ番号(40 件。読者は CSV を取り込む経路でよい)
 *   --users a,b,c    ユーザー選択フィールド `担当者user` へ割り当てるログイン名。
 *                    **担当者名の先頭から順に**対応付け、残りは空にする。
 *                    1 つでも成立する(D14「自分の担当分だけ」が動く)。
 *                    未指定なら `担当者user` へ一切書き込まない
 *   --end 2026-08-15 日付の終端を固定する(過去の状態を再現したいときのみ)
 *   --apply          書き込みを実行する
 *   --clean          投入前に既存レコードをすべて削除する(--apply のときだけ働く)
 *   --csv <dir>      読者への配布 CSV を書き出して終了する(通信しない)
 *
 * Node 18 以上、依存パッケージなし。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORIES, QTY, REPS, REGIONS, CUSTOMERS, RANK_QTY, STATUS, SEASON, masterRows,
} from "./demo-masters.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const APP = value("app", null);
const GOAL_APP = value("goal", null);
const MASTER_APP = value("master", null);
const CSV_DIR = value("csv", null);
const USERS = (value("users", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const APPLY = flag("apply");
const CLEAN = flag("clean");

const TOTAL = 1500;
const MONTHS = 24;

const endArg = value("end", null);
const END = new Date(`${endArg ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);

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

/* ---- 日付まわり ---------------------------------------------------------- */

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

/* ---- 生成 ---------------------------------------------------------------- */

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

  /* D2(前月比)のため、今月と先月には必ず一定数を置く */
  counts[MONTHS - 1] = Math.max(counts[MONTHS - 1], 8);
  counts[MONTHS - 2] = Math.max(counts[MONTHS - 2], 20);

  /**
   * **「運用アウトソーシング」は 24 か月のうち 9 か月しか取引が無い。**
   * 分類別の月次推移で月が飛ぶので、D5b(GENERATE_SERIES による 0 埋め)が絵になる。
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
 * D17(データ品質チェック)のために、**約 1.5% だけ**壊す。
 * 多いと集計値が汚れて、他 3 記事の数字が「なんだか変」に見える。
 * 22 件なら合計への影響は誤差で、D17 のペインでは明確に浮かぶ。
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
  const damage = { 顧客名なし: 0, 金額ゼロ: 0, 数量マイナス: 0, 未来日付: 0, マスタ外の商品名: 0 };

  for (const i of spread(6)) { rows[i].customer = ""; rows[i].broken = true; damage.顧客名なし++; }
  for (const i of spread(5).map((v) => (v + 37) % rows.length)) {
    rows[i].unit = 0; rows[i].amount = 0; rows[i].broken = true; damage.金額ゼロ++;
  }
  for (const i of spread(4).map((v) => (v + 91) % rows.length)) {
    rows[i].qty = -rows[i].qty; rows[i].amount = rows[i].qty * rows[i].unit;
    rows[i].broken = true; damage.数量マイナス++;
  }
  const future = ["特注品(型番なし)", "サンプル品", "旧型モニター 22 インチ", "テスト商品"];
  for (let k = 0; k < 4; k++) {
    const i = (spread(4)[k] + 143) % rows.length;
    rows[i].item = future[k]; rows[i].broken = true; damage.マスタ外の商品名++;
  }
  for (let k = 0; k < 3; k++) {
    const i = (spread(3)[k] + 211) % rows.length;
    const d = new Date(END.getTime() + (40 + k * 120) * 86400000);
    rows[i].date = ymd(d); rows[i].broken = true; damage.未来日付++;
  }
  return damage;
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
    avg.set(rep.name, vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 1_000_000);
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

/* ---- 配布 CSV ------------------------------------------------------------ */

/**
 * 読者は kintone の「アプリを作成 → ファイルを読み込んで作成」でこの CSV から
 * **フィールドごとアプリを作る。**データ本体は投入スクリプトが入れるので、
 * 明細と目標は**見本を数十件**だけ入れる。
 *
 * 1,500 件を CSV で配ると日付が固定になり、相対日付のペインが動かなくなる
 * (在庫パックのサンプルが 12 件・過去日付で動かなかったのと同じ問題)。
 *
 * **マスタをここへ手で書き写さない。**同じ CATEGORIES / REPS から作る。
 * 二重管理にすると、片方だけ直したときに記事の数字が合わなくなる。
 */
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvText = (header, rows) =>
  /* BOM 付き(Windows の Excel で開いても文字化けしない)/ 改行は LF。
     CRLF で書いてもリポジトリの .gitattributes(* text=auto eol=lf)が LF へ正規化するため、
     読者が受け取るのは結局 LF になる。kintone の取り込みも Excel も LF で問題ない */
  "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";


/** 期間全体から等間隔に n 件抜く。**壊れたレコードは混ぜない**(アプリ作成時の見本なので) */
function sample(list, n) {
  const clean = list.filter((r) => !r.broken);
  const step = Math.max(1, Math.floor(clean.length / n));
  const out = [];
  for (let i = 0; i < clean.length && out.length < n; i += step) out.push(clean[i]);
  return out;
}

function writeCsv(dir, rows, goals) {
  mkdirSync(dir, { recursive: true });

  const sales = sample(rows, 30);
  writeFileSync(join(dir, "売上明細.csv"), csvText(
    ["伝票番号", "売上日", "顧客名", "顧客ランク", "地域", "部署", "担当者名",
     "大分類", "商品カテゴリ", "商品名", "数量", "単価", "金額", "売上ステータス"],
    sales.map((r) => [r.slip, r.date, r.customer, r.rank, r.region, r.dept, r.rep,
                      r.major, r.category, r.item, r.qty, r.unit, r.amount, r.status]),
  ));

  /* 目標は**担当者 1 名の 24 か月ぶんを連続で**見せる。飛び飛びに抜くと、
     年月が歯抜けの見本になって「そういうデータなのか」と誤解される */
  const goalRows = goals ? goals.slice(0, MONTHS) : [];
  if (goals) {
    writeFileSync(join(dir, "月次目標.csv"), csvText(
      ["担当者名", "年月", "部署", "目標金額"],
      goalRows.map((g) => [g.rep, g.ym, g.dept, g.goal]),
    ));
  }

  const master = masterRows();
  writeFileSync(join(dir, "商品分類マスタ.csv"), csvText(
    ["分類コード", "分類名", "親コード", "階層", "表示順", "標準単価"], master));

  console.log(`\n配布 CSV を書き出しました: ${dir}`);
  console.log(`  売上明細.csv        ${sales.length} 件(見本。本体は --apply で投入)`);
  if (goals) console.log(`  月次目標.csv        ${goalRows.length} 件(同上)`);
  console.log(`  商品分類マスタ.csv  ${master.length} 件(**これで完成**。投入不要)`);
  console.log("\n  売上明細には、読者がユーザー選択フィールド 担当者user を手で足します");
  console.log("  (CSV では作れないため。D14 の「自分の担当分だけ」で使う)");
}

/* ---- kintone REST -------------------------------------------------------- */

function fail(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

function auth() {
  const base = process.env.KINTONE_BASE_URL;
  if (!base) fail("環境変数 KINTONE_BASE_URL を設定してください");
  const headers = {};
  if (process.env.KINTONE_API_TOKEN) {
    headers["X-Cybozu-API-Token"] = process.env.KINTONE_API_TOKEN;
  } else if (process.env.KINTONE_USERNAME && process.env.KINTONE_PASSWORD) {
    headers["X-Cybozu-Authorization"] = Buffer.from(
      `${process.env.KINTONE_USERNAME}:${process.env.KINTONE_PASSWORD}`,
    ).toString("base64");
  } else {
    fail("KINTONE_USERNAME / KINTONE_PASSWORD か KINTONE_API_TOKEN を設定してください");
  }
  return { base: base.replace(/\/$/, ""), headers };
}

async function request(conn, method, path, body, { soft = false } = {}) {
  /* **本文の無い GET に Content-Type を付けると kintone は 400(CB_IL02)を返す。**
     載せるときだけ付ける */
  const headers = body === undefined
    ? conn.headers
    : { ...conn.headers, "Content-Type": "application/json" };
  const res = await fetch(`${conn.base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (soft) return { ok: false, text };
    fail(`${method} ${path} が ${res.status} で失敗しました: ${text}`);
  }
  return res.json();
}

/** 担当者名 → ユーザー選択の値。割り当ての無い担当者は空 */
const userOf = (rep) => {
  const i = REPS.findIndex((r) => r.name === rep);
  return i >= 0 && i < USERS.length ? [{ code: USERS[i] }] : [];
};

/** 売上明細 1 件のレコード。**検証(probeUsers)と本投入で同じ形を使う** */
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
 * `--users` のログイン名を**投入前に**検証する。
 * 1,500 件を入れ終えてから「そんなユーザーはいない」で落ちるのが最悪なので、
 * 1 件だけ書いてみて、通ったら消す。
 *
 * ユーザー一覧 API(/v1/users.json)は共通管理者権限が要るため使わない。
 * 読者が一般ユーザーのままでも動く方法を選ぶ。
 *
 * **試すのは実レコードと同じ形。**ユーザー選択だけの record を送ると必須項目で弾かれ、
 * 「ログイン名が悪い」と誤って報告してしまう(実際に一度そうなった)。
 */
async function probeUsers(conn, app, sample) {
  const bad = [];
  const made = [];
  for (const code of USERS) {
    const record = salesRecord(sample, {
      伝票番号:   { value: `PROBE-${code}` },       // 重複禁止なので本番の番号は使わない
      担当者user: { value: [{ code }] },
    });
    const r = await request(conn, "POST", "/k/v1/record.json",
      { app: Number(app), record }, { soft: true });
    if (r.ok === false) bad.push({ code, text: r.text });
    else made.push(Number(r.id));
  }
  if (made.length) await request(conn, "DELETE", "/k/v1/records.json", { app: Number(app), ids: made });
  if (bad.length) {
    for (const b of bad) console.error(`  ${b.code}: ${b.text}`);
    fail(`次のログイン名を ${"担当者user"} へ設定できませんでした: ${bad.map((b) => b.code).join(", ")}\n`
      + "  ログイン名の綴りと、売上明細にユーザー選択フィールド 担当者user があるかを確認してください。");
  }
}

async function fetchAllIds(conn, app) {
  const ids = [];
  for (;;) {
    const query = `$id > ${ids.length ? ids[ids.length - 1] : 0} order by $id asc limit 500`;
    const data = await request(conn, "GET",
      `/k/v1/records.json?app=${app}&query=${encodeURIComponent(query)}&fields[0]=$id`);
    if (data.records.length === 0) return ids;
    for (const r of data.records) ids.push(Number(r.$id.value));
  }
}

async function deleteAll(conn, app) {
  const ids = await fetchAllIds(conn, app);
  for (let i = 0; i < ids.length; i += 100) {
    await request(conn, "DELETE", "/k/v1/records.json", { app: Number(app), ids: ids.slice(i, i + 100) });
  }
  return ids.length;
}

async function insert(conn, app, list, toRecord, label) {
  for (let i = 0; i < list.length; i += 100) {
    const records = list.slice(i, i + 100).map(toRecord);
    await request(conn, "POST", "/k/v1/records.json", { app: Number(app), records });
    process.stdout.write(`  ${label} ${Math.min(i + 100, list.length)}/${list.length}\r`);
  }
  process.stdout.write("\n");
}

/* ---- 下見の要約 ---------------------------------------------------------- */

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

  console.log("\n■ 月別(件数 / 金額)— 山谷があるか、右肩上がり一直線になっていないか");
  for (const [k, v] of by((r) => r.date.slice(0, 7)).sort()) {
    console.log(`  ${k}  ${String(v.n).padStart(3)} 件  ${man(v.amt).padStart(10)}`);
  }

  console.log("\n■ 分類別 — 件数の順位と金額の順位が入れ替わるか(上位 N + その他の前提)");
  const cats = by("category");
  const byN = [...cats].sort((a, b) => b[1].n - a[1].n);
  const byA = [...cats].sort((a, b) => b[1].amt - a[1].amt);
  for (let i = 0; i < cats.length; i++) {
    console.log(`  ${String(i + 1).padStart(2)}. 件数 ${byN[i][0].padEnd(14)} ${String(byN[i][1].n).padStart(4)} 件`
      + `   |  金額 ${byA[i][0].padEnd(14)} ${man(byA[i][1].amt).padStart(10)}`);
  }
  const top4 = byN.slice(0, 4).reduce((s, [, v]) => s + v.n, 0);
  console.log(`  上位 4 分類で ${Math.round((top4 / rows.length) * 100)}%(50% 前後なら狙いどおり)`);

  console.log("\n■ 担当者別 — トップとボトムで 2.5 倍前後か(ランキングが絵になるか)");
  const reps = by("rep").sort((a, b) => b[1].amt - a[1].amt);
  for (const [k, v] of reps) console.log(`  ${k.padEnd(10)} ${String(v.n).padStart(4)} 件  ${man(v.amt).padStart(10)}`);
  /* 金額の順に並べて表示しているので、比は**件数の最大 / 最小**から取る(並び順で拾わない) */
  const ns = reps.map(([, v]) => v.n);
  console.log(`  件数の比: ${(Math.max(...ns) / Math.min(...ns)).toFixed(1)} 倍`);

  const sparse = rows.filter((r) => r.category === "運用アウトソーシング");
  const sparseM = new Set(sparse.map((r) => r.date.slice(0, 7)));
  console.log(`\n■ 0 埋めの出番: 運用アウトソーシングは ${MONTHS} か月中 ${sparseM.size} か月だけ取引あり`
    + `(${sparse.length} 件)`);

  const days = new Set(rows.map((r) => r.date));
  console.log(`■ 取引のあった日: ${days.size} 日(日次の 0 埋めが効くか)`);

  const thisM = rows[rows.length - 1] && END.toISOString().slice(0, 7);
  const cur = rows.filter((r) => r.date.slice(0, 7) === thisM && r.date <= ymd(END)).length;
  const prevKey = buildMonths()[MONTHS - 2].key;
  console.log(`■ 今月 ${cur} 件 / 先月 ${rows.filter((r) => r.date.slice(0, 7) === prevKey).length} 件`
    + "(D2 の前月比。今月は実行日までなので少ない)");

  const broken = rows.filter((r) => r.broken).length;
  console.log(`\n■ 壊れたレコード: ${broken} 件(${((broken / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  顧客名なし ${rows.filter((r) => r.customer === "").length}`
    + ` / 金額ゼロ ${rows.filter((r) => r.amount === 0).length}`
    + ` / 数量マイナス ${rows.filter((r) => r.qty < 0).length}`
    + ` / 未来日付 ${rows.filter((r) => r.date > ymd(END)).length}`);

  if (goals) {
    const cur2 = buildMonths()[MONTHS - 1].key;
    const act = new Map();
    for (const r of rows) {
      if (r.status !== "確定" || r.broken || r.date.slice(0, 7) !== cur2) continue;
      act.set(r.rep, (act.get(r.rep) ?? 0) + r.amount);
    }
    const cg = goals.filter((g) => g.ym === cur2);
    const rates = cg.map((g) => Math.round(((act.get(g.rep) ?? 0) / g.goal) * 100));
    const whole = Math.round(([...act.values()].reduce((s, v) => s + v, 0)
      / cg.reduce((s, g) => s + g.goal, 0)) * 100);
    console.log(`\n■ 月次目標: ${goals.length} 件。今月の達成率 — 全社 ${whole}%(狙い 82% 前後)`
      + ` / 担当者別 ${Math.min(...rates)}〜${Math.max(...rates)}%`);
    const all = goals.map((g) => {
      const a = rows.filter((r) => r.rep === g.rep && r.status === "確定" && !r.broken
        && r.date.slice(0, 7) === g.ym).reduce((s, r) => s + r.amount, 0);
      return a >= g.goal;
    });
    console.log(`  達成 ${all.filter(Boolean).length} / 未達 ${all.filter((v) => !v).length}`
      + "(どちらも出ないと条件付きカラーが撮れない)");
  }

  if (USERS.length) {
    console.log(`\n■ 担当者user: 先頭 ${USERS.length} 名へ割り当て`);
    USERS.forEach((u, i) => console.log(`  ${REPS[i]?.name ?? "(担当者が足りません)"} ← ${u}`));
    const n = rows.filter((r) => REPS.findIndex((x) => x.name === r.rep) < USERS.length).length;
    console.log(`  対象レコード ${n} 件(全体の ${Math.round((n / rows.length) * 100)}%)`);
  } else {
    console.log("\n■ 担当者user: --users 未指定のため書き込みません(D14 のペインは 0 件になります)");
  }
}

/* ---- 実行 ---------------------------------------------------------------- */

if (USERS.length > REPS.length) fail(`--users は最大 ${REPS.length} 件です`);

const rows = generate();
const goals = GOAL_APP ? buildGoals(rows) : null;

summarize(rows, goals);

if (CSV_DIR) {
  writeCsv(CSV_DIR, rows, goals);
  process.exit(0);
}

if (!APPLY) {
  console.log("\n下見モードです(何も書き込んでいません)。投入するには --apply を付けてください。");
  process.exit(0);
}
if (!APP) fail("--app に売上明細のアプリ番号を指定してください");

const conn = auth();

if (USERS.length) {
  console.log("\nログイン名を確認しています…");
  await probeUsers(conn, APP, rows[0]);
  console.log("  OK");
}

if (CLEAN) {
  console.log(`既存レコードを削除しています…`);
  console.log(`  売上明細 ${await deleteAll(conn, APP)} 件`);
  if (GOAL_APP) console.log(`  月次目標 ${await deleteAll(conn, GOAL_APP)} 件`);
  if (MASTER_APP) console.log(`  商品分類マスタ ${await deleteAll(conn, MASTER_APP)} 件`);
}

/* マスタを先に入れる。明細の商品名との突き合わせ(D17)は、マスタが揃っていないと確かめられない */
if (MASTER_APP) {
  const master = masterRows();
  await insert(conn, MASTER_APP, master, (m) => ({
    分類コード: { value: m[0] },
    分類名:     { value: m[1] },
    親コード:   { value: m[2] },
    階層:       { value: String(m[3]) },
    表示順:     { value: String(m[4]) },
    標準単価:   { value: m[5] === "" ? "" : String(m[5]) },
  }), "商品分類マスタ");
  console.log(`APP${MASTER_APP} へ ${master.length} 件を投入しました`);
}

await insert(conn, APP, rows, (r) => salesRecord(r), "売上明細");
console.log(`APP${APP} へ ${rows.length} 件を投入しました`);

if (GOAL_APP) {
  await insert(conn, GOAL_APP, goals, (g) => ({
    担当者名: { value: g.rep },
    年月:     { value: g.ym },
    部署:     { value: g.dept },
    目標金額: { value: String(g.goal) },
  }), "月次目標");
  console.log(`APP${GOAL_APP} へ ${goals.length} 件を投入しました`);
}
