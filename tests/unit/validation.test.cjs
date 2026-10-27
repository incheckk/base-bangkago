const test = require('node:test');
const assert = require('node:assert/strict');
const { nameError, addressError, textError } = require('../.build/utils/validation.js');

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
