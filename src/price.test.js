import { test } from 'node:test'
import assert from 'node:assert/strict'
import { total } from './price.js'

test('sums price × qty', () => {
  assert.equal(total([{ price: 100, qty: 2 }, { price: 50, qty: 1 }]), 250)
})
