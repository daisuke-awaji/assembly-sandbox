# 消費税 (10%) と割引クーポン対応 実装計画

## 現状
`src/price.js` の `total(items)` は `items = [{price, qty}]` の `price * qty` の総和(税・割引なし)。テストは `src/price.test.js`(`npm test`)。

## 方針
- `total(items)` は入力検証済み(整数円のみ、上限超過は `RangeError`)。税・割引は別関数で追加する。
- 金額は整数円のみ扱い、丸めは「円未満切り捨て」(`Math.floor`)に統一。税率は定数 `TAX_RATE_PERCENT = 10` とし、整数演算 `Math.floor(x * 10 / 100)` で浮動小数誤差を避ける。

## API 案 (`src/price.js`)
```js
total(items): number                              // 既存。税抜・割引なし小計
applyCoupon(subtotal, coupon): number             // 割引後の税抜金額
tax(amount): number                               // floor(amount * 10 / 100)
checkout(items, coupon?): { subtotal, discount, taxable, tax, total }
```
- coupon: `{ type: 'percent', value: 1..100 }` または `{ type: 'fixed', value: 正の整数(円) }`
- 順序: 小計 → 割引 → 税計算(割引後の金額に課税)→ 税込合計 = taxable + tax。
- 割引額: percent は `floor(subtotal * value / 100)`、fixed は `min(value, subtotal)`。

## エッジケース
- `items` が空 → すべて 0。`coupon` 省略/`null` → 割引 0。
- 割引が小計超過 → taxable は 0 を下限(負にしない)。
- percent が 0 以下・100 超、fixed が非整数・負数、未知の `type` → `RangeError`/`TypeError`。
- `price`/`qty` が負・非整数・NaN → `TypeError`。`total` は入力検証済み(整数円のみ、上限超過は `RangeError`)。
- 端数: 税 `floor(999 * 0.1) = 99`、percent 割引も切り捨て(割引額が小さく出る=店側有利、仕様として明記)。
- 大きな金額での `Number.MAX_SAFE_INTEGER` 超過(必要なら検証)。

## テスト方針 (`node --test`、`src/price.test.js` に追加)
- 既存 `total` テストは無変更で維持。
- `tax`: 0, 9(→0), 10(→1), 999(→99), 大きい値。
- `applyCoupon`: percent / fixed / 小計超過 / 0円クーポン / 無効クーポンで例外。
- `checkout`: クーポンなし、percent、fixed、全額無料、空カート、割引後に税を計算する順序の確認(例: 小計 1000, 10%引き → 900, 税 90, 合計 990)。
- 境界値表駆動テストで丸め方向を固定する。

## 作業分割
1. `tax` と定数の追加 + テスト(小さく独立)。
2. `applyCoupon` と入力検証 + テスト。
3. `checkout` で結合 + 結合テスト。
4. README に API と丸め/順序の仕様を追記。

各ステップで `npm test` を通してからコミット。未決事項: クーポン複数枚適用の可否、軽減税率(8%)の将来対応(税率を引数化できる余地を残す)。
