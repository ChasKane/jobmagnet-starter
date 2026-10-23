/**
 * Review card kind + instruct copy. UMD: Node `require` and chrome `<script>`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MagnetReviewCopy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function gateOf(row) {
    return String((row && (row.gate || row.askReason)) || '');
  }

  function reasonOf(row) {
    return String((row && row.reason) || '');
  }

  function reviewGateKind(row) {
    const gate = gateOf(row);
    const reason = reasonOf(row);
    if (gate === 'inferred' || gate === 'needs-infer' || /(^|\b)(inferred|needs-infer)(\b|$)/i.test(reason)) {
      return 'inferred';
    }
    if (gate === 'fuzzy' || /(^|\b)(fuzzy|unsure)(\b|$)/i.test(reason)) return 'unsure';
    if (gate === 'unlabeled' || /(^|\b)unlabeled(\b|$)/i.test(reason)) return 'unknown';
    if (gate === 'no-fact' || /^no fact\b/i.test(reason) || /^no profile value/i.test(reason)) return 'no-fact';
    if (gate === 'couldnt-land' || /could not fill|couldn't fill|couldnt-land/i.test(reason)) return 'couldnt-fill';
    if (gate === 'wrong-intended' || /wrong intended|magnet put|wrong value/i.test(reason)) return 'wrong';
    if (!String((row && row.value) || '').trim()) return 'empty';
    return 'couldnt-fill';
  }

  function reviewKindClass(row, extra) {
    const rec = extra || {};
    if (rec.recording) return 'review-kind-couldnt-fill';
    return 'review-kind-' + reviewGateKind(row);
  }

  function reviewCardKind(row, extra) {
    const rec = extra || {};
    if (rec.recording) return 'Recording fill';
    const kind = reviewGateKind(row);
    if (kind === 'unknown') return 'Unknown question';
    if (kind === 'no-fact') return 'No stored fact';
    if (kind === 'inferred') return 'Inferred from profile';
    if (kind === 'unsure') return 'Unsure';
    if (kind === 'empty') return 'Needs an answer';
    if (kind === 'wrong') return 'Check this fill';
    return "Couldn't fill";
  }

  function reviewEditHint(extra) {
    const kind = extra && extra.control;
    if (kind === 'select' || kind === 'radios') return 'Pick an option and Save';
    if (kind === 'checkboxes' || kind === 'checkbox') return 'Choose and Save';
    return 'Type an answer and Save';
  }

  function reviewCardWhy(row, extra) {
    const rec = extra || {};
    if (rec.verifying) {
      return rec.decoy ? 'Trying a decoy, then the intended value…' : 'Replaying these steps…';
    }
    if (rec.verified) {
      return rec.proved
        ? 'Decoy and intended both landed. Confirm to keep these steps.'
        : rec.error || 'Landed. Confirm to keep these steps.';
    }
    if (rec.failed) return rec.error || 'These steps did not prove out.';
    if (rec.recording) return 'Fill the field on the page, then hit Stop.';
    const kind = reviewGateKind(row);
    if (kind === 'unknown') {
      if (row && row.pageValue) {
        return (
          'Page already shows “' +
          String(row.pageValue).slice(0, 80) +
          '”. Magnet does not know this question — confirm that value or ask below.'
        );
      }
      return 'Magnet did not match this to a known fact. Ask below what it is, or Record filling it.';
    }
    if (kind === 'no-fact') {
      if (row && row.pageValue) {
        return (
          'Page already shows “' +
          String(row.pageValue).slice(0, 80) +
          '”. Magnet has no stored fact — Save that, or enter the real answer.'
        );
      }
      return 'Magnet knows the type but has no profile value. ' + reviewEditHint(rec) + ', or ask below.';
    }
    if (kind === 'inferred') {
      const fact = String((row && (row.profileValue || row.intended)) || '').trim();
      const picked = String((row && row.value) || '').trim();
      if (fact && picked) {
        return (
          'Mapped “' +
          fact.slice(0, 60) +
          '” onto “' +
          picked.slice(0, 80) +
          '”. Confirm or correct it.'
        );
      }
      if (picked) return 'Inferred “' + picked.slice(0, 80) + '” from the profile. Confirm or correct it.';
      return 'Magnet inferred this from the profile. Confirm or Leave blank.';
    }
    if (kind === 'unsure') {
      if (row && row.picked && row.intended) {
        return (
          'Used “' +
          String(row.picked).slice(0, 60) +
          '” as closest to “' +
          String(row.intended).slice(0, 60) +
          '”. Confirm or correct it.'
        );
      }
      return 'Magnet filled this but is not sure it is the right option. Confirm or correct it.';
    }
    if (kind === 'empty') {
      return reviewEditHint(rec) + ', ask Magnet below, Leave blank, or Record filling it on the page.';
    }
    if (kind === 'wrong') {
      const put = String((row && (row.previous || row.pageValue || row.value || row.intended)) || '').trim();
      return (
        (put ? 'Magnet put “' + put.slice(0, 80) + '”; is that right? ' : 'Magnet filled this. Is that right? ') +
        'Save a correction or Leave blank.'
      );
    }
    const family = rec.family ? ` (${rec.family})` : '';
    return (
      'Magnet knew this value but could not write it' +
      family +
      '. Record your fill with the red button, then Stop.'
    );
  }

  function reviewAskWhy(reason, klass) {
    if (reason === 'no-fact') return klass ? `No profile value for ${klass}` : 'No profile value yet';
    if (reason === 'needs-infer' || reason === 'inferred') {
      return klass ? `Infer from profile onto ${klass}` : 'Infer from profile onto the listed options';
    }
    if (reason === 'fuzzy') return 'Unsure this option is the right match';
    return '';
  }

  function reviewChatPlaceholder() {
    return 'Ask Magnet about this field…';
  }

  function leftoverReviewRows(fields, existing) {
    const have = new Set();
    for (const row of existing || []) {
      if (row && row.id) have.add(row.id);
    }
    const out = [];
    for (const f of fields || []) {
      if (!f || !f.id || have.has(f.id)) continue;
      if (f.route === 'needs_llm' || f.route === 'employment' || f.route === 'skip') continue;
      if (!(f.residual || f.magnetState === 'red')) continue;
      have.add(f.id);
      const residual = String(f.residual || '');
      const intended = String(f.intended || '').trim();
      const gate =
        residual === 'needs-infer'
          ? 'needs-infer'
          : residual === 'intended_neq_current'
            ? 'wrong-intended'
            : !intended
              ? 'unlabeled'
              : residual === 'red'
                ? 'couldnt-land'
                : residual;
      out.push({
        id: f.id,
        label: f.label || f.id,
        value: intended,
        reason:
          gate === 'wrong-intended'
            ? 'Magnet put a different value'
            : gate === 'couldnt-land'
              ? 'Could not fill'
              : gate === 'needs-infer'
                ? 'Infer from profile'
                : residual,
        gate,
        pageValue: String(f.current || f.value || '').trim(),
        type: f.type,
        tag: f.tag,
        options: f.options,
        select: f.select,
        reactSelect: f.reactSelect,
        shape: f.shape,
        route: f.route,
        classifyReason: f.reason || '',
        qClass: f.qClass || f.class_id || f.class || '',
        qKind: f.qKind || '',
        profileValue: f.profileValue || '',
        intended,
        current: String(f.current || f.value || '').trim(),
        fill: f.fill || null,
        recipeHit: f.recipeHit || null,
        magnetState: f.magnetState || '',
        residual,
      });
    }
    return out;
  }

  return {
    reviewGateKind,
    reviewKindClass,
    reviewCardKind,
    reviewCardWhy,
    reviewAskWhy,
    reviewChatPlaceholder,
    reviewEditHint,
    leftoverReviewRows,
  };
});
