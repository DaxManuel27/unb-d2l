import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { inspectPage } from '../spike/reader.js';

function element(tagName, attributes = {}, shadowRoot = null) {
  return Object.freeze({
    tagName,
    shadowRoot,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name)
  });
}

function runProbe(elements, url = 'https://lms.unb.ca/d2l/home', extra = {}) {
  const context = vm.createContext({
    location: Object.freeze(new URL(url)),
    URL,
    document: Object.freeze({ querySelectorAll: () => elements }),
    ...extra
  });
  return JSON.parse(JSON.stringify(vm.runInContext(`(${inspectPage.toString()})()`, context)));
}

test('reads structure without network, storage, credentials, or mutating page APIs', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Forbidden API accessed'); } });
  const elements = [
    element('A', { href: '/d2l/home/12345' }),
    element('A', { href: '/d2l/home/12345' }),
    element('A', { href: '/d2l/lms/dropbox/user/folders_list.d2l?ou=12345' }),
    element('A', { href: 'https://outside.example/d2l/home/12' }),
    element('TIME', { datetime: '2026-10-01T12:00:00Z' }),
    element('IFRAME'),
    element('D2L-COMPONENT', {}, Object.freeze({
      querySelectorAll: () => [element('A', { href: '/d2l/lms/quizzing/user/quizzes_list.d2l?ou=12345' })]
    }))
  ];
  const report = runProbe(elements, undefined, {
    fetch() { throw new Error('Network call attempted'); },
    XMLHttpRequest: forbidden,
    navigator: forbidden,
    chrome: forbidden,
    localStorage: forbidden,
    indexedDB: forbidden
  });
  assert.equal(report.status, 'inspected');
  assert.equal(report.counters.courseLinks, 1);
  assert.equal(report.counters.assignmentLinks, 1);
  assert.equal(report.counters.quizLinks, 1);
  assert.equal(report.counters.semanticTimes, 1);
  assert.equal(report.counters.openShadowRoots, 1);
  assert.equal(report.counters.framesNotInspected, 1);
  const serialized = JSON.stringify(report);
  for (const privateValue of ['12345', '2026-10-01', 'https:', 'ou=']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('rejects non-LMS pages before reading the document', () => {
  for (const url of [
    'https://login.microsoftonline.com/',
    'http://lms.unb.ca/d2l/home',
    'https://lms.unb.ca.evil.example/d2l/home',
    'https://lms.unb.ca/login',
    'https://lms.unb.ca:8443/d2l/home'
  ]) {
    assert.deepEqual(runProbe([], url, {
      document: new Proxy({}, { get() { throw new Error('Document must not be read'); } })
    }), { status: 'unsupported' });
  }
});

test('bounds inspection and reports partial coverage', () => {
  const report = runProbe(Array.from({ length: 20001 }, () => element('DIV')));
  assert.equal(report.truncated, true);
});

test('ignores malformed and credential-bearing links', () => {
  const report = runProbe([
    element('A', { href: 'https://[' }),
    element('A', { href: 'https://user:secret@lms.unb.ca/d2l/home/123' }),
    element('A', { href: 'javascript:alert(1)' })
  ]);
  assert.equal(report.counters.courseLinks, 0);
});

test('packaged probe has no persistent hosts, storage, background, or network capability', async () => {
  const manifest = JSON.parse(await readFile(new URL('../spike/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  for (const key of ['host_permissions', 'optional_host_permissions', 'background', 'content_scripts', 'externally_connectable']) {
    assert.equal(Object.hasOwn(manifest, key), false);
  }
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(manifest.content_security_policy.extension_pages, /form-action 'none'/);
});
