# js/ — production build output

Development source lives in [`../src/`](../src/) as ES modules and is loaded
directly by Vite during `npm run dev`.

For production, `npm run build` bundles `src/` into hashed assets under
`dist/`. This `js/` folder is reserved for any hand-authored or pre-bundled
single-file scripts you want to ship outside the Vite pipeline; it is empty by
default.
