# @scipe/librarian

[![CircleCI](https://circleci.com/gh/science-periodicals/librarian.svg?style=svg&circle-token=e90232dac4e2a4746a362af261178588dfce944a)](https://circleci.com/gh/science-periodicals/librarian)

[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

[sci.pe](https://sci.pe) data model. The only source of truth in data. This
library wraps all access to CouchDB. No other project should touch CouchDB
directly (except for PouchDB), everything needs to go through here.

Note: this module is auto published to npm on CircleCI. Only run `npm version
patch|minor|major` and let CI do the rest.

![Smart Contract Executioner](./splash.png?raw=true)

## Coding style

Use `prettier --single-quote` (or `npm run format`) and:
- `const` over `let` or `var` whenever possible

## API

A high level API to abstract away CouchDB and the side effects of
common CRUD operations.

```js
import { Librarian } from '@scipe/librarian';

const librarian = new Librarian(config || req);
```

## Required reading

- https://dx13.co.uk/articles/2015/10/19/couchdb-20s-read-and-write-behaviour-in-a-cluster.html
- https://console.bluemix.net/docs/services/Cloudant/guides/sharding.html#how-is-data-stored-in-ibm-cloudant-
- https://redis.io/topics/distlock

## CLI

```sh
librarian --help
```

## Email dev server

```sh
npm run watch-email-server
```

## License

`@scipe/librarian` is dual-licensed under commercial and open source licenses
([AGPLv3](https://www.gnu.org/licenses/agpl-3.0.en.html)) based on the intended
use case. Contact us to learn which license applies to your use case.
