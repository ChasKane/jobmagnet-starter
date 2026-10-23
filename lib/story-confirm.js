/** Ask Keep / edit employer / Skip before filing work-story cards. */

const { splitExperienceUpdates, applyUpdates } = require('./profile-facts');

function storyConfirmAsks(cards, opts = {}) {
  const prefix = opts.prefix || 'story';
  return (cards || [])
    .map((c, i) => {
      const text = String((c && c.text) || '').trim();
      if (!text) return null;
      const employer = String((c && c.employer) || '').trim();
      return {
        id: `${prefix}-${i + 1}`,
        prompt: employer
          ? `File this work note under ${employer}?`
          : 'File this work note? Pick an employer or Skip.',
        why: text.slice(0, 280),
        kind: 'story-confirm',
        story: {
          employer,
          text,
          card_id: String((c && c.card_id) || '').trim(),
          parked: Boolean(c && c.parked),
        },
        options: [
          { id: 'keep', label: 'Keep' },
          { id: 'skip', label: 'Skip' },
        ],
        allow_multiple: false,
        answered: false,
      };
    })
    .filter(Boolean);
}

function choiceOf(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return String(raw.choice || raw.label || raw.value || '').trim();
  }
  if (Array.isArray(raw)) return String(raw[0] || '').trim();
  return String(raw).trim();
}

function employerOf(ask, raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.employer != null) {
    return String(raw.employer).trim();
  }
  return String((ask && ask.story && ask.story.employer) || '').trim();
}

async function resolveStoryAsks(asks, answers, opts = {}) {
  const rows = (asks || []).filter((a) => a && a.kind === 'story-confirm' && a.story);
  if (!rows.length) return { handled: false, onlyStories: false, cards: [], reply: '', filed: 0 };
  const keep = [];
  const parkedKeep = [];
  for (const a of rows) {
    const raw = answers && (answers[a.id] || answers[a.prompt]);
    const choice = choiceOf(raw).toLowerCase();
    if (!choice || choice === 'skip') continue;
    if (a.story.parked && a.story.card_id) {
      parkedKeep.push(a.story.card_id);
      continue;
    }
    keep.push({
      employer: employerOf(a, raw),
      text: a.story.text,
    });
  }
  const split = splitExperienceUpdates(keep);
  const profile = split.profile.length ? applyUpdates(split.profile) : [];
  let patches = [];
  if (split.cards.length) {
    const { applyExperienceUpdates } = require('./employment');
    patches = await applyExperienceUpdates(split.cards, {
      userText: opts.userText || '',
      source: opts.source || 'chat',
    });
  }
  if (parkedKeep.length) {
    const { confirmExtracted } = require('./compile');
    for (const id of parkedKeep) {
      const bumped = confirmExtracted(id);
      if (bumped && bumped.kind !== 'no-op') patches.push(bumped);
    }
  }
  const filed = (patches || []).filter((p) => p && p.kind && p.kind !== 'no-op').length;
  const reply = filed
    ? `Filed ${filed} work note${filed === 1 ? '' : 's'}.`
    : keep.length
      ? 'Did not file: quotes must match the applicant’s wording.'
      : 'Skipped work notes.';
  if (opts.state && opts.state.actions) {
    opts.state.actions.experience_updates = split.cards;
    opts.state.actions.profile_updates = profile;
    opts.state.actions.story_patches = patches;
  }
  const onlyStories = (asks || []).every((a) => !a || a.kind === 'story-confirm');
  return { handled: true, onlyStories, cards: split.cards, patches, profile, filed, reply };
}

module.exports = { storyConfirmAsks, resolveStoryAsks };
