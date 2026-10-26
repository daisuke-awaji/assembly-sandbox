import { test } from 'node:test'
import assert from 'node:assert/strict'
import { total } from './price.js'

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
