'use strict';
const test = require('node:test');
const assert = require('node:assert');
const template = require('../src/services/template.service');

test('renders nested values', () => {
  const out = template.render('Hi {{user.firstName}}', { user: { firstName: 'Meera' } });
  assert.strictEqual(out, 'Hi Meera');
});

test('applies default when the value is missing', () => {
  const out = template.render('Hi {{user.firstName | default:there}}', { user: {} });
  assert.strictEqual(out, 'Hi there');
});

test('escapes HTML by default', () => {
  const out = template.render('{{user.firstName}}', { user: { firstName: '<script>' } });
  assert.ok(!out.includes('<script>'));
});

test('ignores unknown tokens instead of throwing', () => {
  assert.strictEqual(template.render('a {{nope.deep.path}} b', {}), 'a  b');
});

test('extractVariables lists referenced paths', () => {
  const vars = template.extractVariables('{{user.firstName}} and {{user.score}}');
  assert.deepStrictEqual(vars.sort(), ['user.firstName', 'user.score']);
});
