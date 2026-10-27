import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const dir = new URL('./', import.meta.url)
const html = readFileSync(new URL('index.html', dir), 'utf8')

test('has a title and a top heading', () => {
  assert.match(html, /<title>[^<]+<\/title>/)
  assert.match(html, /<h1>[^<]+<\/h1>/)
})

test('nav links point to existing sections', () => {
  const targets = [...html.matchAll(/href="#([\w-]+)"/g)].map(m => m[1])
  assert.ok(targets.length > 0)
  for (const id of targets) assert.match(html, new RegExp(`id="${id}"`))
})

test('stylesheet exists', () => {
  assert.ok(existsSync(new URL('style.css', dir)))
})
