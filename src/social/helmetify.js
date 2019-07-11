import { parse } from 'url';
import flatten from 'lodash/flatten';
import { arrayify, textify } from '@scipe/jsonld';
import { getParts, getRootPart } from '../utils/schema-utils';

/**
 * This function takes an _hydrated_ object (which can be a resource,
 * periodical, person, or org) and some supporting details, and returns an object
 * with everything you need to generate the content of an HTML <head> or to
 * configure react-helmet with.
 */
export default function helmetify(
  obj = {},
  {
    title,
    defaultTitle = '',
    titleTemplate = '%s',
    site,
    path,
    defaultImg = '/favicon/alt-submark-favicon/android-chrome-512x512.png'
  } = {}
) {
  let meta = [],
    type = obj['@type'];

  if (!title) {
    if (type === 'Person') {
      if (obj.name) title = textify(obj.name);
      else if (obj.givenName && obj.familyName)
        title = `${textify(obj.givenName)} ${textify(obj.familyName)}`;
      else title = (obj['@id'] || 'Anonymous').replace(/^user:/, '');
    } else if (type === 'Organization') {
      if (obj.name) title = textify(obj.name);
      else title = (obj['@id'] || 'Unknown Org.').replace(/^user:/, '');
    } else {
      const _title = arrayify(obj.name)
        .concat(arrayify(obj.alternateName))
        .concat(arrayify(obj.alternativeHeadline))
        .concat(arrayify(obj.caption))
        .find(x => x);
      if (_title) {
        title = textify(_title);
      }
    }
  }
  if (!title) title = defaultTitle;

  // 01. We do the ugly ancient meta stuff that Google Scholar gets. We only do that for articles.
  if (type === 'ScholarlyArticle') {
    meta.push({ name: 'citation_title', content: title });
    arrayify(obj.author).forEach(auth => {
      auth = arrayify(auth.author)[0];
      if (!auth) return;
      let n =
        textify(auth.name) ||
        `${textify(auth.givenName)} ${textify(auth.familyName)}`;
      meta.push({ name: 'citation_author', content: n });
    });

    let cur = arrayify(obj.isPartOf)[0];
    while (cur && typeof cur === 'object') {
      if (cur['@type'] === 'Periodical') {
        meta.push({
          name: 'citation_journal_title',
          content: textify(cur.name || cur.alternateName)
        });
      } else if (cur['@type'] === 'PublicationVolume') {
        meta.push({
          name: 'citation_volume',
          content: textify(cur.volumeNumber)
        });
      } else if (cur['@type'] === 'PublicationIssue') {
        meta.push({
          name: 'citation_issue',
          content: textify(cur.issueNumber)
        });
      }
      cur = arrayify(cur.isPartOf)[0];
    }

    if (obj.datePublished || obj.dateCreated) {
      meta.push({
        name: 'citation_publication_date',
        content: textify(obj.datePublished || obj.dateCreated)
      });
    }
    let ps, pe;
    if (obj.pageStart || obj.pageEnd) {
      ps = textify(obj.pageStart);
      pe = textify(obj.pageEnd);
    } else if (obj.pagination) {
      [ps, pe] = textify(obj.pagination).split('-');
    }
    if (ps) meta.push({ name: 'citation_firstpage', content: ps });
    if (pe) meta.push({ name: 'citation_lastpage', content: pe });
    arrayify(obj.isbn).forEach(isbn =>
      meta.push({ name: 'citation_isbn', content: textify(isbn) })
    );
    arrayify(obj.issn).forEach(issn =>
      meta.push({ name: 'citation_issn', content: textify(issn) })
    );
  }

  // 02. Here is the other, slightly less antiquated horror for Twitter/Facebook.
  // thanks: https://adactio.com/journal/9881
  let cardType = 'summary',
    imgUrl;

  if (obj.image) {
    cardType = 'summary_large_image';
    imgUrl = getImageUrl(obj.image);
  }

  meta.push({ name: 'twitter:card', content: cardType });
  meta.push({ name: 'twitter:site', content: '@scipeTweets' });

  if (!imgUrl) {
    // try to get image from one of the resource
    const parts = [obj]
      .concat(getParts(obj))
      .filter(
        part => part['@type'] === 'Image' && (part.image || part.encoding)
      );

    for (const part of parts) {
      const encodings = arrayify(part.image).concat(arrayify(part.encoding));
      imgUrl = getImageUrl(encodings);
      if (imgUrl) {
        break;
      }
    }
  }

  if (!imgUrl) {
    imgUrl = getImageUrl(obj.logo);
  }

  if (!imgUrl) {
    // if ScholarlyArticle we fallback to logo of the journal
    if (obj['@type'] === 'ScholarlyArticle') {
      const journal = getRootPart(obj);
      if (journal) {
        imgUrl = getImageUrl(journal.logo);
      }
    }
  }

  if (!imgUrl) imgUrl = defaultImg;

  if (imgUrl) {
    let { protocol } = parse(imgUrl);
    if (!protocol) {
      if (!/^\//.test(imgUrl)) imgUrl = `/${imgUrl}`;
      if (/\/$/.test(site)) site = site.replace(/\/$/, '');
      imgUrl = `${site || 'https://sci.pe'}${imgUrl}`;
    }
    meta.push({ name: 'twitter:image', property: 'og:image', content: imgUrl });
  }

  let url;
  if (
    type === 'ScholarlyArticle' ||
    type === 'Periodical' ||
    type === 'RequestArticleAction'
  )
    url = textify(obj.url);
  else if (
    (type === 'Person' || type === 'Organization') &&
    /^user:/.test(obj['@id'])
  ) {
    url = `https://${obj['@id'].replace(/^user:/, '')}.sci.pe/`;
  }
  if (!url && site) {
    if (path) {
      if (!/^\//.test(path)) path = `/${path}`;
    } else path = '/';
    if (/\/$/.test(site)) site = site.replace(/\/$/, '');
    url = `${site}${path}`;
  }

  if (url) {
    meta.push({ name: 'twitter:url', property: 'og:url', content: url });
  }
  meta.push({ name: 'twitter:title', property: 'og:title', content: title });
  let desc = textify(obj.description);
  if (!desc) {
    if (type === 'Person') desc = `User '${title}' on sci.pe.`;
    else if (type === 'Organization')
      desc = `Organization '${title}' on sci.pe.`;
    else if (type === 'Periodical') desc = `Periodical '${title}' on sci.pe.`;
    else desc = `Article '${title}' on sci.pe.`;
  }
  meta.push({
    name: 'twitter:description',
    property: 'og:description',
    content: desc
  });

  return { meta, title: titleTemplate.replace(/%s/g, title) };
}

function getImageUrl(imageObjects) {
  if (!imageObjects || typeof imageObjects === 'string') {
    return imageObjects;
  }

  const sortedImages = arrayify(imageObjects)
    .concat(
      flatten(
        arrayify(imageObjects).map(imageObject =>
          arrayify(imageObject.thumbnail)
        )
      )
    )
    .filter(
      encoding =>
        encoding &&
        encoding.contentUrl &&
        /^image\/(png|jpeg)/i.test(encoding.fileFormat)
    )
    .sort((a, b) => {
      if (a.contentSize == null && b.contentSize == null) {
        return 1;
      } else if (a.contentSize == null && b.contentSize != null) {
        return 1;
      } else if (a.contentSize != null && b.contentSize == null) {
        return -1;
      } else {
        return a.contentSize - b.contentSize;
      }
    });

  if (sortedImages.length) {
    return sortedImages[0].contentUrl;
  }
}
