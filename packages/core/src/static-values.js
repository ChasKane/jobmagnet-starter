function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function identity(profile) {
  return (profile && profile.identity) || {};
}

function mailing(profile) {
  const id = identity(profile);
  return id.mailing_address || {};
}

function valueFromProfile(field, profile) {
  if (!field || !profile) return null;
  const label = norm(field.label || field.name || field.id);
  const id = identity(profile);
  const addr = mailing(profile);
  const work = (profile && profile.work) || {};

  if (/full name|^name$|legal name/.test(label)) {
    return id.legal_name || [id.first_name, id.last_name].filter(Boolean).join(' ') || null;
  }
  if (/preferred name|first name/.test(label) && !/last/.test(label)) return id.first_name || id.preferred_name || null;
  if (/last name|surname|family name/.test(label)) return id.last_name || null;
  if (/email/.test(label)) return id.email || null;
  if (/phone|mobile|cell/.test(label) && !/country/.test(label)) return id.phone || null;
  if (/linkedin/.test(label)) return id.linkedin || null;
  if (/github/.test(label)) return id.github || null;
  if (/portfolio|personal site|website/.test(label)) return id.portfolio || id.website || null;
  if (/city/.test(label)) return addr.city || id.city || null;
  if (/state|province/.test(label) && !/united/.test(label)) return addr.state_code || id.state_code || addr.state || id.state || null;
  if (/zip|postal/.test(label)) return addr.zip || id.zip || null;
  if (/country/.test(label)) return addr.country || id.country || null;
  if (/street|address line 1|address 1/.test(label)) return addr.line1 || addr.street || null;
  if (/address line 2|address 2/.test(label)) return addr.line2 || null;
  if (/short pitch|cover letter|why this/.test(label)) return null;
  if (/authorized|work authorization|legally authorized/.test(label)) {
    return work.legally_authorized_to_work_us ? 'Yes' : 'No';
  }
  if (/sponsor/.test(label)) return work.requires_sponsorship_now_or_future ? 'Yes' : 'No';
  if (/relocate/.test(label)) return work.willing_to_relocate ? 'Yes' : 'No';
  return null;
}

module.exports = { valueFromProfile, norm };
