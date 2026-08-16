/**
 * 記事用デモアプリのマスタ値。設計は docs/internal/plans/K138-デモアプリ設計.md §5。
 *
 * **アプリを作る側(create-demo-apps.mjs)とデータを入れる側(load-demo-data.mjs)の
 * 両方がここを見る。** ドロップダウンの選択肢と、投入するデータの値が同じ元から出るので、
 * 片方だけ直して「選択肢に無い値が入っている」状態にならない。
 */

/**
 * **単価帯を分類ごとに変えるのが要点。** 単価が一様だと件数のグラフと金額のグラフが
 * 同じ形になり、複合 2 軸・単位の使い分け・増減の向きが絵に出ない。
 * この配分だと件数の 1 位は「コピー用紙」、金額の 1 位は「導入コンサルティング」になる。
 *
 * weight の合計は 100。上位 4 分類で 52%、下位 2 分類で 6% —
 * **上位 N +「その他」が意味を持つ配分**(分類が 8 を超えているのも意図的)。
 */
export const CATEGORIES = [
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
export const QTY = { "事務用品": [10, 200], "OA 機器": [1, 20], "オフィス家具": [1, 30], "サービス": [1, 3] };

/**
 * **担当者の重みはトップとボトムで 2.6 倍。** 均等に振るとランキング表も横棒も
 * 全部同じ長さになり、Top N の記事が成立しない。
 * `--users` のログイン名は**この順で先頭から**割り当てる。
 */
export const REPS = [
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
export const REGIONS = [
  { name: "関東", weight: 28 }, { name: "近畿", weight: 16 }, { name: "東海", weight: 12 },
  { name: "北海道・東北", weight: 10 }, { name: "九州・沖縄", weight: 10 },
  { name: "甲信越・北陸", weight: 9 }, { name: "中国", weight: 8 }, { name: "四国", weight: 7 },
];

/** 60 社。一様に引くとランクは A 20% / B 45% / C 35% になる */
export const CUSTOMERS = (() => {
  const heads = ["青葉", "朝日", "一光", "上原", "桜和", "加賀", "北星", "小泉", "三共", "昭和",
                 "新光", "第一", "高砂", "中央", "東和", "西山", "日進", "初穂", "富士見", "緑川"];
  const tails = ["商事", "工業", "製作所"];
  const list = [];
  for (const h of heads) for (const t of tails) list.push(`${h}${t}`);
  return list.map((name, i) => ({ name, rank: i < 12 ? "A" : i < 39 ? "B" : "C" }));
})();

/** 顧客ランクは**取引規模**に効かせる(単価ではなく数量)。同じ商品の単価が客先で変わるのは不自然 */
export const RANK_QTY = { A: 1.6, B: 1.0, C: 0.7 };

/**
 * 売上明細のステータス。「取消」があると `WHERE 売上ステータス <> '取消'` の例が書ける。
 *
 * **フィールドコードは `売上ステータス`。**`ステータス` は kintone の予約コード
 * (プロセス管理)で、そのままではフィールドを作れない。
 */
export const STATUS = [{ name: "確定", weight: 70 }, { name: "保留", weight: 20 }, { name: "取消", weight: 10 }];

/** 月ごとの季節性(1 月始まり)。3 月と 9 月が山、8 月と 1 月が谷 */
export const SEASON = [0.85, 0.95, 1.35, 1.0, 0.95, 1.05, 0.95, 0.8, 1.25, 1.0, 1.0, 1.1];


/** 商品分類マスタ 40 件(大 4 + 中 12 + 商品 24)。CATEGORIES から導出する */
export function masterRows() {
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
