const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nameError, addressError, textError, normalizePayoutNumber, payoutNumberError,
} = require('./load-ts.cjs')('src/utils/validation.ts');

test('nameError accepts real passenger names', () => {
  assert.equal(nameError('Maria Jose'), null);
  assert.equal(nameError("Ana-Mae O'Neil"), null);
  assert.equal(nameError('  Niño  '), null);
});

test('nameError rejects names shorter than two letters', () => {
  assert.equal(nameError('A'), 'At least 2 letters');
  assert.equal(nameError('   '), 'At least 2 letters');
  assert.equal(nameError(''), 'At least 2 letters');
});

test('nameError rejects digits, emoji and symbols', () => {
  assert.equal(nameError('Juan123'), 'Letters, spaces, hyphens only');
  assert.equal(nameError('Juan 😀'), 'Letters, spaces, hyphens only');
  assert.equal(nameError('Juan@Dela'), 'Letters, spaces, hyphens only');
});

test('nameError rejects keyboard junk and one-letter repeats', () => {
  assert.equal(nameError('www'), 'Enter a real name');
  assert.equal(nameError('qqq'), 'Enter a real name');
  assert.equal(nameError('oooooo'), 'Enter a real name');
  assert.equal(nameError('   www'), 'Enter a real name');
  assert.equal(nameError('w-w'), 'Enter a real name');
  assert.equal(nameError('Aa'), 'Enter a real name');
  assert.equal(nameError('Leee'), 'Enter a real name');
});

test('addressError accepts complete PH street addresses', () => {
  assert.equal(addressError('123 Mabini St., Brgy. 5'), null);
  assert.equal(addressError('Unit 2-B, #45 Sikatuna Rd. (Poblacion)'), null);
});

test('addressError rejects short and invalid addresses', () => {
  assert.equal(addressError('Rd'), 'Enter a complete address');
  assert.equal(addressError('   '), 'Enter a complete address');
  assert.equal(addressError('123 Main St. 😀'), 'Letters, numbers and , . # - ( ) only');
  assert.equal(addressError('Street; Drop Table'), 'Letters, numbers and , . # - ( ) only');
});

test('textError accepts parcel item names and rejects junk', () => {
  assert.equal(textError('Rice 25kg'), null);
  assert.equal(textError('Sack of corn (2)'), null);
  assert.equal(textError('A'), 'At least 2 characters');
  assert.equal(textError('TV 50%'), null);
  assert.equal(textError('Item; DROP'), 'Letters, numbers and basic punctuation only');
});

test('payoutNumberError accepts PH GCash numbers and normalises them', () => {
  assert.equal(payoutNumberError('09171234567'), null);
  assert.equal(payoutNumberError('0917 123 4567'), null);
  assert.equal(payoutNumberError('+63 917 123 4567'), null);
  assert.equal(normalizePayoutNumber('+63 917 123 4567'), '09171234567');
  assert.equal(normalizePayoutNumber('0917-123-4567'), '09171234567');
});

test('payoutNumberError rejects landlines, short numbers and junk', () => {
  assert.equal(payoutNumberError(''), 'Enter a GCash number: 09XX XXX XXXX');
  assert.equal(payoutNumberError('9171234567'), 'Enter a GCash number: 09XX XXX XXXX');
  assert.equal(payoutNumberError('0321234567'), 'Enter a GCash number: 09XX XXX XXXX');
  assert.equal(payoutNumberError('091712345'), 'Enter a GCash number: 09XX XXX XXXX');
  assert.equal(payoutNumberError('091712345678'), 'Enter a GCash number: 09XX XXX XXXX');
});
