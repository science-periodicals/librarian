import sanitizeHtml from 'sanitize-html';
import DrSax from 'dr-sax';

export default function toMarkdown(html) {
  return new DrSax({ stripTags: true }).write(
    sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags
        .concat('h1', 'h2', 'img')
        .filter(tagName => tagName !== 'div'),
      allowedAttributes: Object.assign(
        {},
        sanitizeHtml.defaults.allowedAttributes,
        { img: ['src', 'alt'] }
      )
    })
  );
}
