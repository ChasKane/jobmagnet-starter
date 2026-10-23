function wantsEssayOverride(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return /\b((this|that|it)('s| is| isn'?t| is not) (actually |really )?(an? )?(essay|long[- ]form|static field)|treat (this|it|that) as (an? )?(essay|long[- ]form)|this is (actually )?(an? )?(essay|long[- ]form)|not (a )?static|write (it|that|this|the answer) (in|into|on) (the )?(box|field|page)|put (it|that|this) (in|into|on) (the )?(box|field|page)|draft (this|that|it) (onto|into|in)|fill (this|the) (box|field))\b/i.test(
    t
  );
}

function looksLikeApplyForm(text) {
  const t = String(text || '');
  if (t.length < 80) return false;
  const formy = /submit (your )?application|attach resume|additional information|current location/i.test(t);
  const posting = /what we.re looking for|responsibilit|requirements|you will|about the (role|job|company)/i.test(t);
  return formy && !posting;
}

module.exports = {
  wantsEssayOverride,
  looksLikeApplyForm,
};
