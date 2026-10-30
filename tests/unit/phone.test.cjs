const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, phoneToAuthEmail, formatPhone } = require('../.build/utils/phone.js');

test('normalizePhone converts every accepted PH mobile format to E.164', () => {
  const expected = '+639171234567';
  for (const input of [
    '0917 123 4567',
    '0917-123-4567',
    '(0917) 1234567',
    '9171234567',
    '+63 917 123 4567',
    '639171234567',
    '0063 917 123 4567',
    '+63-917-123-4567',
  ]) {
    assert.equal(normalizePhone(input), expected, input);
  }
});

test('normalizePhone rejects non-mobile and malformed numbers', () => {
  for (const input of ['0817 123 4567', '0917 123 456', '0917 123 45678', '', 'abc', '+1 415 555 0100']) {
    assert.equal(normalizePhone(input), null, input);
  }
});

test('phoneToAuthEmail builds the synthetic Supabase login email', () => {
  assert.equal(phoneToAuthEmail('09171234567'), 'bangkago+639171234567@gmail.com');
  assert.equal(phoneToAuthEmail('+63 917 123 4567'), 'bangkago+639171234567@gmail.com');
});

test('phoneToAuthEmail throws on invalid input', () => {
  assert.throws(() => phoneToAuthEmail('12345'), /not a valid PH mobile number/);
});

test('formatPhone renders the local display format and falls back safely', () => {
  assert.equal(formatPhone('+639171234567'), '0917 123 4567');
  assert.equal(formatPhone('not-a-number'), 'not-a-number');
});
