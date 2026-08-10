/**
 * Method resolution: submitter's `formmethod` wins over form's `method`.
 * Returns lowercase.
 *
 * Resolved on PRESENCE, not truthiness (#1322), the same way `getSubmitAction`
 * below resolves the action. The form-submission algorithm reads the
 * submitter's `formmethod` if the submitter HAS one, so a present-but-empty
 * `formmethod=""` overrides the form and then falls to its own invalid-value
 * default, GET. Resolving with `||` instead sent a multipart POST for a button
 * every engine submits as `GET`, which is a JS-on versus JS-off divergence.
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 */
export function getSubmitMethod(form, submitter) {
  const v = (submitter && submitter.hasAttribute('formmethod'))
    ? (submitter.getAttribute('formmethod') || '')
    : (form.getAttribute('method') || '');
  return (v || 'get').toLowerCase();
}

/**
 * Action resolution: submitter's `formaction` wins over form's `action`.
 * Empty string is valid (means submit-to-current-url).
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 */
export function getSubmitAction(form, submitter) {
  if (submitter && submitter.hasAttribute('formaction')) {
    return submitter.getAttribute('formaction') || '';
  }
  return form.getAttribute('action') || form.action || location.href;
}

/**
 * The three `enctype` keywords, plus the normalization a browser applies.
 *
 * Both the missing-value AND the invalid-value default of the `enctype`
 * enumerated attribute are `application/x-www-form-urlencoded`, so
 * `enctype="nonsense"` really does mean urlencoded and has to be sent as such.
 * Only an exact, ASCII-case-insensitive match on one of the other two keywords
 * means anything else.
 *
 * @param {string | null | undefined} raw
 * @returns {'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain'}
 */
function normalizeEnctype(raw) {
  // Compared UNTRIMMED, the same rule `assertSubmittableForm` applies in
  // `form-action.js`. An enumerated attribute is matched against exact
  // keywords with no whitespace stripping, so `enctype=" multipart/form-data "`
  // falls to the invalid-value default and a BROWSER sends urlencoded for it.
  // Trimming here would send multipart, so the router would disagree with the
  // no-JS path on exactly the shape this function exists to keep in step.
  const v = String(raw || '').toLowerCase();
  if (v === 'multipart/form-data') return 'multipart/form-data';
  if (v === 'text/plain') return 'text/plain';
  return 'application/x-www-form-urlencoded';
}

/**
 * Enctype resolution: the submitter's `formenctype` wins over the form's
 * `enctype`, exactly as `getSubmitMethod` resolves the method (#1307). Turbo
 * resolves it the same way, in `core/drive/form_submission.js`.
 *
 * On PRESENCE, not truthiness (#1322), for the reason spelled out on
 * `getSubmitMethod`: a present-but-empty `formenctype=""` overrides the form
 * and normalizes to urlencoded, its own invalid-value default, so a button on
 * a multipart form sends urlencoded with JS on exactly as it does with JS off.
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 */
export function getSubmitEnctype(form, submitter) {
  return normalizeEnctype(
    (submitter && submitter.hasAttribute('formenctype'))
      ? submitter.getAttribute('formenctype')
      : form.getAttribute('enctype'),
  );
}

/**
 * Encode a submission body the way the DECLARED enctype says to (#1307).
 *
 * The router used to build a `FormData` and send it with no explicit content
 * type, so `fetch` always derived `multipart/form-data` and the authored
 * `enctype` was never read at all. An author writing
 * `enctype="application/x-www-form-urlencoded"`, which is also the HTML
 * DEFAULT and therefore what a plain `<form method="post">` means, got
 * urlencoded with JS off and multipart with JS on. Same form, two different
 * request bodies, which is exactly what progressive enhancement rules out.
 *
 * A `File` entry serializes as its NAME under urlencoded, which is what the
 * platform's own urlencoded serializer does. (Turbo drops file entries here
 * entirely, in `http/fetch_request.js`, which loses a field the no-JS path
 * sends.)
 *
 * A bound form is unaffected: it carries an explicit
 * `enctype="multipart/form-data"`, and since #1307 a bound submitter carries
 * `formenctype="multipart/form-data"`, so both resolve to multipart as before.
 *
 * @param {FormData} formData
 * @param {'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain'} enctype
 * @returns {FormData | URLSearchParams}
 */
export function encodeSubmitBody(formData, enctype) {
  if (enctype === 'multipart/form-data') return formData;
  const params = new URLSearchParams();
  for (const [k, v] of formData) params.append(k, typeof v === 'string' ? v : v.name);
  return params;
}

/**
 * Build FormData honoring the submitter's name=value (per HTML5 form
 * submission algorithm). Modern browsers + the `FormData(form, submitter)`
 * ctor handle this automatically; older Safari needs a manual append.
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 * @returns {FormData}
 */
export function buildSubmitFormData(form, submitter) {
  try {
    return new FormData(form, /** @type any */ (submitter || undefined));
  } catch {
    const fd = new FormData(form);
    if (submitter && submitter.getAttribute('name')) {
      fd.append(
        /** @type {string} */ (submitter.getAttribute('name')),
        submitter.getAttribute('value') || '',
      );
    }
    return fd;
  }
}
