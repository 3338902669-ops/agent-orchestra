// category-map.example.mjs - copy to category-map.mjs and edit.
//
// META maps a skill's registered name to [category, [keywords...]].
//
// Keywords are OPTIONAL and are no longer an entry requirement: the router leads with the
// skill's own `description`, which every author already writes. Supply keywords only where a
// description genuinely misses how people phrase the request. Leaving a skill out of META is
// fine - it becomes "unmapped" and is still routable.
//
// This file is an EXAMPLE. It deliberately names no real skills.

export const CATEGORIES = {
  coding: 'Coding and debugging',
  testing: 'Testing and verification',
  docs: 'Documents and writing',
  research: 'Research and browsing',
  workflow: 'Coordination and workflow',
  memory: 'Memory and context',
};

export const META = {
  'example-test-runner': ['testing', ['run tests', 'test suite', 'regression']],
  'example-doc-writer': ['docs', ['write docs', 'README', 'changelog']],
};
