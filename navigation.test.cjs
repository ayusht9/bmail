const test = require('node:test');
const assert = require('node:assert/strict');

const home = { tab: 'mailbox', folder: '', filter: '' };
const create = async () => (await import('./src/navigation.js')).createNavigation(home);

test('navigation restores filters and stops at history boundaries', async () => {
  const navigation = await create();
  assert.equal(navigation.move(-1, ''), null);
  assert.equal(navigation.canMove(1), false);
  navigation.remember('mailbox', 'Inbox', 'in');
  navigation.remember('activity', 'Inbox', 'recent');
  assert.deepEqual(navigation.move(-1, 'activity filter'), { tab: 'mailbox', folder: 'Inbox', filter: 'recent' });
  assert.deepEqual(navigation.move(-1, 'inbox filter'), { ...home, filter: 'in' });
  assert.equal(navigation.canMove(-1), false);
  assert.deepEqual(navigation.move(1, ''), { tab: 'mailbox', folder: 'Inbox', filter: 'inbox filter' });
  assert.deepEqual(navigation.move(1, ''), { tab: 'activity', folder: 'Inbox', filter: 'activity filter' });
  assert.equal(navigation.move(1, ''), null);
});

test('revisiting the current destination preserves forward history; a new one replaces it', async () => {
  const navigation = await create();
  navigation.remember('options', '', '');
  navigation.move(-1, '');
  navigation.remember('mailbox', '', 'updated');
  assert.equal(navigation.canMove(1), true);
  navigation.remember('scheduler', '', '');
  assert.equal(navigation.canMove(1), false);
  assert.deepEqual(navigation.move(-1, ''), { ...home, filter: '' });
  assert.equal(navigation.move(1, '').tab, 'scheduler');
});

test('history retains the newest 100 destinations and resets on account changes', async () => {
  const navigation = await create();
  for (let i = 1; i <= 110; i++) navigation.remember('mailbox', `Folder ${i}`, '');
  let destination;
  let steps = 0;
  while (navigation.canMove(-1)) {
    destination = navigation.move(-1, '');
    steps++;
  }
  assert.equal(steps, 99);
  assert.equal(destination.folder, 'Folder 11');
  navigation.reset(home);
  assert.equal(navigation.canMove(-1), false);
  assert.equal(navigation.canMove(1), false);
});

test('callers cannot mutate history through destination objects', async () => {
  const initial = { ...home };
  const { createNavigation } = await import('./src/navigation.js');
  const navigation = createNavigation(initial);
  initial.folder = 'changed';
  navigation.remember('options', '', '');
  const destination = navigation.move(-1, '');
  destination.tab = 'changed';
  navigation.move(1, '');
  assert.equal(navigation.move(-1, '').tab, 'mailbox');
  navigation.reset(initial);
  initial.folder = 'changed again';
  navigation.remember('options', '', '');
  assert.equal(navigation.move(-1, '').folder, 'changed');
});
