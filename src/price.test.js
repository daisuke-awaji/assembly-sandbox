import { test } from 'node:test'
import assert from 'node:assert/strict'
import { total, tax, TAX_RATE_PERCENT } from './price.js'

test('sums price × qty', () => {
  assert.equal(total([{ price: 100, qty: 2 }, { price: 50, qty: 1 }]), 250)
})

test('throws TypeError when items is not an array', () => {
  for (const bad of [undefined, null, {}, 'abc', 42]) {
    assert.throws(() => total(bad), TypeError)
  }
})

test('throws TypeError for invalid price or qty', () => {
  const bads = [NaN, Infinity, -Infinity, -1, '1', null, undefined]
  for (const bad of bads) {
    assert.throws(() => total([{ price: bad, qty: 1 }]), TypeError)
    assert.throws(() => total([{ price: 1, qty: bad }]), TypeError)
  }
  assert.throws(() => total([null]), TypeError)
})

test('empty cart totals 0', () => {
  assert.equal(total([]), 0)
})

test('qty 0 contributes nothing', () => {
  assert.equal(total([{ price: 100, qty: 0 }]), 0)
  assert.equal(total([{ price: 100, qty: 0 }, { price: 50, qty: 2 }]), 100)
})

test('single item', () => {
  assert.equal(total([{ price: 300, qty: 3 }]), 900)
})

test('large numbers', () => {
  assert.equal(total([{ price: 1_000_000, qty: 1_000_000 }]), 1e12)
  assert.equal(total([{ price: Number.MAX_SAFE_INTEGER, qty: 1 }]), Number.MAX_SAFE_INTEGER)
})

test('tax rate is 10 percent', () => {
  assert.equal(TAX_RATE_PERCENT, 10)
})

test('tax rounds down', () => {
  assert.equal(tax(0), 0)
  assert.equal(tax(9), 0)
  assert.equal(tax(10), 1)
  assert.equal(tax(999), 99)
})

test('tax with large amounts', () => {
  assert.equal(tax(1_000_000), 100_000)
  assert.equal(tax(1e12), 1e11)
})

test('tax throws TypeError for invalid amount', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '100', null, undefined]) {
    assert.throws(() => tax(bad), TypeError)
  }
})

test('total throws TypeError for fractional price or qty', () => {
  for (const bad of [0.5, 1.5]) {
    assert.throws(() => total([{ price: bad, qty: 1 }]), TypeError)
    assert.throws(() => total([{ price: 1, qty: bad }]), TypeError)
  }
})

test('total throws TypeError for non-object items', () => {
  assert.throws(() => total([undefined]), TypeError)
  assert.throws(() => total([5]), TypeError)
})

test('total throws RangeError beyond safe integer range', () => {
  assert.throws(() => total([{ price: Number.MAX_SAFE_INTEGER, qty: 2 }]), RangeError)
  assert.throws(
    () => total([{ price: Number.MAX_SAFE_INTEGER, qty: 1 }, { price: 1, qty: 1 }]),
    RangeError,
  )
})
