export function getFacebookShareUrl({ url }) {
  url = encodeURIComponent(url);

  return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
}

export function getTwitterShareUrl({
  url,
  name = '',
  description = '',
  text = ''
}) {
  let qs = `?url=${encodeURIComponent(url)}`;

  const data = [name, description, text].filter(Boolean).join('.');

  if (data) {
    qs = qs + `&data=${encodeURIComponent(shorten(data, 240))}`;
  }
  return `https://twitter.com/intent/tweet${qs}`;
}

export function getRedditShareUrl({
  url,
  name = '',
  description = '',
  text = ''
}) {
  const data = [name, description, text].filter(Boolean).join('.');

  let qs = `?url=${encodeURIComponent(url)}`;
  if (data) {
    qs = qs + `&title=${encodeURIComponent(data)}`;
  }

  return `https://www.reddit.com/submit${qs}`;
}

// See https://developer.linkedin.com/docs/share-on-linkedin (Customized URL tab))
export function getLinkedInShareUrl({
  url,
  name = '',
  description = '',
  text = ''
}) {
  let qs = `?mini=true&url=${encodeURIComponent(url)}`;

  if (name && (description || text)) {
    qs = qs + `&title=${encodeURIComponent(shorten(name, 200))}`;

    const data = [description, text].filter(Boolean).join('.');
    qs = qs + `&summary=${encodeURIComponent(shorten(data, 256))}`;
  } else {
    const data = [name, description, text].filter(Boolean).join('.');
    qs = qs + `&title=${encodeURIComponent(shorten(data, 200))}`;
  }

  return `https://www.linkedin.com/shareArticle${qs}`;
}

export function getEmailShareUrl({
  url,
  name = 'shared URL',
  description = '',
  text = 'Hello,\n\nThis URL might interest you:\n\n  '
}) {
  let body = `${text} ${url}`;
  if (description) {
    body = body + `\n\n${description}`;
  }

  return `mailto:?Subject=${encodeURIComponent(name)}&Body=${encodeURIComponent(
    body
  )}`;
}

function shorten(text = '', maxSize = 200) {
  const ellipsis = '…';
  maxSize = Math.max(maxSize - ellipsis.length, 0);

  if (text.length > maxSize) {
    return `${text.substring(0, maxSize).replace(/\W+$/, '')}…`;
  }
  return text;
}
