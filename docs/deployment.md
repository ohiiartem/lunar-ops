# Lunar OPS deployment

The same HTTPS URL serves the visualization and FastAPI. Deploy the repository as a Render Blueprint using
`render.yaml`. Connect the GitHub repository in the Render dashboard and select the branch that contains this file.
Render assigns an `onrender.com` hostname, such as `lunar-ops.onrender.com` if the name is available.

The free service can sleep between visits. Open it before a scheduled demo, then test the live URL while it is awake.
Use the deployment hostname, or attach a custom domain through the hosting dashboard and add the DNS record it specifies.
Using `lunar.ops.pl` requires access to DNS for `ops.pl`.

## Entry load test

Run from the repository root with Node 22 against an instance you control:

```sh
node scripts/load-entry.mjs https://YOUR-HOST/ 100
```

The script starts all sessions together and reuses up to 100 connections. Each session loads the HTML, CSS, entry script,
globe textures and site catalogue, then requests scenario metrics and the full observation series.
It reports successful sessions, errors and end-to-end timing in milliseconds. Run against the final host before distributing
the URL. The script exercises HTTP requests without measuring WebGL frame rate or browser rendering.

## QR code

Encode the final public HTTPS URL in a static QR code. Scan the printed or exported code to confirm that it opens exactly
that URL. Use the final hostname for printed material, because a temporary tunnel URL changes if you recreate the tunnel.
