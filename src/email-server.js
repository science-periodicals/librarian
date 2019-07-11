import http from 'http';
import fs from 'fs';
import { unrole, unprefix, arrayify, getId } from '@scipe/jsonld';
import path from 'path';
import ejs from 'ejs';
import express from 'express';
import resources from '@scipe/resources';
import juice from 'juice';

const css = fs
  .readFileSync(path.join(__dirname, '../templates/style.css'))
  .toString();
const templatesDir = path.join(__dirname, '../templates');
const templatePaths = fs
  .readdirSync(templatesDir)
  .filter(
    templateName =>
      templateName.match(/\.ejs$/) &&
      !templateName.includes('header') &&
      !templateName.includes('footer')
  );

let app = express();
app.enable('case sensitive routing');
app.set('views', templatesDir);
app.set('view engine', 'ejs');
app.use(resources());
app.use(express.static(path.join(__dirname, '../templates')));

app.get('/template/:templateName', (req, res, next) => {
  const nodeMap = {
    'user:peter': {
      '@id': 'user:peter',
      name: 'Dr Peter Jon Smith',
      email: 'mailto:peter@example.com'
    }
  };

  function hydrate(node) {
    const id = getId(node);
    if (!id) {
      return node;
    }
    return id in nodeMap ? nodeMap[id] : node;
  }

  const html = ejs.render(
    `<!DOCTYPE html>
<html>
  <body>
    <script type="application/ld+json"><%- emailMessage %></script>
    <%- include('/header'); %>
    <%- include('/${req.params.templateName}'); %>
    <%- include('/footer'); %>
  </body>
</html>`,
    {
      emailMessage: {
        recipient: 'user:peter'
      },
      registrationToken: { '@id': 'token:tokenId', '@type': 'Token' },
      unrole,
      getId,
      hydrate,
      unprefix,
      arrayify
    },
    { root: path.join(__dirname, '../templates/') }
  );

  res.send(juice.inlineContent(html, css));
});

// TODO add spam me button
app.get('/', (req, res, next) => {
  res.send(
    `
    <h1>Email templates</h1>
    <ul>
    ${templatePaths
      .map(templatePath => {
        const templateName = templatePath.replace(/\.ejs$/, '');
        return `
        <li>
          <a href="/template/${templateName}">${templateName}</a>
        </li>
      `;
      })
      .join('')}
    </ul>
  `
  );
});

let server = http.createServer(app);
let port = 3000;
server.listen(port, () => {
  console.log('Server running on port %s', port);
});
