import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBoardDone, showPriority, estimateIsDefault, estimatePrefix } from './assignmentBadges.js';

test('showPriority: hidden once the assignment is Done', () => {
  // The done-badge rule: a finished item never shows its priority badge.
  assert.equal(showPriority({ boardStage: 'done', priority: 'high' }), false);
  assert.equal(showPriority({ done: true, priority: 'high' }), false);
  assert.equal(showPriority({ board_stage: 'done' }), false); // raw row shape too
});

test('showPriority: shown for active work of any priority', () => {
  for (const stage of ['not_started', 'backlog', 'planning', 'in_progress']) {
    assert.equal(showPriority({ boardStage: stage, priority: 'high' }), true, stage);
  }
  assert.equal(showPriority({ boardStage: 'in_progress', priority: 'none' }), true);
});

test('isBoardDone reflects the Done column only', () => {
  assert.equal(isBoardDone({ boardStage: 'done' }), true);
  assert.equal(isBoardDone({ boardStage: 'in_progress' }), false);
  assert.equal(isBoardDone({}), false);
});

test('estimate default marking', () => {
  assert.equal(estimateIsDefault({ estimateSource: 'default' }), true);
  assert.equal(estimateIsDefault({ estimateSource: 'ai' }), false);
  assert.equal(estimateIsDefault({ estimateSource: 'manual' }), false);
  assert.equal(estimateIsDefault({ estimate_source: 'default' }), true); // raw row shape
  assert.equal(estimatePrefix({ estimateSource: 'default' }), '~');
  assert.equal(estimatePrefix({ estimateSource: 'ai' }), '');
});
