import { inspectPage } from './reader.js';

const inspectButton = document.querySelector('#inspect');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const labels = {
  courseLinks: 'Possible course links',
  calendarLinks: 'Calendar links',
  assignmentLinks: 'Assignment links',
  quizLinks: 'Quiz links',
  discussionLinks: 'Discussion links',
  semanticTimes: 'Machine-readable date elements',
  openShadowRoots: 'Open component roots',
  framesNotInspected: 'Frames not inspected'
};

inspectButton.addEventListener('click', async () => {
  inspectButton.disabled = true;
  results.replaceChildren();
  status.textContent = 'Inspecting the currently loaded page…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentUrl = new URL(tab?.url ?? 'about:blank');
    if (currentUrl.origin !== 'https://lms.unb.ca' || !currentUrl.pathname.startsWith('/d2l/')) {
      status.textContent = 'Open a signed-in page on lms.unb.ca, then reopen this probe.';
      return;
    }
    const [inspection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'ISOLATED',
      func: inspectPage
    });
    if (inspection?.result?.status !== 'inspected') {
      status.textContent = 'The tab changed or is not a supported UNB page. Nothing was collected.';
      return;
    }
    for (const [key, label] of Object.entries(labels)) {
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = label;
      value.textContent = String(inspection.result.counters[key]);
      results.append(term, value);
    }
    status.textContent = inspection.result.truncated
      ? 'Partial inspection: the page exceeded the 20,000-element limit.'
      : 'Page structure read. No network requests or data saved by this probe.';
  } catch {
    status.textContent = 'Inspection unavailable. Reopen the probe on your signed-in Brightspace page.';
  } finally {
    inspectButton.disabled = false;
  }
});
