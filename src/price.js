const isValidNumber = (n) => Number.isSafeInteger(n) && n >= 0

export const TAX_RATE_PERCENT = 10

/** Consumption tax in yen for an integer amount, rounded down. */
export function tax(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError('amount must be a non-negative integer')
  }
  return Math.floor(amount * TAX_RATE_PERCENT / 100)
}

/** Total price of the cart items in yen. */
export function total(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array')
  }
  return items.reduce((sum, i) => {
    if (i == null || !isValidNumber(i.price) || !isValidNumber(i.qty)) {
      throw new TypeError('price and qty must be non-negative safe integers')
    }
    const line = i.price * i.qty
    const next = sum + line
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(next)) {
      throw new RangeError('total exceeds Number.MAX_SAFE_INTEGER')
    }
    return next
  }, 0)
}
