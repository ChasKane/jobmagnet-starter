/**
 * Review-panel insight: how Autofill treated a field, and which write strategies are in play.
 * UMD: Node `require` and chrome `<script>`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MagnetReviewInsight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_CHAIN = [
    'native_value',
    'input_events',
    'select_value',
    'select_text',
    'label_click',
    'react_select',
    'combobox',
  ];

  const STRATEGY_LABELS = {
    native_value: 'Set value',
    input_events: 'Type events',
    select_value: 'Select value',
    select_text: 'Select text',
    label_click: 'Click label',
    react_select: 'React Select',
    combobox: 'Combobox',
    date_mask: 'Date mask',
    steps: 'Learned steps',
    run: 'Saved script',
  };

  const ROUTE_LABELS = {
    static: 'Known fact',
    needs_llm: 'Essay',
    skip: 'Skip',
    employment: 'Employment',
  };

  const FILTERS = [
    { id: 'need', label: 'Needs you' },
    { id: 'all', label: 'All' },
    { id: 'filled', label: 'Filled' },
    { id: 'essay', label: 'Essays' },
    { id: 'skip', label: 'Skipped' },
  ];

  function clip(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function strategyLabel(name) {
    const key = String(name || '');
    return STRATEGY_LABELS[key] || key || '—';
  }

  function routeLabel(route) {
    const key = String(route || '');
    return ROUTE_LABELS[key] || key || '—';
  }

  function fieldFamily(field) {
    return String((field && field.shape && field.shape.family) || '');
  }

  function fieldClass(field) {
    return String((field && (field.qClass || field.class_id || field.class)) || '');
  }

  function fieldBucket(field) {
    if (!field) return 'other';
    const route = String(field.route || '');
    const state = String(field.magnetState || '');
    if (route === 'needs_llm' || state === 'orange') return 'essay';
    if (route === 'skip' || route === 'employment' || state === 'skip') return 'skip';
    if (state === 'green' || (field.fill && field.fill.ok && !field.fill.skipped)) return 'filled';
    if (state === 'red' || field.residual) return 'leftover';
    if (field.fill && field.fill.skipped) return 'skip';
    return 'other';
  }

  function reviewCounts(fields) {
    const counts = { all: 0, filled: 0, leftover: 0, essay: 0, skip: 0, other: 0, need: 0 };
    for (const f of fields || []) {
      if (!f) continue;
      counts.all += 1;
      const b = fieldBucket(f);
      counts[b] = (counts[b] || 0) + 1;
    }
    counts.need = counts.leftover;
    return counts;
  }

  function filterFields(fields, filter) {
    const list = (fields || []).filter(Boolean);
    if (!filter || filter === 'all') return list;
    if (filter === 'need') return list.filter((f) => fieldBucket(f) === 'leftover');
    return list.filter((f) => fieldBucket(f) === filter);
  }

  function fillChainOf(field) {
    const chain = field && field.fill && Array.isArray(field.fill.chain) ? field.fill.chain.filter(Boolean) : [];
    return chain.length ? chain.slice() : DEFAULT_CHAIN.slice();
  }

  function strategyChoices(field, cache) {
    const family = fieldFamily(field);
    const row = cache && family ? cache[family] : null;
    const names = fillChainOf(field);
    for (const extra of ['steps', 'run']) {
      if (!names.includes(extra)) names.push(extra);
    }
    const won = field && field.fill && field.fill.strategy;
    return names.map((name) => {
      const stats = row && row.strategies && row.strategies[name];
      return {
        name,
        label: strategyLabel(name),
        wins: Number(stats && stats.wins) || 0,
        losses: Number(stats && stats.losses) || 0,
        last: Boolean(row && row.last_success === name),
        won: Boolean(won && won === name),
        flagged: Boolean(row && Array.isArray(row.human_flags) && row.human_flags.includes(name)),
      };
    });
  }

  function pipelineLines(field, extra) {
    const rec = extra || {};
    const live = rec.field || field || {};
    const lines = [];
    const route = live.route || field.route || '';
    const classify = live.classifyReason || (route && live.reason && !/could not|magnet put|no fact|unlabeled/i.test(String(live.reason)) ? live.reason : '');
    if (route) {
      lines.push({ k: 'Route', v: classify ? routeLabel(route) + ' · ' + classify : routeLabel(route) });
    }
    const klass = fieldClass(live) || fieldClass(field);
    const kind = live.qKind || field.qKind || '';
    if (klass) lines.push({ k: 'Class', v: kind && kind !== 'other' ? klass + ' · ' + kind : klass });
    const profile = clip(live.profileValue || field.profileValue, 48);
    const intended = clip(live.intended || field.intended || field.value, 48);
    if (profile && intended && profile !== intended) {
      lines.push({ k: 'Fact', v: profile + ' → ' + intended });
    } else if (intended) {
      lines.push({ k: 'Fact', v: intended });
    } else if (profile) {
      lines.push({ k: 'Fact', v: profile });
    }
    const page = clip(live.current || live.pageValue || field.pageValue || field.current || field.value, 48);
    if (page && page !== intended) lines.push({ k: 'Page', v: page });
    const family = fieldFamily(live) || fieldFamily(field);
    if (family) lines.push({ k: 'Widget', v: family });
    const fill = live.fill || field.fill;
    if (fill && fill.skipped) {
      lines.push({ k: 'Write', v: 'left as-is · ' + fill.skipped });
    } else if (fill && fill.ok && fill.strategy) {
      lines.push({ k: 'Wrote', v: strategyLabel(fill.strategy) });
    } else if (fill && Array.isArray(fill.chain) && fill.chain.length) {
      lines.push({ k: 'Tried', v: fill.chain.map(strategyLabel).join(' → ') });
    } else if (fill && fill.reason) {
      lines.push({ k: 'Write', v: String(fill.reason) });
    }
    const recipe = live.recipeHit || field.recipeHit;
    if (recipe && (recipe.label_key || recipe.match)) {
      lines.push({
        k: 'Recipe',
        v: [recipe.label_key, recipe.match, recipe.has_steps ? 'steps' : '', recipe.has_run ? 'script' : '']
          .filter(Boolean)
          .join(' · '),
      });
    }
    const cache = rec.cache && family ? rec.cache[family] : null;
    if (cache && cache.last_success) {
      const wins = cache.strategies && cache.strategies[cache.last_success];
      const score =
        wins && (wins.wins || wins.losses)
          ? ' · ' + (Number(wins.wins) || 0) + '–' + (Number(wins.losses) || 0)
          : '';
      lines.push({ k: 'Family wins with', v: strategyLabel(cache.last_success) + score });
    }
    const gate = rec.gate || field.gate || '';
    if (gate && gate !== 'clean' && gate !== 'landed') lines.push({ k: 'Gate', v: gate });
    return lines;
  }

  function inventoryLabel(field) {
    return clip((field && (field.label || field.id)) || 'field', 72);
  }

  function inventoryValue(field) {
    const fill = field && field.fill;
    if (fieldBucket(field) === 'skip') {
      return (fill && fill.skipped) || field.reason || 'skipped';
    }
    return clip(field.current || field.intended || field.profileValue || '', 42);
  }

  return {
    DEFAULT_CHAIN,
    STRATEGY_LABELS,
    ROUTE_LABELS,
    FILTERS,
    strategyLabel,
    routeLabel,
    fieldFamily,
    fieldClass,
    fieldBucket,
    reviewCounts,
    filterFields,
    fillChainOf,
    strategyChoices,
    pipelineLines,
    inventoryLabel,
    inventoryValue,
    clip,
  };
});
